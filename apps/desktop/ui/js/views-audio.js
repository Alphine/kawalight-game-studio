// KGSM view: Audio library (import + list via worker contract §9 / FR-029).
// Registers into KgsmViews. Generation/SFX-synth is P2 — this view covers
// the wave-1 import flow only.
(function () {
  'use strict';

  function V() { return globalThis.KgsmViews; }
  function U() { return globalThis.KgsmUtil; }
  function UI() { return globalThis.KgsmUi; }
  function S() { return globalThis.KgsmStore; }
  function api() { return globalThis.KgsmApp.api; }

  var FORMAT_HINT = {
    wav: 'uncompressed · exact duration',
    mp3: 'compressed · duration estimated',
    ogg: 'compressed · vorbis duration',
  };

  function render(root) {
    var p = V().needProject(root);
    if (!p) return;
    root.innerHTML =
      '<div class="view-head"><div><h2>Audio</h2>'
      + '<p class="muted">Project: <strong>' + U().esc(p.name) + '</strong>'
      + ' · import SFX and music loops for the exported game.</p></div>'
      + '<div class="row"><button type="button" class="btn ghost" data-a="refresh">Refresh library</button></div></div>'
      + '<div class="grid-2"><section class="panel"><h3>Import local file</h3>'
      + '<label class="fld"><span>Absolute path on this machine</span>'
      + '<input data-f="src" placeholder="C:\\audio\\jump.wav (.wav / .mp3 / .ogg)"></label>'
      + '<div class="form-grid">'
      + '<label class="fld"><span>Role (required)</span>'
      + '<input data-f="role" value="sfx" placeholder="sfx"></label>'
      + '<label class="fld"><span>Entity (optional)</span>'
      + '<input data-f="entity" placeholder="player"></label></div>'
      + '<div class="btn-row"><button type="button" class="btn primary" data-a="import">Import</button></div>'
      + '<p class="muted small">Accepted: .wav / .mp3 / .ogg · ≤ 32 MB · ≤ 10 min. '
      + 'Files land under <code>audio/</code> with a manifest-ready sidecar. '
      + 'Playback happens in the exported game — the worker stores files, it does not stream them.</p></section>'
      + '<section class="panel"><h3>Library</h3><div data-slot="list">'
      + UI().loadingPanel('Loading audio…') + '</div></section></div>';
    root.querySelector('[data-a="refresh"]').addEventListener('click', function () { loadList(root, p); });
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
    loadList(root, p);
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
        '<button type="button" class="btn ghost" data-a="retry">Retry</button>');
      slot.querySelector('[data-a="retry"]').addEventListener('click', function () { loadList(root, p); });
    });
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
