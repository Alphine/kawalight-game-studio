// KGSM desktop UI (M1): shell boot — hash router, health polling, right rail.
// Loads AFTER js/*.js. Exposes globalThis.KgsmApp = {api, go, checkHealth, renderRail}.
(function () {
  'use strict';

  var NAV = [
    ['home', 'Home'],
    ['new', 'New Game'],
    ['blueprint', 'Game Blueprint'],
    ['forge', 'Asset Forge'],
    ['lab', 'Asset Lab'],
    ['levels', 'Level Studio'],
    ['settings-game', 'Game Settings'],
    ['playtest', 'Playtest'],
    ['validation', 'Validation Center'],
    ['export', 'Export Center'],
    ['settings', 'Settings'],
  ];

  var store = globalThis.KgsmStore;
  var api = globalThis.KgsmApi.createApi(function () { return store.get('workerUrl'); });
  var currentView = null;

  function go(name) {
    if (!globalThis.KgsmViews.get(name)) name = 'home';
    window.location.hash = '#/' + name;
    render();
  }

  function fromHash() {
    var m = /^#\/([a-z-]+)/.exec(window.location.hash || '');
    var name = m ? m[1] : 'home';
    return globalThis.KgsmViews.get(name) ? name : 'home';
  }

  function render() {
    currentView = fromHash();
    document.querySelectorAll('#nav button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === currentView);
    });
    var root = document.getElementById('viewRoot');
    root.innerHTML = '';
    try {
      globalThis.KgsmViews.get(currentView).render(root);
    } catch (err) {
      root.innerHTML = globalThis.KgsmUi.errorPanel('This view crashed', err,
        '<button type="button" class="btn ghost" onclick="location.reload()">Reload app</button>');
      globalThis.KgsmUi.toast('View error: ' + (err && err.message), 'error');
    }
    paintBanner();
  }

  function paintBanner() {
    var banner = document.getElementById('offlineBanner');
    if (!banner) return;
    if (store.get('online')) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.innerHTML = '<strong>Worker offline.</strong> '
      + '<span>Views show cached/empty states until the worker at '
      + globalThis.KgsmUtil.esc(store.get('workerUrl'))
      + ' responds. <button type="button" class="link" id="retryHealth">Retry now</button></span>';
    document.getElementById('retryHealth').addEventListener('click', function () {
      checkHealth().then(render);
    });
  }

  function checkHealth() {
    return api.health().then(function (h) {
      var wasOnline = store.get('online');
      store.set({ online: true, health: h });
      paintBanner();
      renderRail();
      if (!wasOnline && globalThis.KgsmViews.refreshProjects) {
        globalThis.KgsmViews.refreshProjects().catch(function () { /* stay quiet */ });
        if (currentView) render();
      }
      return h;
    }, function () {
      var wasOnline = store.get('online');
      store.set({ online: false, health: null });
      paintBanner();
      renderRail();
      if (wasOnline && currentView) render();
      return null;
    });
  }

  function renderRail() {
    var U = globalThis.KgsmUtil;
    var projects = store.get('projects') || [];
    var cur = store.current();
    var reports = store.get('lastReports') || {};
    var online = store.get('online');

    var projSlot = document.getElementById('railProject');
    if (projSlot) {
      projSlot.innerHTML = cur
        ? '<strong>' + U.esc(cur.name) + '</strong>'
          + '<span class="pill mini state">' + U.esc(U.stateLabel(cur.state)) + '</span>'
          + '<span class="muted small">' + U.esc(cur.genre || '') + '</span>'
        : '<span class="muted">None selected — pick one on Home.</span>';
    }
    var set = function (id, v) {
      var el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    set('statProjects', String(projects.length));
    set('statReports', String(Object.keys(reports).length));
    set('statState', cur ? U.stateLabel(cur.state) : '—');
    var pill = document.getElementById('workerStatus');
    if (pill) {
      var h = store.get('health');
      pill.className = 'pill ' + (online ? 'green' : 'red');
      pill.textContent = online
        ? 'online · v' + (h.version || '?') + ' · contract ' + (h.contractVersion || '?')
        : 'offline · ' + store.get('workerUrl');
    }
    var recent = document.getElementById('recentList');
    var empty = document.getElementById('recentEmpty');
    if (recent && empty) {
      recent.innerHTML = '';
      var shown = projects.slice(0, 5);
      empty.hidden = shown.length > 0;
      shown.forEach(function (p) {
        var li = document.createElement('li');
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'recent-btn' + (cur && p.id === cur.id ? ' sel' : '');
        b.textContent = p.name;
        b.title = p.id + ' · ' + U.stateLabel(p.state);
        b.addEventListener('click', function () {
          store.set({ currentId: p.id });
          renderRail();
          if (currentView !== 'home') go('home');
          else render();
        });
        li.appendChild(b);
        recent.appendChild(li);
      });
    }
  }

  function buildNav() {
    var nav = document.getElementById('nav');
    nav.innerHTML = '';
    NAV.forEach(function (n) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.view = n[0];
      b.textContent = n[1];
      b.addEventListener('click', function () { go(n[0]); });
      nav.appendChild(b);
    });
  }

  function detectShell() {
    try {
      var invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
      if (typeof invoke === 'function') {
        return invoke('app_version').then(function (v) {
          document.getElementById('appVersion').textContent = 'v' + v + ' (tauri)';
        }, function () {
          document.getElementById('appVersion').textContent = 'v1.0.0 (tauri?)';
        });
      }
    } catch (e) { /* fall through */ }
    document.getElementById('appVersion').textContent = 'v1.0.0 (browser dev)';
    return Promise.resolve();
  }

  globalThis.KgsmApp = { api: api, go: go, checkHealth: checkHealth, renderRail: renderRail };

  buildNav();
  window.addEventListener('hashchange', render);
  store.subscribe(function () { paintBanner(); });
  render();
  renderRail();
  detectShell();
  checkHealth().then(function () {
    if (store.get('online') && globalThis.KgsmViews.refreshProjects) {
      globalThis.KgsmViews.refreshProjects().then(renderRail, function () { /* quiet */ });
    }
  });
  setInterval(checkHealth, 15000);
})();
