// Landing page: sign in, sign up, email confirmation, password reset, and the
// language switch. Plain browser script, no dependencies (CSP: 'self' only).
// Messages are written in English; i18n.js shows Indonesian when the user picks ID,
// because text is matched against the dictionary.
(function () {
  'use strict';

  var API = '/kgsm/api/v1';
  var APP = '/kgsm/app/';
  var i18n = globalThis.KgsmI18n;
  if (i18n) i18n.init();

  var statusEl = document.getElementById('status');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  var forms = { login: document.getElementById('form-login'), register: document.getElementById('form-register') };
  var panels = {
    auth: document.querySelector('[data-panel="auth"]'),
    pending: document.querySelector('[data-panel="pending"]'),
    forgot: document.getElementById('form-forgot'),
    reset: document.getElementById('form-reset'),
    result: document.querySelector('[data-panel="result"]'),
  };
  var pendingEmail = '';

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function showPanel(name) {
    Object.keys(panels).forEach(function (key) {
      panels[key].hidden = key !== name;
    });
    setStatus('');
    var first = panels[name].querySelector('input');
    if (first) first.focus({ preventScroll: true });
  }

  function selectTab(name) {
    showPanel('auth');
    tabs.forEach(function (tab) {
      var on = tab.getAttribute('data-tab') === name;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    });
    Object.keys(forms).forEach(function (key) {
      forms[key].hidden = key !== name;
    });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () { selectTab(tab.getAttribute('data-tab')); });
    tab.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      var next = tabs[(tabs.indexOf(tab) + 1) % tabs.length];
      next.focus();
      selectTab(next.getAttribute('data-tab'));
    });
  });

  document.querySelectorAll('[data-tab-target]').forEach(function (link) {
    link.addEventListener('click', function () { selectTab(link.getAttribute('data-tab-target')); });
  });
  document.querySelectorAll('[data-go]').forEach(function (link) {
    link.addEventListener('click', function (ev) {
      ev.preventDefault();
      var target = link.getAttribute('data-go');
      if (target === 'login' || target === 'register') selectTab(target);
      else showPanel(target);
    });
  });

  // Language button: EN by default, ID when chosen, remembered per browser.
  var langBtn = document.getElementById('langToggle');
  if (langBtn && i18n) {
    var paintLang = function () {
      var on = i18n.lang();
      langBtn.textContent = on === 'id' ? 'ID' : 'EN';
      langBtn.setAttribute('aria-pressed', on === 'id' ? 'true' : 'false');
    };
    paintLang();
    langBtn.addEventListener('click', function () {
      i18n.setLang(i18n.lang() === 'id' ? 'en' : 'id');
      paintLang();
    });
  }

  function readError(res) {
    return res.json().then(function (body) {
      return { code: body && body.error && body.error.code, message: (body && body.error && body.error.message) || 'Request failed.' };
    }, function () { return { code: '', message: 'Request failed (' + res.status + ').' }; });
  }

  function post(path, payload) {
    return fetch(API + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  function busy(button, on) {
    if (button) button.disabled = on;
  }

  // ---- sign in / sign up ------------------------------------------------

  function submitAuth(kind, form) {
    var email = form.elements.email.value.trim();
    var password = form.elements.password.value;
    if (!email || !password) {
      setStatus('Fill in your email and password.', 'err');
      return;
    }
    if (kind === 'register' && password.length < 10) {
      setStatus('Password must be at least 10 characters.', 'err');
      return;
    }
    var button = form.querySelector('button[type="submit"]');
    busy(button, true);
    setStatus(kind === 'login' ? 'Checking your account…' : 'Creating your account…');
    post('/auth/' + kind, { email: email, password: password }).then(function (res) {
      if (kind === 'register' && res.ok) {
        pendingEmail = email;
        panels.pending.querySelector('[data-slot="pending-email"]').textContent = email;
        busy(button, false);
        form.reset();
        showPanel('pending');
        return;
      }
      if (res.ok) {
        setStatus('Signed in. Opening the studio…', 'ok');
        location.replace(APP);
        return;
      }
      return readError(res).then(function (err) {
        busy(button, false);
        if (err.code === 'email-not-verified') {
          pendingEmail = email;
          panels.pending.querySelector('[data-slot="pending-email"]').textContent = email;
          showPanel('pending');
          setStatus('Confirm your email first. You can send the link again below.', 'err');
          return;
        }
        setStatus(err.message, 'err');
      });
    }, function () {
      busy(button, false);
      setStatus('Could not reach the server. Please try again shortly.', 'err');
    });
  }

  forms.login.addEventListener('submit', function (ev) {
    ev.preventDefault();
    submitAuth('login', forms.login);
  });
  forms.register.addEventListener('submit', function (ev) {
    ev.preventDefault();
    submitAuth('register', forms.register);
  });

  // Resend the confirmation link. The reply is the same whatever the account state.
  panels.pending.querySelector('[data-a="resend"]').addEventListener('click', function (ev) {
    var button = ev.currentTarget;
    if (!pendingEmail) { setStatus('Enter your email again to get a new link.', 'err'); return; }
    busy(button, true);
    post('/auth/resend-verification', { email: pendingEmail }).then(function () {
      busy(button, false);
      setStatus('If that address is still waiting for confirmation, a new link is on its way.', 'ok');
    }, function () {
      busy(button, false);
      setStatus('Could not reach the server. Please try again shortly.', 'err');
    });
  });

  // ---- forgot password ----------------------------------------------------

  panels.forgot.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = panels.forgot.elements.email.value.trim();
    if (!email) { setStatus('Enter your email.', 'err'); return; }
    var button = panels.forgot.querySelector('button[type="submit"]');
    busy(button, true);
    post('/auth/forgot-password', { email: email }).then(function () {
      busy(button, false);
      panels.forgot.reset();
      setStatus('If an account exists for that email, we sent a reset link. Check your inbox.', 'ok');
    }, function () {
      busy(button, false);
      setStatus('Could not reach the server. Please try again shortly.', 'err');
    });
  });

  // ---- reset from the emailed link ---------------------------------------

  var resetToken = '';

  panels.reset.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var password = panels.reset.elements.password.value;
    var confirm = panels.reset.elements.confirm.value;
    if (password.length < 10) { setStatus('Password must be at least 10 characters.', 'err'); return; }
    if (password !== confirm) { setStatus('The two passwords do not match.', 'err'); return; }
    var button = panels.reset.querySelector('button[type="submit"]');
    busy(button, true);
    post('/auth/reset-password', { token: resetToken, password: password }).then(function (res) {
      busy(button, false);
      if (res.ok) {
        panels.reset.reset();
        resetToken = '';
        showResult('Password updated', 'Your password is changed. Sign in with the new one.');
        setTimeout(function () { selectTab('login'); }, 2200);
        return;
      }
      return readError(res).then(function (err) { setStatus(err.message, 'err'); });
    }, function () {
      busy(button, false);
      setStatus('Could not reach the server. Please try again shortly.', 'err');
    });
  });

  // ---- links from email ----------------------------------------------------

  function showResult(title, text) {
    panels.result.querySelector('[data-slot="result-title"]').textContent = title;
    panels.result.querySelector('[data-slot="result-text"]').textContent = text;
    showPanel('result');
  }

  function handleEmailLink() {
    var params = new URLSearchParams(location.search);
    var verify = params.get('verify');
    var reset = params.get('reset');
    if (verify) {
      history.replaceState(null, '', '/kgsm/');
      showResult('Confirming your email…', 'One moment.');
      post('/auth/verify', { token: verify }).then(function (res) {
        if (res.ok) {
          showResult('Email confirmed', 'Opening the studio…');
          location.replace(APP);
          return;
        }
        return readError(res).then(function (err) {
          showResult('This link has expired', err.message + ' Sign in, and we can send you a new one.');
        });
      }, function () {
        showResult('Could not confirm', 'Could not reach the server. Please try again shortly.');
      });
      return true;
    }
    if (reset) {
      history.replaceState(null, '', '/kgsm/');
      resetToken = reset;
      showPanel('reset');
      setStatus('Choose a new password for your account.');
      return true;
    }
    return false;
  }

  // ---- startup -------------------------------------------------------------

  if (!handleEmailLink()) {
    // Already signed in: go straight to the studio.
    fetch(API + '/auth/me', { credentials: 'same-origin' }).then(function (res) {
      if (res.ok) location.replace(APP);
    }, function () { /* offline: stay on the landing page */ });
  }
})();
