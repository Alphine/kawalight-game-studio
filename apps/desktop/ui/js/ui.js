// KGSM UI shared DOM helpers: toasts, modal, panels, report rendering.
// Plain browser script; exposes globalThis.KgsmUi.
(function () {
  'use strict';

  function esc(s) { return globalThis.KgsmUtil.esc(s); }

  function toast(message, kind) {
    kind = kind || 'info';
    var wrap = document.getElementById('toasts');
    if (!wrap) return;
    var el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.setAttribute('role', 'status');
    el.innerHTML = '<span></span><button type="button" aria-label="Dismiss">×</button>';
    el.firstChild.textContent = message;
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
      btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.textContent = label || 'Working…';
    } else {
      btn.dataset.busy = '';
      btn.disabled = false;
      if (btn.dataset.label != null) btn.textContent = btn.dataset.label;
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
        '<div class="modal" role="dialog" aria-modal="true">'
        + '<h3></h3><p class="modal-body"></p>'
        + '<div class="modal-actions"><button type="button" class="btn ghost" data-x="no">Cancel</button>'
        + '<button type="button" class="btn primary" data-x="yes"></button></div></div>';
      overlay.querySelector('h3').textContent = title;
      overlay.querySelector('.modal-body').textContent = bodyText;
      var yes = overlay.querySelector('[data-x="yes"]');
      yes.textContent = okLabel || 'Confirm';
      if (danger) yes.classList.add('danger');
      function done(v) { overlay.remove(); resolve(v); }
      overlay.querySelector('[data-x="no"]').addEventListener('click', function () { done(false); });
      yes.addEventListener('click', function () { done(true); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) done(false); });
      document.body.appendChild(overlay);
      yes.focus();
    });
  }

  function loadingPanel(text) {
    return '<div class="state loading"><span class="spinner" aria-hidden="true"></span>'
      + '<p>' + esc(text || 'Loading…') + '</p></div>';
  }

  function emptyPanel(title, hint, actionHtml) {
    return '<div class="state empty-state"><div class="empty-art" aria-hidden="true">◇</div>'
      + '<h3>' + esc(title) + '</h3>'
      + (hint ? '<p class="muted">' + esc(hint) + '</p>' : '')
      + (actionHtml || '') + '</div>';
  }

  function errorPanel(title, err, retryHtml) {
    var msg = errorText(err);
    return '<div class="state error-state"><div class="empty-art" aria-hidden="true">⚠</div>'
      + '<h3>' + esc(title) + '</h3><p class="err-msg">' + esc(msg) + '</p>'
      + (retryHtml || '') + '</div>';
  }

  function offlinePanel() {
    return '<div class="state error-state"><div class="empty-art" aria-hidden="true">⌁</div>'
      + '<h3>Worker offline</h3>'
      + '<p class="muted">Start the local worker (default http://127.0.0.1:4317) or fix the '
      + 'Worker URL in Settings. This view needs a live connection.</p></div>';
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
    confirmModal: confirmModal, loadingPanel: loadingPanel, emptyPanel: emptyPanel,
    errorPanel: errorPanel, offlinePanel: offlinePanel, issueList: issueList,
    reportHtml: reportHtml, pre: pre, kvRows: kvRows,
  };
})();
