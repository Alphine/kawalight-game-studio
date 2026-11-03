// KGSM views: Playtest + Validation Center + Export Center + Settings.
(function () {
  'use strict';

  function V() { return globalThis.KgsmViews; }
  function U() { return globalThis.KgsmUtil; }
  function UI() { return globalThis.KgsmUi; }
  function S() { return globalThis.KgsmStore; }
  function api() { return globalThis.KgsmApp.api; }
  function I(name) {
    try {
      var K = globalThis.KgsmIcons;
      return K && K.svg ? K.svg(name) : '';
    } catch (e) { return ''; }
  }

  // ---------- Playtest ----------
  var consoleLines = [];
  var lastFrameEl = null;

  function renderPlaytest(root) {
    var p = V().needProject(root);
    if (!p) return;
    var savedUrl = S().get('playtestUrl') || '';
    root.innerHTML =
      '<div class="view-head"><div><p class="hero-tag">' + I('play') + ' WEBGL SANDBOX</p><h2>' + I('play') + ' Playtest</h2>'
      + '<p class="muted">Project: <strong>' + U().esc(p.name) + '</strong> · '
      + U().esc(p.genre) + ' · auto-stage, run, pause, restart, console.</p></div></div>'
      + '<div class="btn-row tablist" role="tablist" aria-label="Playtest modes">'
      + '<button type="button" class="btn primary" data-a="tab-schematic" role="tab" aria-selected="true">' + I('chip') + 'Schematic preview</button> '
      + '<button type="button" class="btn ghost" data-a="tab-realgame" role="tab" aria-selected="false">' + I('gamepad') + 'Real game</button></div>'
      + '<div data-pane="schematic" role="tabpanel">'
      + '<section class="panel glass-panel glass-panel-glow"><div class="view-head"><div><h3>' + I('chip') + ' Auto-stage</h3>'
      + '<p class="muted small">Reads the stored config (assembling the blueprint first when needed), '
      + 'validates it, then loads a live schematic preview drawn from your own level data.</p></div>'
      + '<div><button type="button" class="btn primary" data-a="stage">Auto-stage &amp; preview</button></div></div>'
      + '<div data-slot="steps"></div>'
      + '<div class="btn-row"><button type="button" class="btn ghost" data-a="run" disabled title="Auto-stage a preview first">' + I('play') + 'Run</button> '
      + '<button type="button" class="btn ghost" data-a="pause" disabled title="Auto-stage a preview first">' + I('dot') + 'Pause</button> '
      + '<button type="button" class="btn ghost" data-a="restart" disabled title="Auto-stage a preview first">' + I('refresh') + 'Restart</button></div>'
      + '<p class="muted small">Run/Pause/Restart send a postMessage command to the preview; '
      + 'the schematic preview obeys them and reports back to the console.</p>'
      + '<details class="advanced"><summary>Advanced: load an external staged build</summary>'
      + '<div class="row"><label class="fld grow"><span>Staged-game URL (serve an export or the template dev build, then paste its URL)</span>'
      + '<input data-f="url" value="' + U().esc(savedUrl) + '" placeholder="http://127.0.0.1:1420/index.html"></label>'
      + '<button type="button" class="btn ghost" data-a="load">' + I('folder') + 'Load</button></div></details></section>'
      + '<div class="grid-2"><section class="panel glass-panel"><div class="panel-head"><h3>' + I('gamepad') + ' Preview</h3>'
      + '<button type="button" class="btn ghost small" data-a="console-on" title="Show the game full screen inside a console frame">' + I('gamepad') + 'Console mode</button></div>'
      + '<div class="console-stage" data-slot="stage">'
      + '<div class="console-bar"><span class="console-title">' + I('gamepad') + ' KGSM CONSOLE</span>'
      + '<span class="row"><button type="button" class="btn primary small" data-a="c-run">' + I('play') + 'Run</button> '
      + '<button type="button" class="btn ghost small" data-a="c-pause">' + I('dot') + 'Pause</button> '
      + '<button type="button" class="btn ghost small" data-a="c-restart">' + I('refresh') + 'Restart</button> '
      + '<button type="button" class="btn ghost small" data-a="console-off">' + I('close') + 'Exit</button></span></div>'
      + '<div data-slot="frame">' + UI().emptyPanel('No preview loaded', 'Auto-stage to start.', '', 'empty-preview-light.webp') + '</div></div></section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + I('info') + ' Console</h3>'
      + '<span class="row"><button type="button" class="btn ghost" data-a="copy" title="Copy console lines to the clipboard">Copy</button> '
      + '<button type="button" class="btn ghost" data-a="dl" title="Download console lines as text">Download</button> '
      + '<button type="button" class="btn ghost" data-a="clear">' + I('close') + 'Clear</button></span></div>'
      + '<div data-slot="console" class="console"></div>'
      + '<p class="muted small">Previews post <code>{source:"kgsm-game", level, text}</code> messages here.</p></section></div>'
      + '</div>'
      + '<div data-pane="realgame" role="tabpanel" class="hidden">'
      + '<section class="panel glass-panel glass-panel-glow"><div class="view-head"><div><h3>' + I('gamepad') + ' Real game</h3>'
      + '<p class="muted small">Stages the stored <code>config.json</code> with the shared Phaser exporter, '
      + 'then plays the real build in the frame below. Rebuild after every config change.</p></div>'
      + '<div><button type="button" class="btn primary" data-a="rg-rebuild">' + I('refresh') + 'Rebuild &amp; play</button></div></div>'
      + '<div class="rg-status" data-slot="rg-status"></div>'
      + '<div data-slot="rg-frame">' + UI().emptyPanel('No real-game build staged', 'Press Rebuild & play to stage the stored config and play it here.') + '</div>'
      + '</section></div>';
    paintConsole(root);
    function frame() { return root.querySelector('[data-slot="frame"] iframe'); }
    function send(cmd) {
      var f = frame();
      if (!f) { UI().toast('Load a preview first.', 'error'); return; }
      try { f.contentWindow.postMessage({ source: 'kgsm-shell', command: cmd }, '*'); }
      catch (e) { UI().toast('Could not message the preview: ' + e.message, 'error'); }
    }
    function loadFrame(src, label, isHtml) {
      var slot = root.querySelector('[data-slot="frame"]');
      slot.innerHTML = '';
      var f = document.createElement('iframe');
      f.setAttribute('title', label || 'Game preview');
      // No allow-same-origin: the blob-URL preview (built from config data)
      // stays cross-origin so it cannot reach the shell DOM/storage; the
      // postMessage bridge below is the only channel.
      f.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
      var t0 = Date.now();
      f.addEventListener('load', function () {
        pushConsole('info', 'preview loaded in ' + (Date.now() - t0) + ' ms');
        UI().toast('Preview loaded.', 'success');
        ['run', 'pause', 'restart'].forEach(function (a) {
          var b = root.querySelector('[data-a="' + a + '"]');
          if (b) { b.disabled = false; b.removeAttribute('title'); }
        });
        paintConsole(root);
      });
      f.addEventListener('error', function () {
        pushConsole('error', 'preview failed to load');
        paintConsole(root);
      });
      if (isHtml) f.srcdoc = src; else f.src = src;
      slot.appendChild(f);
      lastFrameEl = f;
    }
    root.querySelector('[data-a="load"]').addEventListener('click', function () {
      var url = root.querySelector('[data-f="url"]').value.trim();
      if (!url) { UI().toast('Enter a staged-game URL first.', 'error'); return; }
      S().set({ playtestUrl: url });
      pushConsole('info', 'loading external build: ' + url);
      paintConsole(root);
      loadFrame(url, 'Staged game preview');
    });
    // Console mode: the stage becomes a full-screen console; the frame itself is
    // never moved, so the preview keeps running while the layout changes.
    var stage = root.querySelector('[data-slot="stage"]');
    function setConsole(on) {
      stage.classList.toggle('is-console', on);
      if (on) document.addEventListener('keydown', onConsoleKey);
      else document.removeEventListener('keydown', onConsoleKey);
    }
    function onConsoleKey(e) { if (e.key === 'Escape') setConsole(false); }
    root.querySelector('[data-a="console-on"]').addEventListener('click', function () { setConsole(true); });
    root.querySelector('[data-a="console-off"]').addEventListener('click', function () { setConsole(false); });
    root.querySelector('[data-a="c-run"]').addEventListener('click', function () { root.querySelector('[data-a="run"]').click(); });
    root.querySelector('[data-a="c-pause"]').addEventListener('click', function () { root.querySelector('[data-a="pause"]').click(); });
    root.querySelector('[data-a="c-restart"]').addEventListener('click', function () { root.querySelector('[data-a="restart"]').click(); });
    root.querySelector('[data-a="run"]').addEventListener('click', function () { send('run'); });
    root.querySelector('[data-a="pause"]').addEventListener('click', function () { send('pause'); });
    root.querySelector('[data-a="restart"]').addEventListener('click', function () {
      var f = frame();
      if (!f) { UI().toast('Load a preview first.', 'error'); return; }
      try {
        f.contentWindow.postMessage({ source: 'kgsm-shell', command: 'restart' }, '*');
        pushConsole('info', 'restart command sent');
      } catch (e) { UI().toast('Could not message the preview.', 'error'); }
      paintConsole(root);
    });
    root.querySelector('[data-a="stage"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () { return autoStage(root, p, loadFrame); }, 'Staging…');
    });
    function selectPlaytestTab(which) {
      var schematic = which === 'schematic';
      root.querySelector('[data-pane="schematic"]').classList.toggle('hidden', !schematic);
      root.querySelector('[data-pane="realgame"]').classList.toggle('hidden', schematic);
      var ts = root.querySelector('[data-a="tab-schematic"]');
      var tg = root.querySelector('[data-a="tab-realgame"]');
      ts.className = 'btn ' + (schematic ? 'primary' : 'ghost');
      tg.className = 'btn ' + (schematic ? 'ghost' : 'primary');
      ts.setAttribute('aria-selected', schematic ? 'true' : 'false');
      tg.setAttribute('aria-selected', schematic ? 'false' : 'true');
    }
    root.querySelector('[data-a="tab-schematic"]').addEventListener('click', function () { selectPlaytestTab('schematic'); });
    root.querySelector('[data-a="tab-realgame"]').addEventListener('click', function () { selectPlaytestTab('realgame'); });
    root.querySelector('[data-a="rg-rebuild"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () { return rebuildRealGame(root, p); }, 'Staging…');
    });
    root.querySelector('[data-a="clear"]').addEventListener('click', function () {
      consoleLines = [];
      paintConsole(root);
    });
    root.querySelector('[data-a="copy"]').addEventListener('click', function () {
      copyConsole();
    });
    root.querySelector('[data-a="dl"]').addEventListener('click', function () {
      downloadConsole(p);
    });
  }

  function consoleText() {
    return consoleLines.map(function (l) {
      return l.at + ' [' + l.level + '] ' + l.text;
    }).join('\n');
  }

  function copyConsole() {
    if (!consoleLines.length) { UI().toast('Console is empty — nothing to copy.', 'info'); return; }
    var text = consoleText();
    function done() { UI().toast(consoleLines.length + ' console line(s) copied.', 'success'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      done();
    } catch (e) {
      UI().toast('Copy failed: ' + e.message, 'error');
    }
  }

  function downloadConsole(p) {
    if (!consoleLines.length) { UI().toast('Console is empty — nothing to download.', 'info'); return; }
    try {
      var blob = new Blob([consoleText()], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'playtest-console-' + (p && p.id ? p.id : 'log') + '.txt';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { URL.revokeObjectURL(a.href); } catch (e) { /* ignore */ }
        a.remove();
      }, 1000);
      UI().toast(consoleLines.length + ' console line(s) downloaded.', 'success');
    } catch (e) {
      UI().toast('Download failed: ' + e.message, 'error');
    }
  }

  // End-to-end from a project: config (assemble when missing) → validate →
  // schematic preview in the iframe. Blob URLs are session-only, so the
  // manual-URL field keeps the last external URL untouched.
  function autoStage(root, p, loadFrame) {
    var steps = root.querySelector('[data-slot="steps"]');
    function step(text, cls) {
      if (steps) {
        steps.innerHTML += '<p class="step-line ' + (cls || '') + '">' + U().esc(text) + '</p>';
      }
      pushConsole(cls === 'err' ? 'error' : 'info', text);
      paintConsole(root);
    }
    if (steps) steps.innerHTML = '';
    if (!S().get('online')) {
      step('Worker offline — reconnect before staging.', 'err');
      UI().toast('Worker offline.', 'error');
      return Promise.resolve();
    }
    step('1/3 reading config.json for "' + p.name + '"…');
    return api().getConfig(p.id).then(function (res) {
      step('config.json found.');
      return res.config;
    }, function (err) {
      if (!err || err.code !== 'config-not-found') throw err;
      step('no config.json — assembling the stored blueprint…');
      return api().assembleBlueprint(p.id).then(function (res) {
        S().rememberReport('assemble', 'Assembly', res.report);
        step('assembled ' + p.genre + ' config.');
        if (V().refreshProjects) V().refreshProjects();
        return res.config;
      }, function (aerr) {
        if (aerr && aerr.code === 'blueprint-not-found') {
          step('no blueprint stored — run the New Game wizard first.', 'err');
          UI().toast('No blueprint stored. Create one with the New Game wizard.', 'error');
          return null;
        }
        throw aerr;
      });
    }).then(function (config) {
      if (!config) return;
      step('2/3 validating ' + p.genre + ' config…');
      return api().validateConfig(p.genre, config).then(function (res) {
        var rep = U().summarizeReport(res.report);
        if (rep.ok) {
          step('config valid (' + rep.warnings.length + ' warning(s)).');
        } else {
          step('config has ' + rep.errors.length + ' error(s) — previewing anyway; fix in Level Studio.', 'err');
        }
        step('3/3 building schematic preview…');
        // srcdoc, not a blob: URL: the studio CSP has no blob: in frame-src.
        loadFrame(U().buildPreviewPage(config, p.name), 'Schematic preview', true);
        step('preview staged — use Run / Pause / Restart above.');
      });
    }).catch(function (err) {
      step('staging failed: ' + UI().errorText(err), 'err');
      UI().toast(UI().errorText(err), 'error');
    });
  }

  // ---------- Playtest: Real game ----------
  // Bespoke fetch (api.js has no playtest helper and is owned elsewhere;
  // same header/timeout shape the shared client uses, errors normalized
  // with U().parseApiError like the old Forge story-tab postStory was).
  function playtestPost(projectId) {
    var base = api().baseUrl();
    var url = base + '/api/v1/projects/' + encodeURIComponent(projectId) + '/playtest';
    var timer = null;
    var init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    };
    if (typeof AbortController !== 'undefined') {
      var ctrl = new AbortController();
      init.signal = ctrl.signal;
      timer = setTimeout(function () { ctrl.abort(); }, 120000);
    }
    return fetch(url, init).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (text) {
        var payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
        if (res.ok) return payload == null ? {} : payload;
        throw U().parseApiError(payload, res.status, 'Request failed');
      });
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.code) throw err;
      var msg = (err && err.name === 'AbortError')
        ? 'Worker timed out after 120s'
        : 'Worker unreachable at ' + base + ' (is it running?)';
      throw { code: 'worker-offline', message: msg, status: 0 };
    });
  }

  function rebuildRealGame(root, p) {
    var status = root.querySelector('[data-slot="rg-status"]');
    var slot = root.querySelector('[data-slot="rg-frame"]');
    if (!S().get('online')) {
      if (slot) slot.innerHTML = UI().offlinePanel();
      UI().toast('Worker offline.', 'error');
      return Promise.resolve();
    }
    if (slot) slot.innerHTML = UI().loadingPanel('Staging the real-game build…');
    if (status) status.innerHTML = '';
    return playtestPost(p.id).then(function (res) {
      if (!res || typeof res.url !== 'string' || res.url.charAt(0) !== '/') {
        throw { code: 'internal', message: 'Worker returned an unexpected playtest response.', status: 0 };
      }
      if (status) {
        status.innerHTML = '<p><span class="pill green">staged</span> <span class="muted">'
          + U().esc(U().fmtDate(res.stagedAt)) + ' · <code>' + U().esc(res.url) + '</code></span></p>';
      }
      loadGameFrame(root, api().baseUrl() + res.url);
      UI().toast('Real-game build staged.', 'success');
    }).catch(function (err) {
      var hint = '';
      if (err && err.code === 'config-not-found') {
        hint = '<p class="muted">This project has no stored <code>config.json</code> yet — '
          + 'assemble the stored blueprint first (open Level Studio and save, or auto-stage the '
          + 'Schematic preview tab), or run the New Game wizard, then press Rebuild &amp; play again.</p>';
      } else if (err && err.code === 'export-error') {
        hint = '<p class="muted">The stored config failed validation/staging — fix it in Level Studio, then rebuild.</p>';
      } else if (err && err.code === 'internal') {
        hint = '<p class="muted">The stored <code>config.json</code> is corrupt — re-save it in Level Studio (or re-run the New Game wizard), then rebuild.</p>';
      }
      if (err && err.code === 'worker-offline') {
        if (slot) slot.innerHTML = UI().offlinePanel();
      } else if (slot) {
        slot.innerHTML = UI().errorPanel('Real-game staging failed', err,
          '<div class="btn-row"><button type="button" class="btn ghost" data-a="rg-retry">' + I('refresh') + 'Retry</button></div>') + hint;
        var rb = slot.querySelector('[data-a="rg-retry"]');
        if (rb) rb.addEventListener('click', function () {
          var btn = root.querySelector('[data-a="rg-rebuild"]');
          if (btn) btn.click();
        });
      }
      UI().toast(UI().errorText(err), 'error');
    });
  }

  function loadGameFrame(root, src) {
    var slot = root.querySelector('[data-slot="rg-frame"]');
    if (!slot) return;
    // Fresh element per rebuild: drops the previous document and reloads the
    // staged build cleanly even though the URL itself is unchanged.
    slot.innerHTML = '';
    var f = document.createElement('iframe');
    f.setAttribute('title', 'Real game');
    // No sandbox: this page is already cross-origin to the shell by URL, and
    // a sandbox without allow-same-origin would break the game's own
    // same-origin module/asset loads.
    f.className = 'game-frame';
    var t0 = Date.now();
    f.addEventListener('load', function () {
      var status = root.querySelector('[data-slot="rg-status"]');
      if (status) {
        status.innerHTML += '<p class="muted small">frame loaded in ' + (Date.now() - t0)
          + ' ms — click the game, then play with the keyboard.</p>';
      }
    });
    f.src = src;
    slot.appendChild(f);
  }

  function consoleErrorCount() {
    return consoleLines.filter(function (l) { return l.level === 'error'; }).length;
  }

  function pushConsole(level, text) {
    consoleLines.push({ at: new Date().toISOString(), level: level, text: String(text).slice(0, 2000) });
    if (consoleLines.length > 200) consoleLines.splice(0, consoleLines.length - 200);
  }

  function paintConsole(root) {
    var slot = root.querySelector('[data-slot="console"]');
    if (!slot) return;
    if (!consoleLines.length) {
      slot.innerHTML = '<p class="muted">Console is empty — game messages and load events appear here.</p>';
      return;
    }
    slot.innerHTML = consoleLines.map(function (l) {
      return '<div class="clog ' + U().esc(l.level) + '"><span class="ts">'
        + U().esc(l.at.slice(11, 19)) + '</span> ' + U().esc(l.text) + '</div>';
    }).join('');
    slot.scrollTop = slot.scrollHeight;
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.source !== 'kgsm-game') return;
    // Accept console lines only from the staged preview frame — never from
    // arbitrary framed/opener pages (works for blob + external URLs alike).
    try {
      if (!lastFrameEl || !lastFrameEl.isConnected || ev.source !== lastFrameEl.contentWindow) return;
    } catch (e) { return; }
    pushConsole(d.level || 'info', d.text || '(empty message)');
    var slot = document.querySelector('[data-slot="console"]');
    if (slot) {
      var root = document.getElementById('viewRoot');
      if (root) paintConsole(root);
    }
  });

  // ---------- Validation Center ----------
  function renderValidation(root) {
    var p = V().needProject(root);
    if (!p) return;
    root.innerHTML =
      '<div class="view-head"><div><p class="hero-tag">' + I('shield') + ' STUDIO &amp; SYSTEM</p><h2>' + I('shield') + ' Validation Center</h2>'
      + '<p class="muted">Project: <strong>' + U().esc(p.name) + '</strong> · asset, config, runtime, export, security reports.</p></div>'
      + '<div class="row"><button type="button" class="btn primary" data-a="run-all">Run all checks</button></div></div>'
      + '<div class="grid-2"><section class="panel glass-panel glass-panel-glow"><div class="panel-head"><h3>' + I('check') + ' Checks</h3></div>'
      + '<div class="btn-col">'
      + '<button type="button" class="btn ghost" data-a="c-blueprint">Validate stored blueprint</button>'
      + '<button type="button" class="btn ghost" data-a="c-config">Validate stored config</button>'
      + '<button type="button" class="btn ghost" data-a="c-assets">Inspect all assets</button>'
      + '<button type="button" class="btn ghost" data-a="c-exports">List exports (export health)</button>'
      + '<button type="button" class="btn ghost danger" data-a="c-cancel" title="Stop a running asset inspection">Cancel inspection</button>'
      + '</div>'
      + '<p class="muted small" data-slot="inspect-status" aria-live="polite"></p>'
      + '<p class="muted small">Runtime smoke: manual — exercise the Playtest preview and watch its console; '
      + 'automated template smoke tests run out-of-band via pytest/JS (FR-020), not from this view.</p>'
      + '<p class="muted small">Live signal: <strong>' + consoleErrorCount()
      + '</strong> Playtest console error(s) this session.</p></section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + I('shield') + ' Security notes (design claims — not live checks)</h3></div>'
      + '<ul class="notes"><li>Secrets never enter builds, ZIPs, manifests, or logs (NFR-002) — exports are secret-scanned and fail closed.</li>'
      + '<li>Billable operations always pass quote → authorize (NFR-011).</li>'
      + '<li>Generation/export failures never corrupt the project or last good build (NFR-003).</li></ul></section></div>'
      + '<div data-slot="reports"></div>';
    paintRemembered(root);
    root.querySelector('[data-a="c-blueprint"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () {
        return api().getBlueprint(p.id).then(function (stored) {
          return api().validateBlueprint(stored.blueprint).then(function (res) {
            S().rememberReport('validation-blueprint', 'Stored blueprint', res.report);
            paintRemembered(root);
            UI().toast(res.report.ok ? 'Blueprint valid.' : 'Blueprint has errors.', res.report.ok ? 'success' : 'error');
          });
        });
      }, 'Checking…');
    });
    root.querySelector('[data-a="c-config"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () {
        return api().getConfig(p.id).then(function (stored) {
          return api().validateConfig(p.genre, stored.config).then(function (res) {
            S().rememberReport('validation-config', 'Stored config', res.report);
            paintRemembered(root);
            UI().toast(res.report.ok ? 'Config valid.' : 'Config has errors.', res.report.ok ? 'success' : 'error');
          });
        });
      }, 'Checking…');
    });
    root.querySelector('[data-a="c-assets"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () { return inspectAll(p, root); }, 'Inspecting…');
    });
    root.querySelector('[data-a="c-cancel"]').addEventListener('click', function () {
      inspectCancelled = true;
      UI().toast('Inspection will stop after the current asset.', 'info');
    });
    root.querySelector('[data-a="c-exports"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () {
        return api().listExports(p.id).then(function (res) {
          var ex = res.exports || [];
          S().rememberReport('validation-exports', 'Export health', {
            ok: true,
            errors: [],
            warnings: ex.length ? [] : [{ level: 'warning', code: 'no-exports', message: 'No builds yet — run Export Center.', path: '' }],
          });
          paintRemembered(root);
          UI().toast(ex.length + ' build(s) on disk.', 'success');
        });
      }, 'Checking…');
    });
    root.querySelector('[data-a="run-all"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () {
        var chain = Promise.resolve();
        ['c-blueprint', 'c-config', 'c-assets', 'c-exports'].forEach(function (a) {
          chain = chain.then(function () {
            return root.querySelector('[data-a="' + a + '"]').click
              ? dispatchCheck(root, p, a) : null;
          });
        });
        return chain.then(function () { UI().toast('All checks finished.', 'success'); });
      }, 'Running…');
    });
  }

  function dispatchCheck(root, p, which) {
    if (which === 'c-blueprint') {
      return api().getBlueprint(p.id).then(function (s) { return api().validateBlueprint(s.blueprint); })
        .then(function (res) { S().rememberReport('validation-blueprint', 'Stored blueprint', res.report); paintRemembered(root); })
        .catch(function (err) { S().rememberReport('validation-blueprint', 'Stored blueprint', toReport(err)); paintRemembered(root); });
    }
    if (which === 'c-config') {
      return api().getConfig(p.id).then(function (s) { return api().validateConfig(p.genre, s.config); })
        .then(function (res) { S().rememberReport('validation-config', 'Stored config', res.report); paintRemembered(root); })
        .catch(function (err) { S().rememberReport('validation-config', 'Stored config', toReport(err)); paintRemembered(root); });
    }
    if (which === 'c-assets') return inspectAll(p, root);
    if (which === 'c-exports') {
      return api().listExports(p.id).then(function (res) {
        var ex = res.exports || [];
        S().rememberReport('validation-exports', 'Export health', {
          ok: true, errors: [],
          warnings: ex.length ? [] : [{ level: 'warning', code: 'no-exports', message: 'No builds yet.', path: '' }],
        });
        paintRemembered(root);
      }).catch(function (err) { S().rememberReport('validation-exports', 'Export health', toReport(err)); paintRemembered(root); });
    }
    return Promise.resolve();
  }

  function toReport(err) {
    return {
      ok: false,
      errors: [{ level: 'error', code: (err && err.code) || 'error', message: UI().errorText(err), path: '' }],
      warnings: [],
    };
  }

  var inspectCancelled = false;

  function inspectAll(p, root) {
    inspectCancelled = false;
    function status(text) {
      var slot = root.querySelector('[data-slot="inspect-status"]');
      if (slot) slot.textContent = text || '';
    }
    return api().listAssets(p.id).then(function (res) {
      var assets = res.assets || [];
      if (!assets.length) {
        S().rememberReport('validation-assets', 'Asset inspection', {
          ok: true, errors: [],
          warnings: [{ level: 'warning', code: 'no-assets', message: 'No assets to inspect.', path: '' }],
        });
        paintRemembered(root);
        return;
      }
      var errors = [];
      var warnings = [];
      var done = 0;
      var chain = Promise.resolve();
      assets.forEach(function (a) {
        chain = chain.then(function () {
          if (inspectCancelled) return;
          status('Inspecting ' + (done + 1) + '/' + assets.length + '… ' + a.path);
          return api().inspectAsset(p.id, a.path).then(function (r) {
            (r.errors || []).forEach(function (m) {
              errors.push({ level: 'error', code: 'asset', message: m, path: a.path });
            });
            (r.warnings || []).forEach(function (m) {
              warnings.push({ level: 'warning', code: 'asset', message: m, path: a.path });
            });
          }).catch(function (err) {
            errors.push({ level: 'error', code: err.code || 'inspect-failed', message: UI().errorText(err), path: a.path });
          }).then(function () {
            done += 1;
            status(inspectCancelled ? '' : 'Inspecting ' + done + '/' + assets.length + '…');
          });
        });
      });
      return chain.then(function () {
        if (inspectCancelled) {
          warnings.push({
            level: 'warning', code: 'cancelled',
            message: 'Inspection cancelled after ' + done + '/' + assets.length + ' assets.', path: '',
          });
        }
        status('');
        S().rememberReport('validation-assets', 'Asset inspection (' + done + '/' + assets.length + ' files)', {
          ok: errors.length === 0, errors: errors, warnings: warnings,
        });
        paintRemembered(root);
      });
    }).catch(function (err) {
      status('');
      S().rememberReport('validation-assets', 'Asset inspection', toReport(err));
      paintRemembered(root);
    });
  }

  function paintRemembered(root) {
    var slot = root.querySelector('[data-slot="reports"]');
    if (!slot) return;
    var R = S().get('lastReports') || {};
    var cur = S().get('currentId') || null;
    // Show only this project's reports (plus project-agnostic ones) so
    // switching projects never shows another project's stale results.
    var keys = Object.keys(R).filter(function (k) {
      var pid = R[k].pid;
      return pid == null || pid === cur;
    });
    if (!keys.length) {
      slot.innerHTML = UI().emptyPanel('No reports yet',
        'Run a check above — results land here. (Reports from other projects are hidden.)');
      return;
    }
    slot.innerHTML = keys.map(function (k) {
      return UI().reportHtml(R[k].report, R[k].title + ' · ' + U().fmtDate(R[k].at));
    }).join('');
  }

  // ---------- Export Center ----------
  function renderExport(root) {
    var p = V().needProject(root);
    if (!p) return;
    root.innerHTML =
      '<div class="view-head"><div><p class="hero-tag">' + I('export') + ' MULTI-PLATFORM BUILD</p><h2>' + I('export') + ' Export Center</h2>'
      + '<p class="muted">Project: <strong>' + U().esc(p.name) + '</strong> · HTML5 package, Phaser source, manifest.</p></div></div>'
      + '<div class="grid-2"><section class="panel glass-panel glass-panel-glow"><div class="panel-head"><h3>' + I('export') + ' Packages</h3></div>'
      + '<div class="btn-col"><button type="button" class="btn primary" data-a="package">Build playable + source ZIPs</button> '
      + '<button type="button" class="btn ghost" data-a="godot">Export Godot 4 project</button></div>'
      + '<p class="muted small">Builds land in <code>builds/</code> atomically; failures never touch the last good build (NFR-003).</p>'
      + '<div data-slot="pkg"></div></section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + I('folder') + ' Builds on disk</h3>'
      + '<button type="button" class="btn ghost" data-a="refresh">' + I('refresh') + 'Refresh</button></div>'
      + '<div data-slot="builds">' + UI().loadingPanel('Loading builds…') + '</div></section></div>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + I('blueprint') + ' Manifest</h3></div><div data-slot="manifest">'
      + UI().emptyPanel('No manifest viewed yet', 'Build a package to see its kgsm-manifest.json here.') + '</div></section>'
      + '<div class="grid-2"><section class="panel glass-panel" data-admin-only><div class="panel-head"><h3>' + I('plus') + ' Backup</h3></div>'
      + '<div class="btn-col"><button type="button" class="btn ghost" data-a="backup">Back up this project</button></div>'
      + '<div data-slot="backup"></div></section>'
      + '<section class="panel glass-panel" data-admin-only><div class="panel-head"><h3>' + I('refresh') + ' Restore</h3></div>'
      + '<button type="button" class="btn ghost" data-a="refresh-b">' + I('refresh') + 'Refresh</button></div>'
      + '<div data-slot="backups">' + UI().loadingPanel('Loading backups…') + '</div></section></div>';
    root.querySelector('[data-a="package"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () {
        return api().createExport(p.id).then(function (res) {
          root.querySelector('[data-slot="pkg"]').innerHTML =
            '<p><span class="pill green">built</span></p><ul class="asset-list">'
            + '<li><code>' + U().esc(res.playable) + '</code></li>'
            + '<li><code>' + U().esc(res.source) + '</code></li></ul>'
            + ((res.warnings || []).length ? '<p class="muted">warnings: ' + U().esc(res.warnings.join('; ')) + '</p>' : '');
          var m = root.querySelector('[data-slot="manifest"]');
          m.innerHTML = '';
          m.appendChild(UI().pre(JSON.stringify(res.manifest, null, 2)));
          UI().toast('Export built.', 'success');
          loadBuilds(root, p);
          if (V().refreshProjects) V().refreshProjects();
        }, function (err) {
          if (err && err.report) {
            root.querySelector('[data-slot="pkg"]').innerHTML = UI().reportHtml(err.report, 'Export blocked by validation');
          }
          throw err; // UI().busy owns the error toast
        });
      }, 'Building…');
    });
    root.querySelector('[data-a="godot"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () {
        return api().godotExport(p.id).then(function (res) {
          root.querySelector('[data-slot="pkg"]').innerHTML =
            '<p><span class="pill green">built</span></p><ul class="asset-list">'
            + '<li><code>' + U().esc(res.godot) + '</code></li></ul>'
            + ((res.warnings || []).length ? '<p class="muted">warnings: ' + U().esc(res.warnings.join('; ')) + '</p>' : '');
          var m = root.querySelector('[data-slot="manifest"]');
          m.innerHTML = '';
          m.appendChild(UI().pre(JSON.stringify(res.manifest, null, 2)));
          UI().toast('Godot 4 project exported.', 'success');
          loadBuilds(root, p);
          if (V().refreshProjects) V().refreshProjects();
        }, function (err) {
          if (err && err.report) {
            root.querySelector('[data-slot="pkg"]').innerHTML = UI().reportHtml(err.report, 'Export blocked by validation');
          }
          throw err; // UI().busy owns the error toast
        });
      }, 'Building…');
    });
    root.querySelector('[data-a="refresh"]').addEventListener('click', function () { loadBuilds(root, p); });
    root.querySelector('[data-a="backup"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () {
        return api().backupProject(p.id).then(function (res) {
          root.querySelector('[data-slot="backup"]').innerHTML =
            '<table class="kv"><tbody>' + UI().kvRows({
              backupId: res.backupId, bytes: U().fmtBytes(res.bytes),
              sha256: String(res.sha256).slice(0, 16) + '…', created: U().fmtDate(res.createdAt),
            }) + '</tbody></table>';
          UI().toast('Backup ' + res.backupId + ' written.', 'success');
          loadBackups(root);
        });
      }, 'Backing up…');
    });
    root.querySelector('[data-a="refresh-b"]').addEventListener('click', function () { loadBackups(root); });
    loadBuilds(root, p);
    loadBackups(root);
  }

  function loadBuilds(root, p) {
    var slot = root.querySelector('[data-slot="builds"]');
    if (!slot) return;
    if (!S().get('online')) { slot.innerHTML = UI().offlinePanel(); return; }
    api().listExports(p.id).then(function (res) {
      if (!slot.isConnected) return;
      var ex = res.exports || [];
      if (!ex.length) {
        slot.innerHTML = UI().emptyPanel('No builds yet', 'Build a package to produce playable + source ZIPs.');
        return;
      }
      slot.innerHTML = '<ul class="asset-list">' + ex.map(function (b) {
        var name = b.file.split('/').pop();
        return '<li><code>' + U().esc(b.file) + '</code> <span class="muted">'
          + U().esc(U().fmtBytes(b.bytes)) + ' · ' + U().esc(U().fmtDate(b.createdAt)) + '</span> '
          + '<button type="button" class="btn ghost" data-a="download" data-file="' + U().esc(name) + '">Download</button></li>';
      }).join('') + '</ul>';
      // Assigned, not addEventListener: loadBuilds re-renders this slot and must not stack handlers.
      slot.onclick = function (e) {
        var btn = e.target.closest ? e.target.closest('[data-a="download"]') : null;
        if (!btn) return;
        var name = btn.getAttribute('data-file');
        UI().busy(btn, function () {
          return api().downloadExport(p.id, name).then(function (blob) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 0);
          });
        }, 'Downloading…');
      };
    }, function (err) {
      if (!slot.isConnected) return;
      slot.innerHTML = UI().errorPanel('Could not list builds', err,
        '<button type="button" class="btn ghost" data-a="retry">' + I('refresh') + 'Retry</button>');
      var rb = slot.querySelector('[data-a="retry"]');
      if (rb) rb.addEventListener('click', function () { loadBuilds(root, p); });
    });
  }

  function loadBackups(root) {
    if (document.body.classList.contains('not-admin')) return;
    var slot = root.querySelector('[data-slot="backups"]');
    if (!slot) return;
    if (!S().get('online')) { slot.innerHTML = UI().offlinePanel(); return; }
    api().listBackups().then(function (res) {
      if (!slot.isConnected) return;
      var bs = res.backups || [];
      if (!bs.length) {
        slot.innerHTML = UI().emptyPanel('No backups yet', 'Back up a project to create a restore point.');
        return;
      }
      slot.innerHTML = '<ul class="asset-list">' + bs.map(function (b) {
        return '<li><code>' + U().esc(b.backupId) + '</code> <span class="muted">'
          + U().esc(U().fmtBytes(b.bytes)) + ' · ' + U().esc(U().fmtDate(b.createdAt)) + '</span> '
          + '<button type="button" class="btn ghost" data-b="' + U().esc(b.backupId) + '">' + I('refresh') + 'Restore</button></li>';
      }).join('') + '</ul>';
      slot.querySelectorAll('[data-b]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          UI().confirmModal('Restore backup?',
            'Restore ' + btn.dataset.b + ' (a new project id is assigned on collision).',
            'Restore').then(function (ok) {
            if (!ok) return;
            api().restoreBackup(btn.dataset.b).then(function (res) {
              UI().toast('Restored "' + res.project.name + '"' + (res.reassignedId ? ' (new id assigned).' : '.'), 'success');
              S().set({ currentId: res.project.id });
              if (V().refreshProjects) V().refreshProjects();
            }, function (e) { UI().toast(UI().errorText(e), 'error'); });
          });
        });
      });
    }, function (err) {
      if (!slot.isConnected) return;
      slot.innerHTML = UI().errorPanel('Could not list backups', err,
        '<button type="button" class="btn ghost" data-a="retry">' + I('refresh') + 'Retry</button>');
      var rb = slot.querySelector('[data-a="retry"]');
      if (rb) rb.addEventListener('click', function () { loadBackups(root); });
    });
  }

  // ---------- Settings ----------
  // Meta/Llama host presets (docs/providers.md §"Host presets"). Values only
  // prefill the form below; saving stores them as llama_* secrets.
  var LLAMA_PRESETS = {
    together: {
      label: 'Together AI (text + images, the defaults)', base: 'https://api.together.xyz/v1',
      text: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', image: 'black-forest-labs/FLUX.1-schnell',
      keyUrl: 'https://api.together.xyz/settings/api-keys',
      note: 'One key covers text + images. Only the key is required — the rest are already the defaults.',
    },
    groq: {
      label: 'Groq (text only)', base: 'https://api.groq.com/openai/v1',
      text: 'llama-3.3-70b-versatile', image: '',
      keyUrl: 'https://console.groq.com/keys',
      note: 'Text only: Groq has no images endpoint, so llama-image calls fail here. Free tier friendly.',
    },
    openrouter: {
      label: 'OpenRouter (text only)', base: 'https://openrouter.ai/api/v1',
      text: 'meta-llama/llama-3.3-70b-instruct', image: '',
      keyUrl: 'https://openrouter.ai/keys',
      note: 'Text via chat completions. Use Together for images.',
    },
    huggingface: {
      label: 'Hugging Face (text only)', base: 'https://router.huggingface.co/v1',
      text: 'meta-llama/Llama-3.3-70B-Instruct', image: '',
      keyUrl: 'https://huggingface.co/settings/tokens',
      note: 'Token needs Inference permission; gated Llama models need license acceptance.',
    },
  };

  function renderSettings(root) {
    root.innerHTML =
      '<div class="view-head"><div><p class="hero-tag">' + I('gear') + ' STUDIO &amp; SYSTEM</p><h2>' + I('gear') + ' Settings</h2>'
      + '<p class="muted">Worker connection, providers, secret names, spend limits.</p></div></div>'
      + '<div class="grid-2"><section class="panel glass-panel glass-panel-glow"><div class="panel-head"><h3>' + I('chip') + ' Worker connection</h3></div>'
      + '<label class="fld"><span>Worker base URL</span><input data-f="url" value="' + U().esc(S().get('workerUrl')) + '"></label>'
      + '<div class="btn-row"><button type="button" class="btn primary" data-a="save-url">Save + reconnect</button> '
      + '<button type="button" class="btn ghost" data-a="ping">Ping now</button></div>'
      + '<div data-slot="health"></div></section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + I('folder') + ' Providers</h3></div><div data-slot="providers">'
      + UI().loadingPanel('Loading providers…') + '</div></section></div>'
      + '<section class="panel glass-panel" data-admin-only><div class="panel-head"><h3>' + I('forge') + ' Meta / Llama provider (BYOK)</h3></div>'
      + '<p class="muted small">Powers <strong>llama-text</strong> (Forge → Story tab) and <strong>llama-image</strong> (Forge images). '
      + 'Values are stored as <code>llama_*</code> secrets and never displayed back.</p>'
      + '<div class="form-grid">'
      + '<label class="fld"><span>Host preset</span><select data-f="ll-preset">'
      + Object.keys(LLAMA_PRESETS).map(function (k) {
        return '<option value="' + k + '">' + U().esc(LLAMA_PRESETS[k].label) + '</option>';
      }).join('') + '</select></label>'
      + '<label class="fld"><span>API key</span><span class="row"><input data-f="ll-key" type="password" placeholder="stored, never shown" autocomplete="off" style="flex:1">'
      + '<button type="button" class="btn ghost" data-a="ll-key-toggle" aria-pressed="false" aria-label="Show API key">Show</button></span></label>'
      + '<label class="fld"><span>Base URL</span><input data-f="ll-base" placeholder="https://api.together.xyz/v1"></label>'
      + '<label class="fld"><span>Text model (llama-text)</span><input data-f="ll-text" placeholder="meta-llama/Llama-3.3-70B-Instruct-Turbo"></label>'
      + '<label class="fld"><span>Image model (llama-image)</span><input data-f="ll-image" placeholder="black-forest-labs/FLUX.1-schnell"></label>'
      + '<label class="fld"><span>Price (cents/image, empty = unknown)</span><input data-f="ll-price" type="number" min="0" placeholder="empty"></label>'
      + '</div>'
      + '<p class="muted small" data-slot="ll-preset-note"></p>'
      + '<div class="btn-row"><button type="button" class="btn primary" data-a="ll-save">Save Llama settings</button> '
      + '<button type="button" class="btn ghost" data-a="ll-test">Check configuration</button></div>'
      + '<div data-slot="ll-status"></div></section>'
      + '<div class="grid-2"><section class="panel glass-panel" data-admin-only><div class="panel-head"><h3>' + I('shield') + ' Secrets (names only — values are write-only)</h3></div>'
      + '<div data-slot="secrets">' + UI().loadingPanel('Loading secret names…') + '</div>'
      + '<div class="row"><input data-f="s-name" placeholder="SECRET_NAME" size="18"> '
      + '<input data-f="s-value" type="password" placeholder="value (never displayed)" size="22"> '
      + '<button type="button" class="btn primary" data-a="s-save">Store</button></div>'
      + '<p class="muted small">Keys live in .kgsm/secrets.json; no endpoint ever returns a value (FR-008).</p></section>'
      + '<section class="panel glass-panel" data-admin-only><div class="panel-head"><h3>' + I('sliders') + ' Spend limits</h3></div><div data-slot="limits">'
      + UI().loadingPanel('Loading limits…') + '</div>'
      + '<div class="form-grid"><label class="fld"><span>Global limit (cents, empty = clear)</span><input data-f="lim-global" type="number" min="0" placeholder="empty"></label>'
      + '<label class="fld"><span>Project limit (cents, empty = clear)</span><input data-f="lim-project" type="number" min="0" placeholder="empty"></label></div>'
      + '<div class="btn-row"><button type="button" class="btn primary" data-a="lim-save">Save limits</button> '
      + '<button type="button" class="btn ghost" data-a="ledger">This month\'s ledger</button></div>'
      + '<div data-slot="ledger"></div></section></div>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + I('info') + ' Environment</h3></div><div data-slot="env"></div>'
      + '<div class="btn-row"><button type="button" class="btn ghost" data-a="storage" aria-disabled="true" title="Planned (M2) — wave 1 uses the worker\'s projects/ dir">' + I('folder') + 'Change storage path (Planned)</button> '
      + '<button type="button" class="btn ghost" data-a="runtimes" aria-disabled="true" title="Planned (M2) — wave 1 targets the bundled Phaser 3 template">' + I('chip') + 'Runtime versions (Planned)</button></div></section>';
    paintHealth(root);
    loadProvidersSettings(root);
    loadSecrets(root);
    loadLimits(root);
    paintEnv(root);
    root.querySelector('[data-a="save-url"]').addEventListener('click', function (e) {
      var url = root.querySelector('[data-f="url"]').value.trim().replace(/\/+$/, '');
      if (!url) { UI().toast('Worker URL is required.', 'error'); return; }
      S().set({ workerUrl: url });
      UI().busy(e.target, function () {
        return globalThis.KgsmApp.checkHealth().then(function () { paintHealth(root); });
      }, 'Connecting…');
    });
    root.querySelector('[data-a="ping"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () {
        return globalThis.KgsmApp.checkHealth().then(function () { paintHealth(root); });
      }, 'Pinging…');
    });
    root.querySelector('[data-a="s-save"]').addEventListener('click', function (e) {
      var name = root.querySelector('[data-f="s-name"]').value.trim();
      var value = root.querySelector('[data-f="s-value"]').value;
      if (!name || !value) { UI().toast('Name and value are required.', 'error'); return; }
      UI().busy(e.target, function () {
        return api().putSecret(name, value).then(function () {
          root.querySelector('[data-f="s-value"]').value = '';
          UI().toast('Secret "' + name + '" stored.', 'success');
          loadSecrets(root);
        });
      }, 'Storing…');
    });
    function paintLlamaPreset(fill) {
      var key = root.querySelector('[data-f="ll-preset"]').value;
      var pr = LLAMA_PRESETS[key] || LLAMA_PRESETS.together;
      if (fill) {
        // Fill empty fields only: switching presets must never clobber
        // typed Base URL / model values.
        ['ll-base', 'll-text', 'll-image'].forEach(function (f, i) {
          var inp = root.querySelector('[data-f="' + f + '"]');
          var val = [pr.base, pr.text, pr.image][i];
          if (inp && !inp.value.trim() && val) inp.value = val;
        });
      }
      root.querySelector('[data-slot="ll-preset-note"]').textContent =
        'Get a key at ' + pr.keyUrl + ' — ' + pr.note
        + ' Switching presets only fills empty fields; your edits are kept.';
    }
    root.querySelector('[data-f="ll-preset"]').addEventListener('change', function () { paintLlamaPreset(true); });
    paintLlamaPreset(true);
    root.querySelector('[data-a="ll-key-toggle"]').addEventListener('click', function (e) {
      var inp = root.querySelector('[data-f="ll-key"]');
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      e.target.textContent = show ? 'Hide' : 'Show';
      e.target.setAttribute('aria-pressed', show ? 'true' : 'false');
      e.target.setAttribute('aria-label', show ? 'Hide API key' : 'Show API key');
    });
    root.querySelector('[data-a="ll-save"]').addEventListener('click', function (e) {
      var vals = {
        llama_api_key: root.querySelector('[data-f="ll-key"]').value.trim(),
        llama_base_url: root.querySelector('[data-f="ll-base"]').value.trim(),
        llama_text_model: root.querySelector('[data-f="ll-text"]').value.trim(),
        llama_image_model: root.querySelector('[data-f="ll-image"]').value.trim(),
        llama_price_cents_per_image: root.querySelector('[data-f="ll-price"]').value.trim(),
      };
      var jobs = Object.keys(vals).filter(function (k) { return vals[k] !== ''; })
        .map(function (k) { return api().putSecret(k, vals[k]); });
      if (!jobs.length) { UI().toast('Fill at least one field before saving.', 'error'); return; }
      UI().busy(e.target, function () {
        return Promise.all(jobs).then(function () {
          root.querySelector('[data-f="ll-key"]').value = '';
          UI().toast('Llama settings stored (empty fields left unchanged).', 'success');
          loadSecrets(root);
        });
      }, 'Storing…');
    });
    root.querySelector('[data-a="ll-test"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () {
        return Promise.all([api().listProviders(), api().listSecrets()]).then(function (res) {
          var ids = (res[0].providers || []).map(function (pr) { return pr.id; });
          var names = res[1].names || [];
          var checks = [
            ['llama-text adapter registered', ids.indexOf('llama-text') >= 0],
            ['llama-image adapter registered', ids.indexOf('llama-image') >= 0],
            ['llama_api_key stored', names.indexOf('llama_api_key') >= 0],
          ];
          var ok = checks.every(function (c) { return c[1]; });
          var slot = root.querySelector('[data-slot="ll-status"]');
          slot.innerHTML = '<ul class="asset-list">' + checks.map(function (c) {
            return '<li><span class="pill ' + (c[1] ? 'green' : 'red') + '">'
              + (c[1] ? 'PASS' : 'FAIL') + '</span> ' + U().esc(c[0]) + '</li>';
          }).join('') + '</ul>'
            + '<p class="muted small">Secret values are write-only, so only presence is checked, and no request '
            + 'is sent to the provider — a wrong key still passes. '
            + 'Unset base URL / models fall back to the Together defaults.</p>';
          UI().toast(ok ? 'Configuration check passed — try the Forge Story tab.'
            : 'Llama is not fully configured — see checks above.', ok ? 'success' : 'error');
        });
      }, 'Checking…');
    });
    root.querySelector('[data-a="lim-save"]').addEventListener('click', function (e) {
      var g = root.querySelector('[data-f="lim-global"]').value;
      var pj = root.querySelector('[data-f="lim-project"]').value;
      var cur = S().current();
      UI().busy(e.target, function () {
        var jobs = [api().putLimits('global', g === '' ? null : Number(g))];
        if (cur) {
          jobs.push(api().putLimits('project', pj === '' ? null : Number(pj), cur.id));
        } else if (pj !== '') {
          UI().toast('Select a project on Home before setting a project limit.', 'error');
          return Promise.resolve();
        }
        return Promise.all(jobs).then(function () {
          UI().toast('Limits saved.', 'success');
          loadLimits(root);
        });
      }, 'Saving…');
    });
    root.querySelector('[data-a="ledger"]').addEventListener('click', function (e) {
      var cur = S().current();
      UI().busy(e.target, function () {
        return api().ledger(cur ? cur.id : undefined).then(function (res) {
          var slot = root.querySelector('[data-slot="ledger"]');
          var entries = res.entries || [];
          slot.innerHTML = '<p><span class="muted">total this month: </span><strong>'
            + U().esc(U().fmtCents(res.totalCents)) + (cur ? ' (project: ' + U().esc(cur.name) + ')' : ' (global)') + '</strong></p>'
            + (entries.length ? '<ul class="asset-list">' + entries.map(function (en) {
              return '<li><span class="muted">' + U().esc(U().fmtDate(en.createdAt)) + '</span> '
                + U().esc(en.label) + ' — <strong>' + U().esc(U().fmtCents(en.amountCents)) + '</strong></li>';
            }).join('') + '</ul>' : '<p class="muted">No spend recorded this month.</p>');
        });
      }, 'Loading…');
    });
    // storage/runtimes are Planned placeholders: focusable (aria-disabled) with
    // a toast explanation, since title tooltips never reach keyboard/SR users.
    root.querySelector('[data-a="storage"]').addEventListener('click', function () {
      UI().toast('Change storage path is planned (M2) — wave 1 uses the worker\'s projects/ dir.', 'info');
    });
    root.querySelector('[data-a="runtimes"]').addEventListener('click', function () {
      UI().toast('Runtime versions are planned (M2) — wave 1 targets the bundled Phaser 3 template.', 'info');
    });
  }

  function paintHealth(root) {
    var slot = root.querySelector('[data-slot="health"]');
    if (!slot) return;
    var h = S().get('health');
    if (!S().get('online') || !h) {
      slot.innerHTML = '<p><span class="pill red">offline</span></p>';
      return;
    }
    slot.innerHTML = '<table class="kv"><tbody>' + UI().kvRows({
      status: h.status, worker: h.worker, version: h.version, contract: h.contractVersion,
    }) + '</tbody></table>';
  }

  function loadProvidersSettings(root) {
    var slot = root.querySelector('[data-slot="providers"]');
    if (!S().get('online')) { slot.innerHTML = UI().offlinePanel(); return; }
    api().listProviders().then(function (res) {
      if (!slot.isConnected) return;
      var prs = res.providers || [];
      S().set({ providers: prs });
      slot.innerHTML = prs.length
        ? '<ul class="asset-list">' + prs.map(function (pr) {
          return '<li><strong>' + U().esc(pr.displayName || pr.id) + '</strong> <span class="muted">'
            + U().esc(pr.id) + ' · ' + U().esc(pr.model || '?') + '</span></li>';
        }).join('') + '</ul>'
        : UI().emptyPanel('No providers', 'The worker reports zero providers.');
    }, function (err) {
      if (!slot.isConnected) return;
      slot.innerHTML = UI().errorPanel('Could not load providers', err);
    });
  }

  function loadSecrets(root) {
    if (document.body.classList.contains('not-admin')) return;
    var slot = root.querySelector('[data-slot="secrets"]');
    if (!slot) return;
    if (!S().get('online')) { slot.innerHTML = UI().offlinePanel(); return; }
    api().listSecrets().then(function (res) {
      if (!slot.isConnected) return;
      var names = res.names || [];
      slot.innerHTML = names.length
        ? '<ul class="asset-list">' + names.map(function (n) {
          return '<li><code>' + U().esc(n) + '</code> '
            + '<button type="button" class="btn ghost danger" data-s="' + U().esc(n) + '">Delete</button></li>';
        }).join('') + '</ul>'
        : UI().emptyPanel('No secrets stored', 'Store a name + value above.');
      slot.querySelectorAll('[data-s]').forEach(function (b) {
        b.addEventListener('click', function () {
          UI().confirmModal('Delete secret?', 'Delete "' + b.dataset.s + '" from the local store?', 'Delete', true)
            .then(function (ok) {
              if (!ok) return;
              api().deleteSecret(b.dataset.s).then(function () {
                UI().toast('Secret deleted.', 'success');
                loadSecrets(root);
              }, function (e) { UI().toast(UI().errorText(e), 'error'); });
            });
        });
      });
    }, function (err) {
      if (!slot.isConnected) return;
      slot.innerHTML = UI().errorPanel('Could not load secret names', err);
    });
  }

  function loadLimits(root) {
    if (document.body.classList.contains('not-admin')) return;
    var slot = root.querySelector('[data-slot="limits"]');
    if (!slot) return;
    if (!S().get('online')) { slot.innerHTML = UI().offlinePanel(); return; }
    var cur = S().current();
    api().limits(cur ? cur.id : '').then(function (res) {
      if (!slot.isConnected) return;
      slot.innerHTML = '<table class="kv"><tbody>' + UI().kvRows({
        'Global limit': res.global == null ? 'none' : U().fmtCents(res.global),
        'Project limit': res.project == null ? 'none' : U().fmtCents(res.project),
        'Spent (global)': U().fmtCents(res.spentThisMonth.global),
        'Spent (project)': U().fmtCents(res.spentThisMonth.project),
      }) + '</tbody></table>';
      if (res.global != null) root.querySelector('[data-f="lim-global"]').value = res.global;
      if (res.project != null) root.querySelector('[data-f="lim-project"]').value = res.project;
    }, function (err) {
      if (!slot.isConnected) return;
      slot.innerHTML = UI().errorPanel('Could not load limits', err);
    });
  }

  function paintEnv(root) {
    var slot = root.querySelector('[data-slot="env"]');
    var inTauri = !!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);
    slot.innerHTML = '<table class="kv"><tbody>' + UI().kvRows({
      shell: inTauri ? 'Tauri desktop' : 'browser dev',
      'worker URL': S().get('workerUrl'),
      'selected project': (S().current() || {}).name || 'none',
    }) + '</tbody></table>';
  }

  V().register('playtest', { title: 'Playtest', render: renderPlaytest });
  V().register('validation', { title: 'Validation Center', render: renderValidation });
  V().register('export', { title: 'Export Center', render: renderExport });
  V().register('settings', { title: 'Settings', render: renderSettings });
})();
