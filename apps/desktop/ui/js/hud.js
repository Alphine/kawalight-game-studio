// KGSM HUD live chrome: header metrics, engine-core widget, footer, modal.
// All values are REAL (store health/latency/selection) or honestly blank —
// never fake numbers. Self-subscribes to KgsmStore; exposes globalThis.KgsmHud.
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function setText(id, text) {
    var n = el(id);
    if (n) n.textContent = text;
  }

  function fmtLatency(ms) {
    return (ms == null || isNaN(ms)) ? '—' : String(Math.round(ms)) + 'ms';
  }

  function snapshot() {
    var S = globalThis.KgsmStore;
    if (!S) return null;
    var cur = null;
    try { cur = S.current(); } catch (e) { cur = null; }
    return {
      online: !!S.get('online'),
      health: S.get('health') || null,
      latencyMs: S.get('latencyMs'),
      project: cur,
    };
  }

  function paintHeader(s) {
    var pill = el('hudMetrics');
    if (!pill) return;
    pill.classList.toggle('is-offline', !s.online);
    if (!s.online) {
      setText('hudLatency', 'OFFLINE');
      setText('hudProject', s.project ? s.project.name : 'NO PROJECT');
      setText('hudWorker', '—');
      return;
    }
    setText('hudLatency', fmtLatency(s.latencyMs));
    setText('hudProject', s.project ? s.project.name : 'NO PROJECT');
    var h = s.health || {};
    setText('hudWorker', 'v' + (h.version || '?') + ' · c' + (h.contractVersion || '?'));
  }

  function paintFooter(s) {
    var dot = el('footDot');
    if (dot) dot.classList.toggle('off', !s.online);
    setText('footCore', s.online ? 'KAWALIGHT HYBRID CORE ONLINE' : 'KAWALIGHT HYBRID CORE OFFLINE');
    setText('footProject', 'ACTIVE PROJECT: ' + (s.project ? s.project.name.toUpperCase() : '—'));
    setText('footLatency', s.online ? fmtLatency(s.latencyMs) : '—');
    var h = s.health || {};
    var ver = el('footVersion');
    if (ver) ver.textContent = s.online ? ('v' + (h.version || '?') + ' · contract ' + (h.contractVersion || '?')) : 'worker unreachable';
  }

  function paintCore(s) {
    setText('coreStatus', s.online ? 'STATUS: ONLINE' : 'STATUS: OFFLINE');
    setText('coreSub', s.online
      ? ('LATENCY ' + fmtLatency(s.latencyMs).toUpperCase())
      : 'START THE LOCAL WORKER');
    var bar = el('coreBar');
    if (bar) {
      bar.classList.toggle('off', !s.online);
      bar.style.width = s.online ? '100%' : '12%';
    }
    var wrap = el('engineCore');
    if (wrap) wrap.classList.toggle('is-offline', !s.online);
  }

  function refresh() {
    var s = snapshot();
    if (!s) return;
    paintHeader(s);
    paintFooter(s);
    paintCore(s);
  }

  // HUD notification modal (title + message + confirm). Not a confirm dialog —
  // use KgsmUi.confirmModal when a boolean answer is needed.
  function notify(title, msg) {
    var modal = el('hud-modal');
    if (!modal) return;
    setText('modal-title', title || 'KAWALIGHT STUDIO NOTIFICATION');
    setText('modal-msg', msg || '');
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    var ok = modal.querySelector('[data-x="ok"]');
    if (ok) ok.focus();
  }

  function closeModal() {
    var modal = el('hud-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }

  function bindModal() {
    var modal = el('hud-modal');
    if (!modal || modal.dataset.bound) return;
    modal.dataset.bound = '1';
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-x="ok"],[data-x="close"]')) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
    });
  }

  function boot() {
    bindModal();
    refresh();
    var S = globalThis.KgsmStore;
    if (S && S.subscribe) S.subscribe(function () { refresh(); });
  }

  globalThis.KgsmHud = { refresh: refresh, notify: notify, closeModal: closeModal };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
