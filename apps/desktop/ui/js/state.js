// KGSM UI store: worker URL, online status, project cache, selection.
// Plain browser script; exposes globalThis.KgsmStore.
(function () {
  'use strict';

  var LS_URL = 'kgsm.workerUrl';
  var LS_PROJECT = 'kgsm.currentProjectId';
  var LS_PLAYTEST = 'kgsm.playtestUrl';
  var DEFAULT_URL = 'http://127.0.0.1:4317';

  function lsGet(k, fallback) {
    try {
      var v = window.localStorage.getItem(k);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function lsSet(k, v) {
    try {
      if (v == null) window.localStorage.removeItem(k);
      else window.localStorage.setItem(k, v);
    } catch (e) { /* private mode: ignore */ }
  }

  var state = {
    workerUrl: lsGet(LS_URL, DEFAULT_URL),
    online: false,
    health: null,
    projects: [],
    includeArchived: false,
    currentId: lsGet(LS_PROJECT, null),
    providers: [],
    playtestUrl: lsGet(LS_PLAYTEST, ''),
    lastReports: {}, // key -> {title, report, at}
  };
  var listeners = [];

  function get(k) { return state[k]; }
  function set(patch) {
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    if ('workerUrl' in patch) lsSet(LS_URL, patch.workerUrl);
    if ('currentId' in patch) lsSet(LS_PROJECT, patch.currentId);
    if ('playtestUrl' in patch) lsSet(LS_PLAYTEST, patch.playtestUrl);
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { /* ignore */ } });
  }
  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }
  function current() {
    if (!state.currentId) return null;
    for (var i = 0; i < state.projects.length; i++) {
      if (state.projects[i].id === state.currentId) return state.projects[i];
    }
    return { id: state.currentId, name: '(not in list — refresh)', state: '?' };
  }
  function rememberReport(key, title, report) {
    // Stamp the owning project so views can filter out stale reports from
    // other projects (project-agnostic reports keep pid null).
    state.lastReports[key] = {
      title: title, report: report, at: new Date().toISOString(),
      pid: state.currentId || null,
    };
  }

  globalThis.KgsmStore = {
    get: get, set: set, subscribe: subscribe, current: current,
    rememberReport: rememberReport, DEFAULT_URL: DEFAULT_URL,
  };
})();
