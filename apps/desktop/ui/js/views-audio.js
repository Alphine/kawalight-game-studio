// KGSM view: Audio library (import + list via worker contract §9 / FR-029),
// plus local SFX generation (worker synthesises WAV; no network or API key).
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

  var FORMAT_HINT = {
    wav: 'uncompressed · exact duration',
    mp3: 'compressed · duration estimated',
    ogg: 'compressed · vorbis duration',
  };

  function render(root) {
    var p = V().needProject(root);
    if (!p) return;
    root.innerHTML =
      '<div class="view-head"><div><p class="hero-tag">' + I('audio') + ' ASSET LIBRARY</p><h2>' + I('audio') + ' Audio</h2>'
      + '<p class="muted">Project: <strong>' + U().esc(p.name) + '</strong>'
      + ' · generate or import SFX for the exported game.</p></div>'
      + '<div class="row"><button type="button" class="btn ghost" data-a="refresh">' + I('refresh') + 'Refresh library</button></div></div>'
      + '<section class="panel glass-panel glass-panel-glow"><div class="panel-head"><h3>' + I('forge') + ' Generate sound effect</h3></div>'
      + '<p class="muted small">Synthesized on this machine: no API, no quota. The same preset and seed always give the same file.</p>'
      + '<div class="form-grid">'
      + '<label class="fld"><span>Preset</span><select data-f="gen-preset"><option value="">Loading presets…</option></select></label>'
      + '<label class="fld"><span>Role (optional)</span><input data-f="gen-role" placeholder="defaults to the preset name"></label>'
      + '<label class="fld"><span>Entity (optional)</span><input data-f="gen-entity" placeholder="player"></label>'
      + '<label class="fld"><span>Seed</span><input data-f="gen-seed" type="number" min="0" max="2147483647" value="0"></label></div>'
      + '<div class="btn-row"><button type="button" class="btn primary" data-a="generate">' + I('forge') + 'Generate</button></div></section>'
      + '<div class="grid-2"><section class="panel glass-panel glass-panel-glow" data-admin-only><div class="panel-head"><h3>' + I('plus') + ' Import local file</h3></div>'
      + '<div class="row"><label class="fld grow"><span>Absolute path on this machine</span>'
      + '<input data-f="src" placeholder="C:\\audio\\jump.wav (.wav / .mp3 / .ogg)"></label>'
      + '<button type="button" class="btn ghost" data-a="browse" title="Open the native file picker when available">Browse…</button></div>'
      + '<div class="form-grid">'
      + '<label class="fld"><span>Role (required)</span>'
      + '<input data-f="role" value="sfx" placeholder="sfx"></label>'
      + '<label class="fld"><span>Entity (optional)</span>'
      + '<input data-f="entity" placeholder="player"></label></div>'
      + '<div class="btn-row"><button type="button" class="btn primary" data-a="import">Import</button></div>'
      + '<p class="muted small">Accepted: .wav / .mp3 / .ogg · ≤ 32 MB · ≤ 10 min. '
      + 'Files land under <code>audio/</code> with a manifest-ready sidecar. '
      + 'Playback happens in the exported game — the worker stores files, it does not stream them.</p></section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + I('audio') + ' Library</h3></div><div data-slot="list">'
      + UI().loadingPanel('Loading audio…') + '</div></section></div>';
    root.querySelector('[data-a="refresh"]').addEventListener('click', function () { loadList(root, p); });
    root.querySelector('[data-a="browse"]').addEventListener('click', function () {
      pickFile(root.querySelector('[data-f="src"]'));
    });
    root.querySelector('[data-a="import"]').addEventListener('click', function (e) {
      var body = {
        src: root.querySelector('[data-f="src"]').value.trim(),
        role: root.querySelector('[data-f="role"]').value.trim(),
      };
      var entity = root.querySelector('[data-f="entity"]').value.trim();
      if (entity) body.entity = entity;
      if (!body.src || !body.role) { UI().toast('src and role are required.', 'error'); return; }
      UI().busy(e.target, function () {
        return api().importAudio(p.id, body).then(function (res) {
          UI().toast('Imported → ' + res.path, 'success');
          root.querySelector('[data-f="src"]').value = '';
          loadList(root, p);
          if (V().refreshProjects) V().refreshProjects();
        });
      }, 'Importing…');
    });
    loadPresets(root);
    root.querySelector('[data-a="generate"]').addEventListener('click', function (e) {
      var preset = root.querySelector('[data-f="gen-preset"]').value;
      var seed = Number(root.querySelector('[data-f="gen-seed"]').value || '0');
      if (!preset) { UI().toast('Pick a preset first.', 'error'); return; }
      if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
        UI().toast('Seed must be a whole number from 0 to 2147483647.', 'error');
        return;
      }
      var body = { preset: preset, seed: seed };
      var role = root.querySelector('[data-f="gen-role"]').value.trim();
      var entity = root.querySelector('[data-f="gen-entity"]').value.trim();
      if (role) body.role = role;
      if (entity) body.entity = entity;
      UI().busy(e.target, function () {
        return api().generateSfx(p.id, body).then(function (res) {
          UI().toast('Generated → ' + res.path, 'success');
          loadList(root, p);
          if (V().refreshProjects) V().refreshProjects();
        });
      }, 'Generating…');
    });
    loadList(root, p);
  }

  function loadPresets(root) {
    var select = root.querySelector('[data-f="gen-preset"]');
    if (!S().get('online')) {
      select.innerHTML = '<option value="">Worker offline</option>';
      return;
    }
    api().sfxPresets().then(function (res) {
      if (!select.isConnected) return;
      select.innerHTML = '<option value="">Choose a preset…</option>' + (res.presets || []).map(function (name) {
        return '<option value="' + U().esc(name) + '">' + U().esc(name) + '</option>';
      }).join('');
    }, function () {
      if (select.isConnected) select.innerHTML = '<option value="">Could not load presets</option>';
    });
  }

  function loadList(root, p) {
    var slot = root.querySelector('[data-slot="list"]');
    if (!slot) return;
    if (!S().get('online')) { slot.innerHTML = UI().offlinePanel(); return; }
    slot.innerHTML = UI().loadingPanel('Loading audio…');
    api().listAudio(p.id).then(function (res) {
      if (!slot.isConnected) return;
      var items = res.audio || [];
      if (!items.length) {
        slot.innerHTML = UI().emptyPanel('No audio yet',
          'Import a .wav, .mp3, or .ogg file to add music or SFX to this project.');
        return;
      }
      slot.innerHTML = '<ul class="asset-list">' + items.map(function (a) {
        return '<li class="audio-row"><code>' + U().esc(a.path) + '</code>'
          + '<span class="muted">' + U().esc(describe(a.meta)) + '</span></li>';
      }).join('') + '</ul>'
        + '<p class="muted small">' + items.length + ' file(s). Hover a row for full metadata.</p>';
      slot.querySelectorAll('.audio-row').forEach(function (li, i) {
        li.title = detail(items[i].meta);
      });
    }, function (err) {
      if (!slot.isConnected) return;
      slot.innerHTML = UI().errorPanel('Could not load audio', err,
        '<button type="button" class="btn ghost" data-a="retry">' + I('refresh') + 'Retry</button>');
      slot.querySelector('[data-a="retry"]').addEventListener('click', function () { loadList(root, p); });
    });
  }

  // Native file picker when the Tauri dialog API is exposed; otherwise the
  // typed path field stays the fallback (no new deps: purely optional).
  function pickFile(inputEl) {
    function fill(sel) {
      if (sel == null) return;
      var v = Array.isArray(sel) ? sel[0] : sel;
      if (v != null) inputEl.value = String(v);
    }
    try {
      var T = window.__TAURI__ || {};
      var open = (T.dialog && T.dialog.open) || (T.pluginDialog && T.pluginDialog.open);
      if (typeof open === 'function') {
        open({ multiple: false }).then(fill, function (e) {
          UI().toast('Picker failed — type or paste the path. (' + UI().errorText(e) + ')', 'error');
        });
        return;
      }
      var invoke = T.core && T.core.invoke;
      if (typeof invoke === 'function') {
        invoke('plugin:dialog|open', { options: { multiple: false } }).then(fill, function () {
          UI().toast('File picker plugin is not installed — type or paste the path.', 'info');
        });
        return;
      }
    } catch (e) { /* fall through */ }
    UI().toast('Native picker unavailable here — type or paste the path.', 'info');
  }

  function describe(meta) {
    if (!meta) return 'no metadata sidecar';
    var bits = [];
    if (meta.format) bits.push(String(meta.format).toUpperCase());
    bits.push(U().fmtDuration(meta.durationSeconds));
    if (meta.sampleRate) bits.push(Math.round(meta.sampleRate / 100) / 10 + ' kHz');
    if (meta.channels) bits.push(meta.channels === 1 ? 'mono' : meta.channels + 'ch');
    if (meta.bytes != null) bits.push(U().fmtBytes(meta.bytes));
    return bits.join(' · ');
  }

  function detail(meta) {
    if (!meta) return 'No .meta.json sidecar found for this file.';
    var hint = FORMAT_HINT[meta.format] || '';
    return 'role: ' + (meta.role || '—')
      + ' · entity: ' + (meta.entity || '—')
      + ' · source: ' + (meta.source || '—')
      + (hint ? ' · ' + hint : '')
      + (meta.sha256 ? ' · sha256 ' + String(meta.sha256).slice(0, 12) + '…' : '');
  }

  V().register('audio', { title: 'Audio', render: render });
})();
