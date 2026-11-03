// Landing page: sign in, register, and skip straight to the app when already
// signed in. Plain browser script, no dependencies (CSP: 'self' only).
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

  function readErrorMessage(res) {
    return res.json().then(function (body) {
      return (body && body.error && body.error.message) || 'Permintaan gagal.';
    }, function () { return 'Permintaan gagal (' + res.status + ').'; });
  }

  function submit(kind, form) {
    var email = form.elements.email.value.trim();
    var password = form.elements.password.value;
    if (!email || !password) {
      setStatus('Isi email dan kata sandi.', 'err');
      return;
    }
    if (kind === 'register' && password.length < 10) {
      setStatus('Kata sandi minimal 10 karakter.', 'err');
      return;
    }
    var button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    setStatus(kind === 'login' ? 'Memeriksa akun…' : 'Membuat akun…');
    fetch(API + '/auth/' + kind, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ email: email, password: password }),
    }).then(function (res) {
      if (res.ok) {
        setStatus('Berhasil. Membuka studio…', 'ok');
        location.replace(APP);
        return;
      }
      return readErrorMessage(res).then(function (msg) {
        setStatus(msg, 'err');
        button.disabled = false;
      });
    }, function () {
      setStatus('Tidak bisa terhubung ke server. Coba lagi sebentar lagi.', 'err');
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
