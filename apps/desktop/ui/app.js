// KGSM desktop UI shell boot — hash router, health polling, right rail, HUD nav.
// Loads AFTER js/*.js. Exposes globalThis.KgsmApp = {api, go, checkHealth, renderRail}.
(function () {
  'use strict';

  // Every registered view, grouped like the HUD design. [route, label, icon]
  var NAV_GROUPS = [
    {
      title: 'CREATE & BUILD', icon: 'chip', items: [
        ['home', 'Home', 'home'],
        ['new', 'New Game', 'plus'],
        ['blueprint', 'Game Blueprint', 'blueprint'],
        ['forge', 'Asset Forge', 'forge'],
        ['lab', 'Asset Lab', 'lab'],
        ['audio', 'Audio', 'audio'],
      ],
    },
    {
      title: 'WORLD & PLAY', icon: 'gamepad', items: [
        ['levels', 'Level Studio', 'levels'],
        ['settings-game', 'Game Settings', 'sliders'],
        ['playtest', 'Playtest', 'play'],
        ['export', 'Export Center', 'export'],
      ],
    },
    {
      title: 'STUDIO & SYSTEM', icon: 'gear', items: [
        ['validation', 'Validation Center', 'shield'],
        ['settings', 'Settings', 'gear'],
      ],
    },
  ];

  var store = globalThis.KgsmStore;
  var api = globalThis.KgsmApi.createApi(function () { return store.get('workerUrl'); });
  var currentView = null;

  function icon(name) {
    var I = globalThis.KgsmIcons;
    return I ? I.svg(name) : '';
  }

  function go(name) {
    if (!globalThis.KgsmViews.get(name)) name = 'home';
    var target = '#/' + name;
    // Set the hash and let the hashchange listener render exactly once;
    // render synchronously only when the hash is already correct (same-view).
    if (window.location.hash === target) render();
    else window.location.hash = target;
  }

  function fromHash() {
    var m = /^#\/([a-z-]+)/.exec(window.location.hash || '');
    var name = m ? m[1] : 'home';
    return globalThis.KgsmViews.get(name) ? name : 'home';
  }

  // Normalize bogus deep-links (e.g. mockup tabs with no view) to #/home so
  // the URL never disagrees with the rendered view. Uses replaceState to
  // avoid firing a second hashchange render.
  function normalizeHash(view) {
    try {
      if (window.location.hash !== '#/' + view) {
        window.history.replaceState(null, '', '#/' + view);
      }
    } catch (e) { /* non-browser env: ignore */ }
  }

  function render() {
    currentView = fromHash();
    normalizeHash(currentView);
    document.querySelectorAll('#nav button[data-view]').forEach(function (b) {
      var on = b.dataset.view === currentView;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
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

  function now() {
    return (globalThis.performance && performance.now()) || Date.now();
  }

  function checkHealth() {
    var t0 = now();
    return api.health().then(function (h) {
      var wasOnline = store.get('online');
      store.set({ online: true, health: h, latencyMs: Math.round(now() - t0) });
      paintBanner();
      renderRail();
      if (!wasOnline && globalThis.KgsmViews.refreshProjects) {
        // Reconnect: refresh cached data quietly but never full-render —
        // rebuilding the active view would wipe unsubmitted edits.
        globalThis.KgsmViews.refreshProjects()
          .then(renderRail, function () { /* stay quiet */ });
      }
      return h;
    }, function () {
      store.set({ online: false, health: null, latencyMs: null });
      // Offline flip: repaint chrome only (banner/rail/HUD via subscribe);
      // views keep their state and offer Retry once the worker is back.
      paintBanner();
      renderRail();
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
      // True recency order: newest updatedAt first (API order is by name).
      var shown = projects.slice().sort(function (a, b) {
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      }).slice(0, 5);
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
          // Stay in the current workspace view; re-render it in place so the
          // newly selected project loads without yanking the user to Home.
          render();
        });
        li.appendChild(b);
        recent.appendChild(li);
      });
    }
  }

  function buildNav() {
    var nav = document.getElementById('nav');
    nav.innerHTML = '';
    NAV_GROUPS.forEach(function (g) {
      var group = document.createElement('div');
      group.className = 'nav-group';
      var head = document.createElement('div');
      head.className = 'nav-title';
      head.innerHTML = '<span></span>';
      head.firstChild.textContent = g.title;
      head.insertAdjacentHTML('beforeend', icon(g.icon));
      group.appendChild(head);
      g.items.forEach(function (n) {
        if (!globalThis.KgsmViews.get(n[0])) return; // never link an unregistered view
        var b = document.createElement('button');
        b.type = 'button';
        b.dataset.view = n[0];
        b.className = 'glass-nav-item';
        b.innerHTML = '<span class="nav-icon"></span><span class="nav-label"></span>';
        b.querySelector('.nav-icon').innerHTML = icon(n[2]);
        b.querySelector('.nav-label').textContent = n[1];
        b.addEventListener('click', function () { go(n[0]); });
        group.appendChild(b);
      });
      nav.appendChild(group);
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
