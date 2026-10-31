// KGSM views: Asset Forge + Asset Lab. Registers into KgsmViews.
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

  // Known single-modality provider ids (docs/providers.md). The worker is the
  // source of truth and fails cleanly either way; these only drive hints so
  // users do not burn a quote round-trip on the wrong tab.
  var TEXT_ONLY_PROVIDERS = ['llama-text'];
  var IMAGE_ONLY_PROVIDERS = ['openai-compat', 'llama-image'];

  // ---------- Asset Forge ----------
  function renderForge(root) {
    var p = V().needProject(root);
    if (!p) return;
    root.innerHTML =
      '<div class="view-head"><div><p class="hero-tag">' + I('forge') + ' ASSET FACTORY</p><h2>' + I('forge') + ' Asset Forge</h2>'
      + '<p class="muted">Project: <strong>' + U().esc(p.name) + '</strong> · prompt → quote → confirm → generate (FR-009).</p></div></div>'
      + '<div class="btn-row" role="tablist" aria-label="Forge modes">'
      + '<button type="button" class="btn primary" data-a="tab-images" role="tab" aria-selected="true">' + I('forge') + 'Images</button> '
      + '<button type="button" class="btn ghost" data-a="tab-story" role="tab" aria-selected="false">' + I('blueprint') + 'Story</button></div>'
      + '<div data-pane="images" role="tabpanel">'
      + '<div class="grid-2"><section class="panel glass-panel glass-panel-glow"><div class="panel-head"><h3>' + I('forge') + ' AI Asset Generator</h3></div><div data-slot="form">'
      + UI().loadingPanel('Loading providers…') + '</div></section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + I('check') + ' Result</h3></div><div data-slot="result">'
      + UI().emptyPanel('Nothing generated yet', 'Fill the prompt form and confirm the quote.') + '</div></section></div>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + I('folder') + ' Asset history</h3>'
      + '<button type="button" class="btn ghost" data-a="refresh">' + I('refresh') + 'Refresh</button></div>'
      + '<div data-slot="history">' + UI().loadingPanel('Loading assets…') + '</div></section></div>'
      + '<div data-pane="story" role="tabpanel" class="hidden">'
      + '<div class="grid-2"><section class="panel glass-panel glass-panel-glow"><div class="panel-head"><h3>' + I('blueprint') + ' AI Story Generator</h3></div><div data-slot="story-form">'
      + UI().loadingPanel('Loading providers…') + '</div></section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + I('check') + ' Story</h3></div><div data-slot="story-result">'
      + UI().emptyPanel('No story yet', 'Write a prompt and generate.') + '</div></section></div></div>';
    root.querySelector('[data-a="refresh"]').addEventListener('click', function () { loadHistory(root, p); });
    var storyLoaded = false;
    function selectTab(which) {
      var images = which === 'images';
      root.querySelector('[data-pane="images"]').classList.toggle('hidden', !images);
      root.querySelector('[data-pane="story"]').classList.toggle('hidden', images);
      var ti = root.querySelector('[data-a="tab-images"]');
      var ts = root.querySelector('[data-a="tab-story"]');
      ti.className = 'btn ' + (images ? 'primary' : 'ghost');
      ts.className = 'btn ' + (images ? 'ghost' : 'primary');
      ti.setAttribute('aria-selected', images ? 'true' : 'false');
      ts.setAttribute('aria-selected', images ? 'false' : 'true');
      if (!images && !storyLoaded) { storyLoaded = true; loadStoryProviders(root, p); }
    }
    root.querySelector('[data-a="tab-images"]').addEventListener('click', function () { selectTab('images'); });
    root.querySelector('[data-a="tab-story"]').addEventListener('click', function () { selectTab('story'); });
    loadProviders(root, p);
    loadHistory(root, p);
  }

  function loadProviders(root, p) {
    var slot = root.querySelector('[data-slot="form"]');
    if (!S().get('online')) { slot.innerHTML = UI().offlinePanel(); return; }
    api().listProviders().then(function (res) {
      if (!slot.isConnected) return;
      var providers = res.providers || [];
      S().set({ providers: providers });
      if (!providers.length) {
        slot.innerHTML = UI().emptyPanel('No providers registered', 'The worker reports zero providers.');
        return;
      }
      slot.innerHTML =
        '<label class="fld"><span>Provider</span><select data-f="provider">'
        + providers.map(function (pr) {
          return '<option value="' + U().esc(pr.id) + '">' + U().esc(pr.displayName || pr.id)
            + ' (' + U().esc(pr.model || '?') + ')</option>';
        }).join('') + '</select></label>'
        + '<label class="fld"><span>Prompt</span><textarea data-f="prompt" rows="3" placeholder="Pixel-art player spaceship, side view, 32x32"></textarea></label>'
        + '<div class="form-grid">'
        + '<label class="fld"><span>Style</span><select data-f="style"><option>pixel-art</option><option>illustrated-2d</option></select></label>'
        + '<label class="fld"><span>Width</span><input data-f="width" type="number" value="64" min="8" max="2048"></label>'
        + '<label class="fld"><span>Height</span><input data-f="height" type="number" value="64" min="8" max="2048"></label>'
        + '<label class="fld"><span>Images (1..16)</span><input data-f="n" type="number" value="1" min="1" max="16"></label>'
        + '<label class="fld"><span>Seed (empty = random)</span><input data-f="seed" type="number" min="0" placeholder="empty"></label>'
        + '<label class="fld"><span>Entity</span><input data-f="entity" value="player" placeholder="player"></label>'
        + '<label class="fld"><span>Role</span><input data-f="role" value="ship" placeholder="ship"></label>'
        + '</div>'
        + '<div data-slot="quote"></div>'
        + '<div class="btn-row"><button type="button" class="btn ghost" data-a="quote">Get quote</button> '
        + '<button type="button" class="btn primary" data-a="gen" disabled>Confirm + generate</button></div>'
        + '<p class="muted small">Paid or unknown-cost generations always show a quote first; nothing is spent until you confirm (NFR-011).</p>';
      wireForge(slot, root, p);
    }, function (err) {
      if (!slot.isConnected) return;
      slot.innerHTML = UI().errorPanel('Could not load providers', err,
        '<button type="button" class="btn ghost" data-a="retry">' + I('refresh') + 'Retry</button>');
      slot.querySelector('[data-a="retry"]').addEventListener('click', function () { loadProviders(root, p); });
    });
  }

  function forgeBody(slot) {
    function val(k) { return slot.querySelector('[data-f="' + k + '"]').value; }
    var seedRaw = val('seed');
    return {
      providerId: val('provider'), prompt: val('prompt').trim(),
      style: val('style'), width: Number(val('width')), height: Number(val('height')),
      seed: seedRaw === '' ? undefined : Number(seedRaw),
      nImages: Number(val('n')), entity: val('entity').trim(), role: val('role').trim(),
    };
  }

  function wireForge(slot, root, p) {
    var quoteSlot = slot.querySelector('[data-slot="quote"]');
    var genBtn = slot.querySelector('[data-a="gen"]');
    var lastQuote = null;
    // Any form edit invalidates the previous quote: clear it and re-disable
    // Generate until the user re-quotes, so generation never runs stale.
    slot.querySelectorAll('[data-f]').forEach(function (inp) {
      inp.addEventListener('input', invalidateQuote);
      inp.addEventListener('change', invalidateQuote);
    });
    function invalidateQuote() {
      if (!lastQuote && genBtn.disabled) return;
      lastQuote = null;
      genBtn.disabled = true;
      quoteSlot.innerHTML = '<p class="muted small">Form changed — get a fresh quote before generating.</p>';
    }
    slot.querySelector('[data-a="quote"]').addEventListener('click', function (e) {
      var b = forgeBody(slot);
      if (TEXT_ONLY_PROVIDERS.indexOf(b.providerId) >= 0) {
        UI().toast(b.providerId + ' is text-only — use the Story tab or pick an image provider.', 'error');
        return;
      }
      if (!b.prompt) { UI().toast('Prompt is required.', 'error'); return; }
      if (!(b.nImages >= 1 && b.nImages <= 16)) { UI().toast('nImages must be 1..16.', 'error'); return; }
      if (!b.entity || !b.role) { UI().toast('Entity and role are required.', 'error'); return; }
      UI().busy(e.target, function () {
        return api().quoteCosts(b.providerId, b.nImages, p.id).then(function (q) {
          lastQuote = q;
          quoteSlot.innerHTML = '<table class="kv"><tbody>' + UI().kvRows({
            Cost: U().fmtCents(q.cents), 'Needs confirmation': q.needsConfirmation ? 'yes' : 'no',
            Reason: q.reason || '—',
          }) + '</tbody></table>';
          genBtn.disabled = false;
          UI().toast(q.needsConfirmation ? 'Quote ready — review and confirm.' : 'Free generation — confirm to run.',
            q.needsConfirmation ? 'info' : 'success');
        });
      }, 'Quoting…');
    });
    genBtn.addEventListener('click', function (e) {
      var b = forgeBody(slot);
      b.confirmed = true;
      if (b.seed === undefined) delete b.seed;
      UI().busy(e.target, function () {
        return api().generateAssets(p.id, b).then(function (res) {
          var rslot = root.querySelector('[data-slot="result"]');
          rslot.innerHTML = '<p><span class="pill green">generated</span> '
            + '<span class="muted">spent ' + U().esc(U().fmtCents(res.spentCents)) + '</span></p>'
            + '<ul class="asset-list">' + (res.assets || []).map(function (a) {
              return '<li><code>' + U().esc(a.path) + '</code>'
                + (a.meta ? ' <span class="muted">' + a.meta.width + '×' + a.meta.height + ' ' + U().esc(a.meta.mode || '') + '</span>' : '')
                + '</li>';
            }).join('') + '</ul>';
          UI().toast('Generated ' + (res.assets || []).length + ' asset(s).', 'success');
          loadHistory(root, p);
          if (V().refreshProjects) V().refreshProjects();
        }, function (err) {
          if (err && (err.code === 'needs-confirmation' || err.code === 'cost-blocked') && err.quote) {
            lastQuote = err.quote;
            quoteSlot.innerHTML = '<table class="kv"><tbody>' + UI().kvRows({
              Blocked: err.message, Cost: U().fmtCents(err.quote.cents), Reason: err.quote.reason || '—',
            }) + '</tbody></table>';
          }
          UI().toast(UI().errorText(err), 'error');
          throw err;
        });
      }, 'Generating…');
    });
  }

  // ---------- Forge: Story tab ----------
  // POST /api/v1/stories/generate (contract §13). The shared api.js client is
  // frozen, so this tab posts directly and normalizes errors with
  // KgsmUtil.parseApiError, mirroring api.js semantics.
  function postStory(body) {
    var base = String(S().get('workerUrl') || 'http://127.0.0.1:4317').replace(/\/+$/, '');
    var url = base + '/api/v1/stories/generate';
    var init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    };
    var ctrl = null;
    var timer = null;
    if (typeof AbortController !== 'undefined') {
      ctrl = new AbortController();
      init.signal = ctrl.signal;
      timer = setTimeout(function () { ctrl.abort(); }, 120000);
    }
    return fetch(url, init).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.text().then(function (text) {
        var payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
        if (res.ok) return payload == null ? {} : payload;
        var parsed = U().parseApiError(payload, res.status, 'Request failed');
        var err = new Error(parsed.message);
        err.code = parsed.code;
        err.status = parsed.status;
        if (parsed.quote) err.quote = parsed.quote;
        throw err;
      });
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.code) throw err;
      var msg = (err && err.name === 'AbortError')
        ? 'Worker timed out after 120s'
        : 'Worker unreachable at ' + base + ' (is it running?)';
      var off = new Error(msg);
      off.code = 'worker-offline';
      off.status = 0;
      throw off;
    });
  }

  function loadStoryProviders(root, p) {
    var slot = root.querySelector('[data-slot="story-form"]');
    if (!slot) return;
    if (!S().get('online')) { slot.innerHTML = UI().offlinePanel(); return; }
    api().listProviders().then(function (res) {
      if (!slot.isConnected) return;
      var providers = res.providers || [];
      if (!providers.length) {
        slot.innerHTML = UI().emptyPanel('No providers registered', 'The worker reports zero providers.');
        return;
      }
      function isPreferred(pr) {
        return pr.id === 'llama-text' || (pr.id === 'mock' && !providers.some(function (q) { return q.id === 'llama-text'; }));
      }
      slot.innerHTML =
        '<label class="fld"><span>Provider</span><select data-f="story-provider">'
        + providers.map(function (pr) {
          return '<option value="' + U().esc(pr.id) + '"' + (isPreferred(pr) ? ' selected' : '') + '>'
            + U().esc(pr.displayName || pr.id) + ' (' + U().esc(pr.model || '?') + ')</option>';
        }).join('') + '</select></label>'
        + '<label class="fld"><span>Prompt</span><textarea data-f="story-prompt" rows="4" placeholder="A drifting scavenger crew finds a singing wreck…"></textarea></label>'
        + '<label class="fld"><span>Genre voice (optional, ≤ 64 chars)</span><input data-f="story-genre" value="' + U().esc(p.genre || '') + '" maxlength="64"></label>'
        + '<div data-slot="story-quote"></div>'
        + '<div class="btn-row"><button type="button" class="btn ghost" data-a="story-gen">Generate</button> '
        + '<button type="button" class="btn primary" data-a="story-confirm" disabled>Confirm + generate</button></div>'
        + '<p class="muted small">One story = one billable unit: paid or unknown-cost providers quote first, nothing is spent until you confirm (NFR-011). mock is free and offline.</p>';
      wireStory(slot, root, p);
    }, function (err) {
      if (!slot.isConnected) return;
      slot.innerHTML = UI().errorPanel('Could not load providers', err,
        '<button type="button" class="btn ghost" data-a="retry">' + I('refresh') + 'Retry</button>');
      slot.querySelector('[data-a="retry"]').addEventListener('click', function () { loadStoryProviders(root, p); });
    });
  }

  function storyBody(slot, p) {
    var genre = slot.querySelector('[data-f="story-genre"]').value.trim();
    var b = {
      providerId: slot.querySelector('[data-f="story-provider"]').value,
      prompt: slot.querySelector('[data-f="story-prompt"]').value.trim(),
      projectId: p.id,
    };
    if (genre) b.genre = genre;
    return b;
  }

  function wireStory(slot, root, p) {
    var quoteSlot = slot.querySelector('[data-slot="story-quote"]');
    var confirmBtn = slot.querySelector('[data-a="story-confirm"]');
    var lastQuote = null;
    slot.querySelectorAll('[data-f]').forEach(function (inp) {
      inp.addEventListener('input', invalidateQuote);
      inp.addEventListener('change', invalidateQuote);
    });
    function invalidateQuote() {
      if (!lastQuote && confirmBtn.disabled) return;
      lastQuote = null;
      confirmBtn.disabled = true;
      quoteSlot.innerHTML = '<p class="muted small">Form changed — generate again for a fresh quote.</p>';
    }
    function paintQuote(q, blocked) {
      quoteSlot.innerHTML = '<table class="kv"><tbody>' + UI().kvRows({
        Cost: U().fmtCents(q.cents), 'Needs confirmation': q.needsConfirmation ? 'yes' : 'no',
        Reason: q.reason || '—',
      }) + '</tbody></table>'
        + (blocked ? '<p class="err-msg">Blocked by a spend limit — raise it in Settings.</p>' : '');
    }
    function attempt(confirmed, btn, label) {
      var b = storyBody(slot, p);
      if (IMAGE_ONLY_PROVIDERS.indexOf(b.providerId) >= 0) {
        UI().toast(b.providerId + ' is image-only — pick a text provider (mock, llama-text).', 'error');
        return Promise.resolve();
      }
      if (!b.prompt) { UI().toast('Prompt is required.', 'error'); return Promise.resolve(); }
      b.confirmed = confirmed;
      return UI().busy(btn, function () {
        return postStory(b).then(function (res) {
          lastQuote = res.quote || null;
          confirmBtn.disabled = true;
          showStory(root, p, res);
          UI().toast('Story generated (' + (res.provider || b.providerId) + ').', 'success');
        }, function (err) {
          if (err && (err.code === 'needs-confirmation' || err.code === 'cost-blocked') && err.quote) {
            lastQuote = err.quote;
            paintQuote(err.quote, err.code === 'cost-blocked');
            confirmBtn.disabled = err.code === 'cost-blocked';
            UI().toast(err.code === 'cost-blocked'
              ? 'Blocked by a spend limit — see quote.'
              : 'Quote ready — review and confirm.', err.code === 'cost-blocked' ? 'error' : 'info');
            return;
          }
          UI().toast(UI().errorText(err), 'error');
        });
      }, label);
    }
    slot.querySelector('[data-a="story-gen"]').addEventListener('click', function (e) {
      attempt(false, e.target, 'Generating…');
    });
    confirmBtn.addEventListener('click', function (e) {
      attempt(true, e.target, 'Generating…');
    });
  }

  function showStory(root, p, res) {
    var rslot = root.querySelector('[data-slot="story-result"]');
    if (!rslot) return;
    var usage = res.usage || {};
    var usageLine = Object.keys(usage).map(function (k) {
      return k + ': ' + usage[k];
    }).join(' · ');
    rslot.innerHTML = '<p><span class="pill green">generated</span> '
      + '<span class="muted">' + U().esc(res.provider || '?') + ' / ' + U().esc(res.model || '?')
      + ' · spent ' + U().esc(U().fmtCents(res.spentCents))
      + (usageLine ? ' · ' + U().esc(usageLine) : '') + '</span></p>'
      + '<div data-slot="story-text"></div>'
      + '<div class="btn-row"><button type="button" class="btn primary" data-a="insert-story">Insert into project blueprint</button></div>'
      + '<div data-slot="story-insert"></div>'
      + '<p class="muted small">Insert appends this story to the stored blueprint\'s notes field (nothing else changes).</p>';
    rslot.querySelector('[data-slot="story-text"]').appendChild(UI().pre(res.text || ''));
    rslot.querySelector('[data-a="insert-story"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () {
        return api().getBlueprint(p.id).then(function (stored) {
          var next = U().appendStoryToNotes(stored.blueprint, res.text || '');
          return api().putBlueprint(p.id, next).then(function (saved) {
            S().rememberReport('blueprint', 'Blueprint save (story insert)', saved.report);
            rslot.querySelector('[data-slot="story-insert"]').innerHTML =
              '<p><span class="pill green">inserted</span> <span class="muted">Story appended to blueprint notes.</span></p>';
            UI().toast('Story inserted into the project blueprint.', 'success');
          }, function (err) {
            if (err && err.report) {
              S().rememberReport('blueprint', 'Blueprint save (story insert)', err.report);
              rslot.querySelector('[data-slot="story-insert"]').innerHTML =
                UI().reportHtml(err.report, 'Blueprint save failed');
            }
            UI().toast(UI().errorText(err), 'error');
          });
        }, function (err) {
          if (err && err.code === 'blueprint-not-found') {
            UI().toast('No blueprint stored — run the New Game wizard first.', 'error');
            return;
          }
          UI().toast(UI().errorText(err), 'error');
        });
      }, 'Inserting…');
    });
  }

  function loadHistory(root, p) {
    var slot = root.querySelector('[data-slot="history"]');
    if (!S().get('online')) { slot.innerHTML = UI().offlinePanel(); return; }
    api().listAssets(p.id).then(function (res) {
      if (!slot.isConnected) return;
      var assets = res.assets || [];
      if (!assets.length) {
        slot.innerHTML = UI().emptyPanel('No assets yet', 'Generate above or import files in Asset Lab.');
        return;
      }
      slot.innerHTML = '<ul class="asset-list">' + assets.map(function (a) {
        var m = a.meta || {};
        var prov = m.provider ? ' · ' + U().esc(m.provider) + '/' + U().esc(m.model || '?') : '';
        return '<li><code>' + U().esc(a.path) + '</code>'
          + ' <span class="muted">' + (m.width || '?') + '×' + (m.height || '?') + prov + '</span></li>';
      }).join('') + '</ul>';
    }, function (err) {
      if (!slot.isConnected) return;
      slot.innerHTML = UI().errorPanel('Could not load assets', err,
        '<button type="button" class="btn ghost" data-a="retry">' + I('refresh') + 'Retry</button>');
      slot.querySelector('[data-a="retry"]').addEventListener('click', function () { loadHistory(root, p); });
    });
  }

  // ---------- Asset Lab ----------
  function renderLab(root) {
    var p = V().needProject(root);
    if (!p) return;
    root.innerHTML =
      '<div class="view-head"><div><p class="hero-tag">' + I('lab') + ' ASSET FACTORY</p><h2>' + I('lab') + ' Asset Lab</h2>'
      + '<p class="muted">Project: <strong>' + U().esc(p.name) + '</strong> · import, inspect, slice, diagnose.</p></div>'
      + '<div class="row"><button type="button" class="btn ghost" data-a="refresh">' + I('refresh') + 'Refresh assets</button></div></div>'
      + '<div class="grid-2"><section class="panel glass-panel glass-panel-glow"><div class="panel-head"><h3>' + I('plus') + ' Import local file</h3></div>'
      + '<div class="row"><label class="fld grow"><span>Absolute path on this machine</span>'
      + '<input data-f="src" placeholder="C:\\art\\ship.png (.png/.jpg/.jpeg/.webp)"></label>'
      + '<button type="button" class="btn ghost" data-a="browse" title="Open the native file picker when available">Browse…</button></div>'
      + '<div class="form-grid"><label class="fld"><span>Entity</span><input data-f="entity" value="player"></label>'
      + '<label class="fld"><span>Role</span><input data-f="role" value="ship" placeholder="ship"></label>'
      + '<label class="fld"><span>Animation (optional)</span><input data-f="animation" placeholder="fly"></label></div>'
      + '<div class="btn-row"><button type="button" class="btn primary" data-a="import">Import</button></div>'
      + '<p class="muted small">Wave 1 imports local paths only — no remote URLs (contract §4).</p></section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + I('folder') + ' Project assets</h3></div><div data-slot="assets">'
      + UI().loadingPanel('Loading assets…') + '</div></section></div>'
      + '<div class="grid-2"><section class="panel glass-panel"><div class="panel-head"><h3>' + I('info') + ' Inspect</h3></div>'
      + '<label class="fld"><span>Asset path</span><input data-f="inspect-path" placeholder="assets/player/ship.png"></label>'
      + '<div class="btn-row"><button type="button" class="btn ghost" data-a="inspect">Inspect</button> '
      + '<button type="button" class="btn ghost" data-a="palette">Palette (16)</button></div>'
      + '<div data-slot="inspect"></div></section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + I('lab') + ' Slice sprite sheet</h3></div>'
      + '<label class="fld"><span>Sheet path</span><input data-f="sheet" placeholder="assets/player/sheet.png"></label>'
      + '<div class="form-grid">'
      + '<label class="fld"><span>Entity</span><input data-f="s-entity" value="player"></label>'
      + '<label class="fld"><span>Animation</span><input data-f="s-anim" value="fly"></label>'
      + '<label class="fld"><span>Frame rate (1..60)</span><input data-f="fps" type="number" value="8" min="1" max="60"></label>'
      + '<label class="fld"><span>Frame width</span><input data-f="fw" type="number" value="32" min="1"></label>'
      + '<label class="fld"><span>Frame height</span><input data-f="fh" type="number" value="32" min="1"></label>'
      + '<label class="fld"><span>Columns (empty = auto)</span><input data-f="cols" type="number" min="1" placeholder="auto"></label>'
      + '<label class="fld"><span>Rows (empty = auto)</span><input data-f="rows" type="number" min="1" placeholder="auto"></label>'
      + '<label class="fld"><span>Margin</span><input data-f="margin" type="number" value="0" min="0"></label>'
      + '<label class="fld"><span>Spacing</span><input data-f="spacing" type="number" value="0" min="0"></label>'
      + '</div><div class="btn-row"><button type="button" class="btn primary" data-a="slice">Slice</button></div>'
      + '<div data-slot="slice"></div></section></div>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + I('lab') + ' Planned (not in wave 1)</h3></div>'
      + '<div class="btn-row"><button type="button" class="btn ghost" disabled title="Planned — crop UI is not in this build">Crop</button> '
      + '<button type="button" class="btn ghost" disabled title="Planned — frame reordering is not in this build">Frame ordering</button> '
      + '<button type="button" class="btn ghost" disabled title="Planned — tile diagnostics are not in this build">Tile diagnostics</button></div>'
      + '<p class="muted small">Wave 1 covers import, inspect, slice, and palette; the SDD §2.3 items above are explicitly out of scope until a later milestone.</p></section>';
    root.querySelector('[data-a="refresh"]').addEventListener('click', function () { loadLabAssets(root, p); });
    root.querySelector('[data-a="browse"]').addEventListener('click', function () {
      pickFile(root.querySelector('[data-f="src"]'));
    });
    root.querySelector('[data-a="import"]').addEventListener('click', function (e) {
      var body = {
        src: root.querySelector('[data-f="src"]').value.trim(),
        entity: root.querySelector('[data-f="entity"]').value.trim(),
        role: root.querySelector('[data-f="role"]').value.trim(),
      };
      var anim = root.querySelector('[data-f="animation"]').value.trim();
      if (anim) body.animation = anim;
      if (!body.src || !body.entity || !body.role) { UI().toast('src, entity and role are required.', 'error'); return; }
      UI().busy(e.target, function () {
        return api().importAsset(p.id, body).then(function (res) {
          UI().toast('Imported → ' + res.path, 'success');
          loadLabAssets(root, p);
        });
      }, 'Importing…');
    });
    root.querySelector('[data-a="inspect"]').addEventListener('click', function (e) {
      var path = root.querySelector('[data-f="inspect-path"]').value.trim();
      if (!path) { UI().toast('Asset path is required.', 'error'); return; }
      UI().busy(e.target, function () {
        return api().inspectAsset(p.id, path).then(function (res) {
          var slot = root.querySelector('[data-slot="inspect"]');
          slot.innerHTML = '<table class="kv"><tbody>' + UI().kvRows({
            Format: res.format, Mode: res.mode, Size: res.width + '×' + res.height,
            'Has alpha': res.hasAlpha, 'Alpha min/max': (res.alphaMin != null ? res.alphaMin + '/' + res.alphaMax : '—'),
            'Color count (64px)': res.colorCount64, 'Distinct (cap 257)': res.distinctColorsCapped257,
          }) + '</tbody></table>'
            + '<h4>Errors (' + (res.errors || []).length + ')</h4>'
            + UI().issueList((res.errors || []).map(function (m) { return { message: m }; }), 'err')
            + '<h4>Warnings (' + (res.warnings || []).length + ')</h4>'
            + UI().issueList((res.warnings || []).map(function (m) { return { message: m }; }), 'warn');
        });
      }, 'Inspecting…');
    });
    root.querySelector('[data-a="palette"]').addEventListener('click', function (e) {
      var path = root.querySelector('[data-f="inspect-path"]').value.trim();
      if (!path) { UI().toast('Asset path is required.', 'error'); return; }
      UI().busy(e.target, function () {
        return api().paletteAsset(p.id, path, 16).then(function (res) {
          var slot = root.querySelector('[data-slot="inspect"]');
          slot.innerHTML = '<p><span class="muted">sampled ' + res.sampledColors + ' colors · '
            + 'pixel-art hint: ' + U().esc(res.pixelArtHint) + '</span></p>'
            + '<div class="swatches">' + (res.topColors || []).map(function (c) {
              var rgb = 'rgb(' + c.rgb.join(',') + ')';
              return '<span class="sw" style="background:' + rgb + '" title="' + U().esc(rgb + ' ' + Math.round(c.share * 100) + '%') + '"></span>';
            }).join('') + '</div>';
        });
      }, 'Analyzing…');
    });
    root.querySelector('[data-a="slice"]').addEventListener('click', function (e) {
      function num(k) { return root.querySelector('[data-f="' + k + '"]').value; }
      var body = {
        sheet: root.querySelector('[data-f="sheet"]').value.trim(),
        entity: root.querySelector('[data-f="s-entity"]').value.trim(),
        animation: root.querySelector('[data-f="s-anim"]').value.trim(),
        frameRate: Number(num('fps')), frameWidth: Number(num('fw')), frameHeight: Number(num('fh')),
        margin: Number(num('margin')) || 0, spacing: Number(num('spacing')) || 0,
      };
      if (num('cols')) body.columns = Number(num('cols'));
      if (num('rows')) body.rows = Number(num('rows'));
      if (!body.sheet || !body.entity || !body.animation) { UI().toast('Sheet, entity and animation are required.', 'error'); return; }
      UI().busy(e.target, function () {
        return api().sliceAssets(p.id, body).then(function (res) {
          var slot = root.querySelector('[data-slot="slice"]');
          slot.innerHTML = '<p><span class="pill green">sliced</span> <span class="muted">'
            + res.frames.length + ' frames · ' + res.frameRate + ' fps · animation.json written</span></p>';
          slot.appendChild(UI().pre((res.frames || []).join('\n')));
          UI().toast('Sliced ' + res.frames.length + ' frames.', 'success');
          loadLabAssets(root, p);
        });
      }, 'Slicing…');
    });
    loadLabAssets(root, p);
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

  function loadLabAssets(root, p) {
    var slot = root.querySelector('[data-slot="assets"]');
    if (!slot) return;
    if (!S().get('online')) { slot.innerHTML = UI().offlinePanel(); return; }
    api().listAssets(p.id).then(function (res) {
      if (!slot.isConnected) return;
      var assets = res.assets || [];
      if (!assets.length) {
        slot.innerHTML = UI().emptyPanel('No assets yet', 'Import a local file to begin.');
        return;
      }
      slot.innerHTML = '<ul class="asset-list click">' + assets.map(function (a) {
        return '<li><button type="button" data-path="' + U().esc(a.path) + '"><code>'
          + U().esc(a.path) + '</code></button></li>';
      }).join('') + '</ul><p class="muted small">Click a path to fill the inspect / slice forms.</p>';
      slot.querySelectorAll('[data-path]').forEach(function (b) {
        b.addEventListener('click', function () {
          var ip = root.querySelector('[data-f="inspect-path"]');
          var sh = root.querySelector('[data-f="sheet"]');
          if (ip) ip.value = b.dataset.path;
          if (sh && !sh.value) sh.value = b.dataset.path;
          UI().toast('Path filled: ' + b.dataset.path, 'info');
        });
      });
    }, function (err) {
      if (!slot.isConnected) return;
      slot.innerHTML = UI().errorPanel('Could not load assets', err);
    });
  }

  V().register('forge', { title: 'Asset Forge', render: renderForge });
  V().register('lab', { title: 'Asset Lab', render: renderLab });
})();
