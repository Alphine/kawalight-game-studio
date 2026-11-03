// Landing page: sign in, sign up, language switch, and a skip to the app when
// already signed in. Plain browser script, no dependencies (CSP: 'self' only).
// Status text is written in English; i18n.js shows the Indonesian text when
// the user picks ID, because the text is matched against the dictionary.
(function () {
  'use strict';

  var API = '/kgsm/api/v1';
  var APP = '/kgsm/app/';
  var statusEl = document.getElementById('status');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  var forms = {
    login: document.getElementById('form-login'),
    register: document.getElementById('form-register'),
  };
  var i18n = globalThis.KgsmI18n;

  if (i18n) i18n.init();

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function selectTab(name) {
    tabs.forEach(function (tab) {
      var on = tab.getAttribute('data-tab') === name;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    });
    Object.keys(forms).forEach(function (key) {
      forms[key].hidden = key !== name;
    });
    setStatus('');
    var first = forms[name].querySelector('input');
    if (first) first.focus({ preventScroll: true });
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
    link.addEventListener('click', function () {
      selectTab(link.getAttribute('data-tab-target'));
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

  function readErrorMessage(res) {
    return res.json().then(function (body) {
      return (body && body.error && body.error.message) || 'Request failed.';
    }, function () { return 'Request failed (' + res.status + ').'; });
  }

  function submit(kind, form) {
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
    button.disabled = true;
    setStatus(kind === 'login' ? 'Checking your account…' : 'Creating your account…');
    fetch(API + '/auth/' + kind, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ email: email, password: password }),
    }).then(function (res) {
      if (res.ok) {
        setStatus('Signed in. Opening the studio…', 'ok');
        location.replace(APP);
        return;
      }
      return readErrorMessage(res).then(function (msg) {
        setStatus(msg, 'err');
        button.disabled = false;
      });
    }, function () {
      setStatus('Could not reach the server. Please try again shortly.', 'err');
      button.disabled = false;
    });
  }

  forms.login.addEventListener('submit', function (ev) {
    ev.preventDefault();
    submit('login', forms.login);
  });
  forms.register.addEventListener('submit', function (ev) {
    ev.preventDefault();
    submit('register', forms.register);
  });

  // Already signed in: go straight to the studio.
  fetch(API + '/auth/me', { credentials: 'same-origin' }).then(function (res) {
    if (res.ok) location.replace(APP);
  }, function () { /* offline: stay on the landing page */ });
})();
