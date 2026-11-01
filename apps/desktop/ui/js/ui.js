// KGSM UI shared DOM helpers: toasts, modal, panels, report rendering.
// Plain browser script; exposes globalThis.KgsmUi.
(function () {
  'use strict';

  function esc(s) { return globalThis.KgsmUtil.esc(s); }

  function icon(name) {
    var I = globalThis.KgsmIcons;
    return I ? I.svg(name, 'k-toast-icon') : '';
  }

  var KIND_ICON = { success: 'check', error: 'error', warn: 'warn', warning: 'warn', info: 'info' };

  function toast(message, kind) {
    kind = kind || 'info';
    var wrap = document.getElementById('toasts');
    if (!wrap) return;
    var el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="toast-icon" aria-hidden="true"></span>'
      + '<span class="toast-msg"></span><button type="button" aria-label="Dismiss">×</button>';
    el.querySelector('.toast-icon').innerHTML = icon(KIND_ICON[kind] || 'info');
    el.querySelector('.toast-msg').textContent = message;
    el.querySelector('button').addEventListener('click', function () { el.remove(); });
    wrap.appendChild(el);
    setTimeout(function () {
      el.classList.add('fade');
      setTimeout(function () { el.remove(); }, 400);
    }, kind === 'error' ? 6000 : 3600);
    while (wrap.children.length > 4) wrap.firstChild.remove();
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      if (btn.dataset.busy === '1') return;
      btn.dataset.busy = '1';
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      btn.textContent = label || 'Working…';
    } else {
      btn.dataset.busy = '';
      btn.disabled = false;
      if (btn.dataset.label != null) btn.innerHTML = btn.dataset.label;
    }
  }

  // Runs fn (promise) with button busy state + error toast. Returns the promise.
  function busy(btn, fn, label) {
    setBusy(btn, true, label);
    return Promise.resolve().then(fn).then(function (v) {
      setBusy(btn, false);
      return v;
    }, function (err) {
      setBusy(btn, false);
      toast(errorText(err), 'error');
      throw err;
    });
  }

  function errorText(err) {
    if (!err) return 'Unknown error';
    if (err.code && err.message) return err.message + ' [' + err.code + ']';
    if (err.message) return err.message;
    return String(err);
  }

  function confirmModal(title, bodyText, okLabel, danger) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML =
        '<div class="modal glass-panel glass-panel-glow" role="dialog" aria-modal="true">'
        + '<div class="modal-head"><h3></h3>'
        + '<button type="button" class="icon-btn" data-x="no" aria-label="Cancel">✕</button></div>'
        + '<p class="modal-body"></p>'
        + '<div class="modal-actions"><button type="button" class="btn ghost" data-x="no2">Cancel</button>'
        + '<button type="button" class="btn primary" data-x="yes"></button></div></div>';
      overlay.querySelector('h3').textContent = title;
      overlay.querySelector('.modal-body').textContent = bodyText;
      var yes = overlay.querySelector('[data-x="yes"]');
      var cancel = overlay.querySelector('[data-x="no2"]');
      yes.textContent = okLabel || 'Confirm';
      if (danger) yes.classList.add('danger');
      var prevFocus = document.activeElement;
      var settled = false;
      function done(v) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) { /* ignore */ } }
        resolve(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); done(false); return; }
        if (e.key !== 'Tab') return;
        var focusables = overlay.querySelectorAll('button, input, select, textarea, [tabindex]');
        var list = [];
        for (var i = 0; i < focusables.length; i++) {
          if (!focusables[i].disabled) list.push(focusables[i]);
        }
        if (!list.length) return;
        var first = list[0], last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      overlay.querySelector('[data-x="no"]').addEventListener('click', function () { done(false); });
      cancel.addEventListener('click', function () { done(false); });
      yes.addEventListener('click', function () { done(true); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) done(false); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      cancel.focus();
    });
  }

  // Inline text-prompt modal in the app's dialog vocabulary (replaces blocking
  // window.prompt). validate(value) returns an error string or '' when ok.
  // Resolves to the trimmed string, or null when cancelled.
  function promptModal(title, initial, validate) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML =
        '<div class="modal glass-panel glass-panel-glow" role="dialog" aria-modal="true">'
        + '<div class="modal-head"><h3></h3>'
        + '<button type="button" class="icon-btn" data-x="no" aria-label="Cancel">✕</button></div>'
        + '<label class="fld"><span>Name</span><input data-x="input" maxlength="80"></label>'
        + '<p class="err-msg" data-x="err" role="alert" hidden></p>'
        + '<div class="modal-actions"><button type="button" class="btn ghost" data-x="no2">Cancel</button>'
        + '<button type="button" class="btn primary" data-x="yes">Save</button></div></div>';
      overlay.querySelector('h3').textContent = title;
      var input = overlay.querySelector('[data-x="input"]');
      var err = overlay.querySelector('[data-x="err"]');
      var yes = overlay.querySelector('[data-x="yes"]');
      input.value = initial == null ? '' : String(initial);
      var prevFocus = document.activeElement;
      var settled = false;
      function showErr(msg) {
        err.hidden = !msg;
        err.textContent = msg || '';
      }
      function done(v) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) { /* ignore */ } }
        resolve(v);
      }
      function submit() {
        var v = input.value.trim();
        var msg = validate ? validate(v) : '';
        if (msg) { showErr(msg); input.focus(); return; }
        done(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); done(null); return; }
        if (e.key === 'Enter' && document.activeElement === input) { e.preventDefault(); submit(); return; }
        if (e.key !== 'Tab') return;
        var focusables = overlay.querySelectorAll('button, input, select, textarea, [tabindex]');
        var list = [];
        for (var i = 0; i < focusables.length; i++) {
          if (!focusables[i].disabled) list.push(focusables[i]);
        }
        if (!list.length) return;
        var first = list[0], last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      overlay.querySelector('[data-x="no"]').addEventListener('click', function () { done(null); });
      overlay.querySelector('[data-x="no2"]').addEventListener('click', function () { done(null); });
      yes.addEventListener('click', submit);
      input.addEventListener('input', function () { showErr(''); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) done(null); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      input.focus();
      input.select();
    });
  }

  function loadingPanel(text) {
    return '<div class="state loading"><span class="spinner" aria-hidden="true"></span>'
      + '<p>' + esc(text || 'Loading…') + '</p></div>';
  }

  function art(name, fallback) {
    var I = globalThis.KgsmIcons;
    var inner = I ? I.svg(name, 'k-art-icon') : esc(fallback);
    return '<div class="empty-art" aria-hidden="true">' + inner + '</div>';
  }

  function emptyPanel(title, hint, actionHtml) {
    return '<div class="state empty-state">' + art('folder', '◇')
      + '<h3>' + esc(title) + '</h3>'
      + (hint ? '<p class="muted">' + esc(hint) + '</p>' : '')
      + (actionHtml || '') + '</div>';
  }

  function errorPanel(title, err, retryHtml) {
    var msg = errorText(err);
    return '<div class="state error-state">' + art('warn', '⚠')
      + '<h3>' + esc(title) + '</h3><p class="err-msg">' + esc(msg) + '</p>'
      + (retryHtml || '') + '</div>';
  }

  function offlinePanel() {
    return '<div class="state error-state">' + art('error', '⌁')
      + '<h3>Worker offline</h3>'
      + '<p class="muted">Start the local worker (default http://127.0.0.1:4317) or fix the '
      + 'Worker URL in Settings. This view needs a live connection.</p>'
      + '<div class="btn-row"><button type="button" class="btn ghost" data-kgsm-offline-retry>'
      + 'Retry connection</button></div></div>';
  }

  // Delegated Retry for every offlinePanel: re-check health, then re-render
  // the current view in place when the worker is back (no caller wiring).
  if (typeof document !== 'undefined') {
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest
        ? e.target.closest('[data-kgsm-offline-retry]') : null;
      if (!b || b.disabled) return;
      var App = globalThis.KgsmApp;
      if (!App || !App.checkHealth || !App.go) return;
      setBusy(b, true, 'Retrying…');
      App.checkHealth().then(function () {
        setBusy(b, false);
        var S = globalThis.KgsmStore;
        if (S && S.get('online')) {
          var m = /^#\/([a-z-]+)/.exec(window.location.hash || '');
          App.go(m ? m[1] : 'home');
        } else {
          toast('Worker is still offline.', 'error');
        }
      });
    });
  }

  function issueList(items, cls) {
    if (!items || !items.length) return '<p class="muted">None.</p>';
    return '<ul class="issues ' + cls + '">' + items.map(function (it) {
      var path = it.path ? ' <code>' + esc(it.path) + '</code>' : '';
      var code = it.code ? ' <span class="pill mini">' + esc(it.code) + '</span>' : '';
      return '<li><span class="lvl">' + esc(it.level || (cls === 'err' ? 'error' : 'warning')) + '</span> '
        + esc(it.message || JSON.stringify(it)) + path + code + '</li>';
    }).join('') + '</ul>';
  }

  function reportHtml(report, title) {
    var r = globalThis.KgsmUtil.summarizeReport(report);
    var pill = r.ok ? '<span class="pill green">PASS</span>' : '<span class="pill red">FAIL</span>';
    return '<div class="report panel"><div class="panel-head"><h3>' + esc(title || 'Validation report')
      + '</h3>' + pill + '</div>'
      + '<h4>Errors (' + r.errors.length + ')</h4>' + issueList(r.errors, 'err')
      + '<h4>Warnings (' + r.warnings.length + ')</h4>' + issueList(r.warnings, 'warn') + '</div>';
  }

  // textContent-based pre: safe for untrusted strings.
  function pre(text) {
    var el = document.createElement('pre');
    el.className = 'code';
    el.textContent = text;
    return el;
  }

  function kvRows(obj) {
    return Object.keys(obj).map(function (k) {
      var v = obj[k];
      if (v == null) v = '—';
      else if (typeof v === 'object') v = JSON.stringify(v);
      return '<tr><th>' + esc(k) + '</th><td>' + esc(String(v)) + '</td></tr>';
    }).join('');
  }

  globalThis.KgsmUi = {
    toast: toast, setBusy: setBusy, busy: busy, errorText: errorText,
    confirmModal: confirmModal, promptModal: promptModal,
    loadingPanel: loadingPanel, emptyPanel: emptyPanel,
    errorPanel: errorPanel, offlinePanel: offlinePanel, issueList: issueList,
    reportHtml: reportHtml, pre: pre, kvRows: kvRows,
  };
})();
