// KGSM worker API client (docs/api-contract.md v1, frozen).
// Plain browser script; exposes globalThis.KgsmApi.createApi(getBaseUrl).
(function () {
  'use strict';

  function ApiError(info) {
    this.name = 'ApiError';
    this.code = info.code || 'unknown';
    this.message = info.message || 'Request failed';
    this.status = info.status || 0;
    if (info.quote) this.quote = info.quote;
    if (info.report) this.report = info.report;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  function createApi(getBaseUrl) {
    function base() {
      return String(getBaseUrl() || 'http://127.0.0.1:4317').replace(/\/+$/, '');
    }

    function request(method, path, body, opts) {
      var url = base() + path;
      var init = {
        method: method,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      var timeoutMs = (opts && opts.timeoutMs) || 60000;
      var ctrl = null;
      var timer = null;
      if (typeof AbortController !== 'undefined') {
        ctrl = new AbortController();
        init.signal = ctrl.signal;
        timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
      }
      return fetch(url, init).then(function (res) {
        if (timer) clearTimeout(timer);
        return res.text().then(function (text) {
          var payload = null;
          try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
          if (res.ok) return payload == null ? {} : payload;
          // Web build: a dead or missing session sends the user back to sign in.
          if (res.status === 401 && typeof location !== 'undefined' && location.pathname.indexOf('/kgsm/app') === 0) {
            location.replace('/kgsm/');
          }
          var U = globalThis.KgsmUtil;
          var parsed = U.parseApiError(payload, res.status, 'Request failed');
          throw new ApiError(parsed);
        });
      }).catch(function (err) {
        if (timer) clearTimeout(timer);
        if (err && err.name === 'ApiError') throw err;
        var msg = (err && err.name === 'AbortError')
          ? 'Worker timed out after ' + Math.round(timeoutMs / 1000) + 's'
          : (typeof location !== 'undefined' && location.pathname.indexOf('/kgsm') === 0)
            ? 'Server unreachable. Check your connection and try again.'
            : 'Worker unreachable at ' + base() + ' (is it running?)';
        throw new ApiError({ code: 'worker-offline', message: msg, status: 0 });
      });
    }

    var V1 = '/api/v1';
    // Binary GET (a build ZIP): returns a Blob; errors still arrive as JSON.
    function download(p, o) {
      var timeoutMs = (o && o.timeoutMs) || 120000;
      return fetch(base() + p, { method: 'GET' }).then(function (res) {
        if (res.ok) return res.blob();
        return res.text().then(function (text) {
          var payload = null;
          try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
          throw new ApiError(globalThis.KgsmUtil.parseApiError(payload, res.status, 'Download failed'));
        });
      }, function () {
        throw new ApiError({ code: 'worker-offline', message: 'Worker unreachable', status: 0 });
      });
    }
    function get(p, o) { return request('GET', p, undefined, o); }
    function post(p, b, o) { return request('POST', p, b, o); }
    function put(p, b, o) { return request('PUT', p, b, o); }
    function patch(p, b, o) { return request('PATCH', p, b, o); }
    function del(p, o) { return request('DELETE', p, undefined, o); }

    return {
      ApiError: ApiError,
      baseUrl: base,
      // §0 Health (contract lists /health relative to /api/v1; fall back to /health).
      health: function () {
        return get(V1 + '/health', { timeoutMs: 5000 }).catch(function (e) {
          if (e && e.code === 'worker-offline') throw e;
          return get('/health', { timeoutMs: 5000 });
        });
      },
      // §1 Projects
      listProjects: function (includeArchived) {
        return get(V1 + '/projects?includeArchived=' + (includeArchived ? 'true' : 'false'));
      },
      createProject: function (name, genre) { return post(V1 + '/projects', { name: name, genre: genre }); },
      getProject: function (id) { return get(V1 + '/projects/' + encodeURIComponent(id)); },
      patchProject: function (id, patchBody) { return patch(V1 + '/projects/' + encodeURIComponent(id), patchBody); },
      duplicateProject: function (id, name) {
        return post(V1 + '/projects/' + encodeURIComponent(id) + '/duplicate', { name: name });
      },
      deleteProject: function (id) { return del(V1 + '/projects/' + encodeURIComponent(id)); },
      transitionProject: function (id, toState, reason) {
        var b = { toState: toState };
        if (reason) b.reason = reason;
        return post(V1 + '/projects/' + encodeURIComponent(id) + '/transition', b);
      },
      markStale: function (id, reason, toState) {
        var b = { reason: reason };
        if (toState) b.toState = toState;
        return post(V1 + '/projects/' + encodeURIComponent(id) + '/mark-stale', b);
      },
      // §2 Blueprints
      validateBlueprint: function (blueprint) { return post(V1 + '/blueprints/validate', { blueprint: blueprint }); },
      getBlueprint: function (id) { return get(V1 + '/projects/' + encodeURIComponent(id) + '/blueprint'); },
      putBlueprint: function (id, blueprint) {
        return put(V1 + '/projects/' + encodeURIComponent(id) + '/blueprint', { blueprint: blueprint });
      },
      assembleBlueprint: function (id, blueprint) {
        var b = blueprint ? { blueprint: blueprint } : {};
        return post(V1 + '/projects/' + encodeURIComponent(id) + '/blueprint/assemble', b, { timeoutMs: 120000 });
      },
      // §3 Configs
      validateConfig: function (genre, config) { return post(V1 + '/configs/validate', { genre: genre, config: config }); },
      getConfig: function (id) { return get(V1 + '/projects/' + encodeURIComponent(id) + '/config'); },
      putConfig: function (id, config) { return put(V1 + '/projects/' + encodeURIComponent(id) + '/config', { config: config }); },
      // §4 Assets
      importAsset: function (id, body) { return post(V1 + '/projects/' + encodeURIComponent(id) + '/assets/import', body); },
      generateAssets: function (id, body) {
        return post(V1 + '/projects/' + encodeURIComponent(id) + '/assets/generate', body, { timeoutMs: 300000 });
      },
      sliceAssets: function (id, body) { return post(V1 + '/projects/' + encodeURIComponent(id) + '/assets/slice', body); },
      inspectAsset: function (id, path) { return post(V1 + '/projects/' + encodeURIComponent(id) + '/assets/inspect', { path: path }); },
      paletteAsset: function (id, path, maxColors) {
        return post(V1 + '/projects/' + encodeURIComponent(id) + '/assets/palette', { path: path, maxColors: maxColors });
      },
      listAssets: function (id, entity) {
        var q = entity ? '?entity=' + encodeURIComponent(entity) : '';
        return get(V1 + '/projects/' + encodeURIComponent(id) + '/assets' + q);
      },
      // §5 Providers
      listProviders: function () { return get(V1 + '/providers'); },
      // §6 Costs
      quoteCosts: function (providerId, nImages, projectId) {
        var b = { providerId: providerId, nImages: nImages };
        if (projectId) b.projectId = projectId;
        return post(V1 + '/costs/quote', b);
      },
      authorizeCosts: function (providerId, nImages, projectId, confirmed) {
        var b = { providerId: providerId, nImages: nImages, confirmed: !!confirmed };
        if (projectId) b.projectId = projectId;
        return post(V1 + '/costs/authorize', b);
      },
      ledger: function (projectId, month) {
        var q = [];
        if (projectId) q.push('projectId=' + encodeURIComponent(projectId));
        if (month) q.push('month=' + encodeURIComponent(month));
        return get(V1 + '/costs/ledger' + (q.length ? '?' + q.join('&') : ''));
      },
      limits: function (projectId) {
        return get(V1 + '/costs/limits' + (projectId ? '?projectId=' + encodeURIComponent(projectId) : ''));
      },
      putLimits: function (scope, cents, projectId) {
        var b = { scope: scope, cents: cents };
        if (projectId) b.projectId = projectId;
        return put(V1 + '/costs/limits', b);
      },
      // §7 Export
      createExport: function (id, config) {
        var b = config ? { config: config } : {};
        return post(V1 + '/projects/' + encodeURIComponent(id) + '/exports', b, { timeoutMs: 300000 });
      },
      listExports: function (id) { return get(V1 + '/projects/' + encodeURIComponent(id) + '/exports'); },
      downloadExport: function (id, file) {
        return download(V1 + '/projects/' + encodeURIComponent(id) + '/exports/' + encodeURIComponent(file));
      },
      godotExport: function (id, config) {
        var b = config ? { config: config } : {};
        return post(V1 + '/projects/' + encodeURIComponent(id) + '/exports/godot', b);
      },
      // §8 Backup / restore
      backupProject: function (id) { return post(V1 + '/projects/' + encodeURIComponent(id) + '/backup', {}); },
      listBackups: function () { return get(V1 + '/backups'); },
      restoreBackup: function (backupId) { return post(V1 + '/projects/restore', { backupId: backupId }); },
      // §9 Audio import
      importAudio: function (id, body) { return post(V1 + '/projects/' + encodeURIComponent(id) + '/audio/import', body); },
      listAudio: function (id) { return get(V1 + '/projects/' + encodeURIComponent(id) + '/audio'); },
      sfxPresets: function () { return get(V1 + '/audio/sfx-presets'); },
      generateSfx: function (id, body) { return post(V1 + '/projects/' + encodeURIComponent(id) + '/audio/generate', body); },
      saveBrowserWav: function (id, body) { return post(V1 + '/projects/' + encodeURIComponent(id) + '/audio/save-wav', body); },
      // §10 Secrets (names only; values are write-only)
      putSecret: function (name, value) { return put(V1 + '/secrets/' + encodeURIComponent(name), { value: value }); },
      deleteSecret: function (name) { return del(V1 + '/secrets/' + encodeURIComponent(name)); },
      listSecrets: function () { return get(V1 + '/secrets'); },
      // §13 Stories (additive: same route/timeout the Forge Story tab used
      // via its bespoke postStory; shared client owns headers/timeouts now).
      generateStory: function (body) {
        return post(V1 + '/stories/generate', body, { timeoutMs: 120000 });
      },
      // AUTO one-click pipeline (additive): POST /projects/auto runs
      // create -> blueprint -> assemble -> validate -> config -> playable ZIP.
      generateAuto: function (body) {
        return post(V1 + '/projects/auto', body, { timeoutMs: 300000 });
      },
    };
  }

  globalThis.KgsmApi = { createApi: createApi, ApiError: ApiError };
})();
