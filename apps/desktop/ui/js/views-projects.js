// KGSM views: Home/Projects + New Game wizard. Registers into KgsmViews.
(function () {
  'use strict';

  function V() { return globalThis.KgsmViews; }
  function U() { return globalThis.KgsmUtil; }
  function UI() { return globalThis.KgsmUi; }
  function S() { return globalThis.KgsmStore; }
  function api() { return globalThis.KgsmApp.api; }
  function go(name) { globalThis.KgsmApp.go(name); }
  function icon(name) {
    var I = globalThis.KgsmIcons;
    return I ? I.svg(name) : '';
  }

  var GENRE_META = {
    'space-shooter': { name: 'Space Shooter', color: '#3b82f6', icon: 'ship',
      blurb: 'Classic 2D shooter with enemy waves and bosses.', tags: ['Shooter', 'Arcade', 'Sci-Fi'] },
    'endless-runner': { name: 'Endless Runner', color: '#ec4899', icon: 'bolt',
      blurb: 'Auto-run with obstacles, power-ups, and high scores.', tags: ['Runner', 'Arcade', 'Casual'] },
    'side-scroller': { name: 'Side-Scroller', color: '#f59e0b', icon: 'steps',
      blurb: 'Action platform adventure with levels and enemies.', tags: ['Platformer', 'Adventure', 'Action'] },
    'battle-2d': { name: 'Battle 2D', color: '#7c5cff', icon: 'swords',
      blurb: 'Bounded 2D action combat with waves and loot.', tags: ['Action', 'Combat', 'Fantasy'] },
    farming: { name: 'Farming', color: '#22c55e', icon: 'barn',
      blurb: 'Plant, grow, harvest, and build your dream farm.', tags: ['Farming', 'Life Sim', 'Management'] },
    'puzzle-match': { name: 'Puzzle Match', color: '#e879f9', icon: 'bolt',
      blurb: 'Swap gems to match three, chain cascades, and beat the move limit.', tags: ['Puzzle', 'Casual', 'Match-3'] },
  };

  var ICONS = {
    ship: '<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" focusable="false"><path d="M30 6 L12 22 L12 16 L6 12 L12 10 L12 4 Z M12 24 L12 34 L18 30 L26 30 Z" fill="COLOR"/></svg>',
    barn: '<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" focusable="false"><path d="M6 20 L22 6 L38 20 V38 H6 Z M18 38 V26 H26 V38" fill="COLOR"/></svg>',
    swords: '<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" focusable="false"><path d="M10 34 L30 8 L34 12 L14 38 Z M34 34 L14 8 L10 12 L30 38 Z" fill="COLOR"/></svg>',
    steps: '<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" focusable="false"><path d="M6 36 H18 V28 H26 V20 H34 V12 H38 V36 Z" fill="COLOR"/></svg>',
    bolt: '<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" focusable="false"><path d="M24 4 L10 26 H20 L18 40 L34 16 H24 Z" fill="COLOR"/></svg>',
  };

  function genreName(g) { return (GENRE_META[g] || {}).name || g; }

  // Pick dark vs white foreground per background luminance (WCAG AA for the
  // genre Select buttons; e.g. amber #f59e0b fails with white text).
  function fgFor(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#fff';
    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum > 0.45 ? '#1a1206' : '#fff';
  }

  // ---------- Home / Projects ----------
  function renderHome(root) {
    var store = S();
    root.innerHTML =
      '<header class="hero glass-panel glass-panel-glow"><div><h1>KAWALIGHT<br>GAME STUDIO MAKER</h1>'
      + '<p>Turn your imagination into playable 2D games</p>'
      + '<p class="sub">Generate assets, build worlds, and create complete games with AI.</p>'
      + '<div class="hero-actions"><button type="button" class="btn primary" data-a="hero-new">' + icon('plus') + 'Create New Game</button> '
      + '<button type="button" class="btn primary" data-a="hero-auto" data-admin-only>' + icon('forge') + 'Auto-Create Game</button> '
      + '<button type="button" class="btn ghost" data-a="hero-demo">' + icon('play') + 'Watch Demo</button></div></div>'
      + '<div class="hero-tag">Where Ideas<br>Become Games</div></header>'
      + '<section><h2>' + icon('gamepad') + 'Choose Game Genre</h2>'
      + '<p class="muted">Select a genre to prefill the New Game wizard.</p>'
      + '<div class="genre-grid">' + U().GENRES.map(function (g) {
        var m = GENRE_META[g];
        return '<div class="genre-card glass-panel"><div class="genre-art">'
          + ICONS[m.icon].split('COLOR').join(m.color) + '</div>'
          + '<h3>' + U().esc(m.name) + '</h3>'
          + '<p>' + U().esc(m.blurb) + '</p>'
          + '<div class="tags">' + m.tags.map(function (t) { return '<span>' + t + '</span>'; }).join('') + '</div>'
          + '<button type="button" class="btn" data-genre="' + g + '" style="background:' + m.color + ';border-color:' + m.color + ';color:' + fgFor(m.color) + '">' + icon('check') + 'Select</button></div>';
      }).join('') + '</div></section>'
      + '<div class="view-head"><div><h2>' + icon('folder') + 'Projects</h2>'
      + '<p class="muted">Status, state machine, and quick actions.</p></div>'
      + '<div class="row"><button type="button" class="btn ghost" data-a="refresh">Refresh</button> '
      + '<button type="button" class="btn primary" data-a="new">' + icon('plus') + 'New Game</button></div></div>'
      + '<div class="grid-2"><section class="panel glass-panel"><div class="panel-head"><h3>' + icon('folder') + 'Projects</h3>'
      + '<label class="check"><input type="checkbox" data-a="arch"> Show archived</label></div>'
      + '<div data-slot="list">' + UI().loadingPanel('Loading projects…') + '</div></section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('info') + 'Selected project</h3></div><div data-slot="detail"></div></section></div>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('export') + 'Recent builds</h3></div>'
      + '<div data-slot="builds"></div>'
      + '<p class="muted small">Storage usage is not exposed by the worker API yet — full build history lives in Export Center.</p></section>';

    root.querySelector('[data-a="new"]').addEventListener('click', function () { go('new'); });
    root.querySelector('[data-a="hero-new"]').addEventListener('click', function () { go('new'); });
    root.querySelector('[data-a="hero-auto"]').addEventListener('click', function () {
      autoFocusAuto = true;
      go('new');
    });
    root.querySelector('[data-a="hero-demo"]').addEventListener('click', function () {
      // No bundled video in wave 1: show an info modal like the HUD mockup
      // instead of a dead-end error toast.
      if (globalThis.KgsmHud && globalThis.KgsmHud.notify) {
        globalThis.KgsmHud.notify('KAWALIGHT STUDIO DEMO',
          'Demo video is not bundled in this build (M2 media item). '
          + 'Try it live: create a game, assemble its blueprint, then Playtest the schematic preview.');
      } else {
        UI().toast('Demo video is not bundled — this is an M2 media item.', 'info');
      }
    });
    root.querySelectorAll('[data-genre]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = U().defaultWizard();
        d.genre = b.dataset.genre;
        wiz = { step: 0, data: d, preview: null };
        var m = GENRE_META[b.dataset.genre];
        UI().toast(m.name + ' selected — template ready.', 'success');
        go('new');
      });
    });
    root.querySelector('[data-a="refresh"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () { return refreshProjects().then(function () { renderHome(root); }); }, 'Refreshing…');
    });
    var arch = root.querySelector('[data-a="arch"]');
    arch.checked = !!store.get('includeArchived');
    arch.addEventListener('change', function () {
      store.set({ includeArchived: arch.checked });
      refreshProjects().then(function () { renderHome(root); }, function (e) {
        UI().toast(UI().errorText(e), 'error');
      });
    });
    loadList(root);
    renderDetail(root);
    loadHomeBuilds(root);
  }

  function refreshProjects() {
    var store = S();
    return api().listProjects(store.get('includeArchived')).then(function (res) {
      store.set({ projects: res.projects || [] });
      if (store.get('currentId') && !store.current()) store.set({ currentId: null });
      globalThis.KgsmApp.renderRail();
      return res.projects || [];
    });
  }

  function loadList(root) {
    var slot = root.querySelector('[data-slot="list"]');
    if (!S().get('online')) { slot.innerHTML = UI().offlinePanel(); return; }
    refreshProjects().then(function (projects) {
      if (!slot.isConnected) return;
      if (!projects.length) {
        slot.innerHTML = UI().emptyPanel('No projects yet',
          'Create your first game to see it here.',
          '<button type="button" class="btn primary" data-a="empty-new">' + icon('plus') + 'Create New Game</button>');
        var b = slot.querySelector('[data-a="empty-new"]');
        if (b) b.addEventListener('click', function () { go('new'); });
        return;
      }
      var cur = S().get('currentId');
      slot.innerHTML = '<ul class="proj-list">' + projects.map(function (p) {
        var g = GENRE_META[p.genre] || {};
        return '<li class="' + (p.id === cur ? 'sel' : '') + (p.archived ? ' archived' : '') + '">'
          + '<button type="button" class="proj-main" data-id="' + U().esc(p.id) + '">'
          + '<span class="dot" style="background:' + U().esc(g.color || '#888') + '"></span>'
          + '<span class="proj-name">' + U().esc(p.name) + '</span>'
          + '<span class="pill mini">' + U().esc(genreName(p.genre)) + '</span>'
          + '<span class="pill mini state">' + U().esc(U().stateLabel(p.state)) + '</span>'
          + (p.archived ? '<span class="pill mini warn">archived</span>' : '')
          + '</button>'
          + '<span class="proj-date">' + U().esc(U().fmtDate(p.updatedAt)) + '</span></li>';
      }).join('') + '</ul>';
      slot.querySelectorAll('.proj-main').forEach(function (btn) {
        btn.addEventListener('click', function () {
          S().set({ currentId: btn.dataset.id });
          // Targeted update only: keep scroll position and focus instead of
          // rebuilding the whole hero + genre grid + list.
          slot.querySelectorAll('li').forEach(function (li) {
            var b = li.querySelector('.proj-main');
            li.classList.toggle('sel', !!b && b.dataset.id === btn.dataset.id);
          });
          renderDetail(root);
          loadHomeBuilds(root);
          globalThis.KgsmApp.renderRail();
        });
      });
    }, function (err) {
      if (!slot.isConnected) return;
      slot.innerHTML = UI().errorPanel('Could not load projects', err,
        '<button type="button" class="btn ghost" data-a="retry">' + icon('refresh') + 'Retry</button>');
      slot.querySelector('[data-a="retry"]').addEventListener('click', function () { loadList(root); });
    });
  }

  function loadHomeBuilds(root) {
    var slot = root.querySelector('[data-slot="builds"]');
    if (!slot) return;
    var p = S().current();
    if (!p || !p.id || p.state === '?') {
      slot.innerHTML = UI().emptyPanel('No project selected',
        'Select a project to see its recent builds.');
      return;
    }
    if (!S().get('online')) { slot.innerHTML = UI().offlinePanel(); return; }
    slot.innerHTML = UI().loadingPanel('Loading builds…');
    api().listExports(p.id).then(function (res) {
      if (!slot.isConnected) return;
      var ex = (res.exports || []).slice(-5).reverse();
      if (!ex.length) {
        slot.innerHTML = UI().emptyPanel('No builds yet',
          'Run Export Center to produce playable + source ZIPs.');
        return;
      }
      slot.innerHTML = '<ul class="asset-list">' + ex.map(function (b) {
        return '<li><code>' + U().esc(b.file) + '</code> <span class="muted">'
          + U().esc(U().fmtBytes(b.bytes)) + ' · ' + U().esc(U().fmtDate(b.createdAt)) + '</span></li>';
      }).join('') + '</ul>';
    }, function (err) {
      if (!slot.isConnected) return;
      slot.innerHTML = UI().errorPanel('Could not load builds', err,
        '<button type="button" class="btn ghost" data-a="b-retry">' + icon('refresh') + 'Retry</button>');
      var rb = slot.querySelector('[data-a="b-retry"]');
      if (rb) rb.addEventListener('click', function () { loadHomeBuilds(root); });
    });
  }

  function renderDetail(root) {
    var slot = root.querySelector('[data-slot="detail"]');
    var p = S().current();
    if (!p) {
      slot.innerHTML = UI().emptyPanel('No project selected',
        'Pick a project from the list, or create a new game.');
      return;
    }
    var t = U().allowedTransitions(p.state);
    slot.innerHTML =
      '<table class="kv"><tbody>' + UI().kvRows({
        Name: p.name, Genre: genreName(p.genre), State: U().stateLabel(p.state),
        Reason: p.stateReason || '—', Updated: U().fmtDate(p.updatedAt),
        Id: p.id,
      }) + '</tbody></table>'
      + '<div class="btn-row">'
      + (t.forward ? '<button type="button" class="btn primary" data-a="fwd">Advance → ' + U().esc(U().stateLabel(t.forward)) + '</button>' : '<span class="pill green">final state</span>')
      + '</div>'
      + '<div class="form-row"><label>Move back (needs reason)<div class="row">'
      + '<select data-f="back"' + (t.backward.length ? '' : ' disabled') + '>' + t.backward.map(function (s) {
        return '<option value="' + s + '">' + U().esc(U().stateLabel(s)) + '</option>';
      }).join('') + '</select>'
      + '<input data-f="back-reason" placeholder="reason (required)" size="22"' + (t.backward.length ? '' : ' disabled') + '>'
      + '<button type="button" class="btn ghost" data-a="back"'
      + (t.backward.length ? '' : ' disabled title="Nothing to move back to from this state"') + '>Move</button></div></label>'
      + (t.backward.length ? '' : '<p class="muted small">Already at the first state — nothing to move back to.</p>') + '</div>'
      + '<div class="form-row"><label>Mark stale<div class="row">'
      + '<input data-f="stale-reason" placeholder="reason (required)" size="22">'
      + '<button type="button" class="btn ghost" data-a="stale">Mark stale</button></div></label></div>'
      + '<div class="btn-row">'
      + '<button type="button" class="btn ghost" data-a="rename">' + icon('sliders') + 'Rename</button>'
      + '<button type="button" class="btn ghost" data-a="dup">' + icon('plus') + 'Duplicate</button>'
      + '<button type="button" class="btn ghost" data-a="arch1">' + (p.archived ? 'Unarchive' : 'Archive') + '</button>'
      + '<button type="button" class="btn ghost danger" data-a="del">' + icon('close') + 'Delete</button></div>'
      + '<p class="muted small">State machine: forward exactly one step; backward any distance with a reason (contract §1).</p>';

    function reload() { refreshProjects().then(function () { renderHome(root); }); }
    var fwdBtn = slot.querySelector('[data-a="fwd"]');
    if (fwdBtn) fwdBtn.addEventListener('click', function (e) {
      UI().busy(e.target, function () {
        return api().transitionProject(p.id, t.forward).then(function () {
          UI().toast('Advanced to ' + U().stateLabel(t.forward), 'success');
          reload();
        });
      }, 'Advancing…');
    });
    var backBtn = slot.querySelector('[data-a="back"]');
    if (backBtn) backBtn.addEventListener('click', function (e) {
      var to = slot.querySelector('[data-f="back"]').value;
      if (!to) { UI().toast('Nothing to move back to from this state.', 'error'); return; }
      var reason = slot.querySelector('[data-f="back-reason"]').value.trim();
      if (!reason) { UI().toast('A reason is required to move back.', 'error'); return; }
      UI().busy(e.target, function () {
        return api().transitionProject(p.id, to, reason).then(function () {
          UI().toast('Moved back to ' + U().stateLabel(to), 'success');
          reload();
        });
      }, 'Moving…');
    });
    slot.querySelector('[data-a="stale"]').addEventListener('click', function (e) {
      var reason = slot.querySelector('[data-f="stale-reason"]').value.trim();
      if (!reason) { UI().toast('A reason is required to mark stale.', 'error'); return; }
      UI().busy(e.target, function () {
        return api().markStale(p.id, reason).then(function () {
          UI().toast('Project marked stale.', 'success');
          reload();
        });
      }, 'Marking…');
    });
    function nameError(v) {
      return U().isValidProjectName(v) ? '' : 'Name must be 1..80 characters.';
    }
    slot.querySelector('[data-a="rename"]').addEventListener('click', function () {
      UI().promptModal('Rename project', p.name, nameError).then(function (name) {
        if (name == null) return;
        api().patchProject(p.id, { name: name }).then(function () {
          UI().toast('Renamed.', 'success'); reload();
        }, function (e) { UI().toast(UI().errorText(e), 'error'); });
      });
    });
    slot.querySelector('[data-a="dup"]').addEventListener('click', function () {
      UI().promptModal('Duplicate project', p.name + ' (copy)', nameError).then(function (name) {
        if (name == null) return;
        api().duplicateProject(p.id, name).then(function (np) {
          UI().toast('Duplicated as "' + np.name + '".', 'success');
          S().set({ currentId: np.id });
          reload();
        }, function (e) { UI().toast(UI().errorText(e), 'error'); });
      });
    });
    slot.querySelector('[data-a="arch1"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () {
        return api().patchProject(p.id, { archived: !p.archived }).then(function () {
          UI().toast(p.archived ? 'Unarchived.' : 'Archived.', 'success');
          reload();
        });
      });
    });
    slot.querySelector('[data-a="del"]').addEventListener('click', function () {
      UI().confirmModal('Delete project?',
        'This removes "' + p.name + '" and its directory. This cannot be undone; back up first from Export Center.',
        'Delete', true).then(function (ok) {
        if (!ok) return;
        api().deleteProject(p.id).then(function () {
          UI().toast('Deleted.', 'success');
          S().set({ currentId: null });
          reload();
        }, function (e) { UI().toast(UI().errorText(e), 'error'); });
      });
    });
  }

  // ---------- New Game wizard ----------
  var STEPS = ['Basics', 'Setup', 'Gameplay', 'Preview'];
  var wiz = null;
  var themeCache = null; // parsed data/themes.json, fetched once
  var themeLoadFailed = false;

  function renderWizard(root) {
    if (!wiz) wiz = { step: 0, data: U().defaultWizard(), preview: null };
    var w = wiz.data;
    root.innerHTML =
      '<div class="view-head"><div><h2>' + icon('plus') + 'New Game Wizard</h2>'
      + '<p class="muted">Genre, theme, style, runtime → blueprint preview. Nothing is stored until you create the project.</p></div></div>'
      + autoPanelHtml()
      + '<ol class="steps">' + STEPS.map(function (s, i) {
        return '<li class="' + (i === wiz.step ? 'cur' : i < wiz.step ? 'done' : '') + '"'
          + (i === wiz.step ? ' aria-current="step"' : '') + '>' + (i + 1) + '. ' + s + '</li>';
      }).join('') + '</ol>'
      + '<section class="panel glass-panel"><div data-slot="body"></div>'
      + '<div class="btn-row wizard-nav"><button type="button" class="btn ghost" data-a="prev">← Back</button>'
      + '<button type="button" class="btn primary" data-a="next">Next →</button></div></section>';
    renderStep(root.querySelector('[data-slot="body"]'));
    wireAutoPanel(root);
    if (autoFocusAuto) {
      autoFocusAuto = false;
      var autoPrompt = root.querySelector('[data-auto="prompt"]');
      if (autoPrompt) {
        if (autoPrompt.scrollIntoView) { try { autoPrompt.scrollIntoView(); } catch (e) { /* ignore */ } }
        autoPrompt.focus();
      }
    }
    var prev = root.querySelector('[data-a="prev"]');
    var next = root.querySelector('[data-a="next"]');
    prev.disabled = wiz.step === 0;
    next.textContent = wiz.step === STEPS.length - 1 ? 'Finish (create below)' : 'Next →';
    prev.addEventListener('click', function () {
      collectStep(root);
      wiz.step = Math.max(0, wiz.step - 1);
      renderWizard(root);
    });
    next.addEventListener('click', function () {
      var errs = collectStep(root);
      if (errs.length) { UI().toast(errs[0], 'error'); return; }
      wiz.step = Math.min(STEPS.length - 1, wiz.step + 1);
      if (wiz.step === STEPS.length - 1) wiz.preview = U().buildWizardBlueprint(wiz.data);
      renderWizard(root);
    });
  }

  function field(label, inner) {
    return '<label class="fld"><span>' + label + '</span>' + inner + '</label>';
  }

  function renderStep(body) {
    var w = wiz.data;
    if (wiz.step === 0) {
      body.innerHTML = '<div class="form-grid">'
        + field('Project name', '<input data-f="name" value="' + U().esc(w.name) + '" maxlength="80" placeholder="My Space Game">')
        + field('Genre', '<select data-f="genre">' + U().GENRES.map(function (g) {
          var m = GENRE_META[g];
          return '<option value="' + g + '"' + (w.genre === g ? ' selected' : '') + '>'
            + m.name + '</option>';
        }).join('') + '</select>')
        + field('Theme', '<input data-f="theme" value="' + U().esc(w.theme) + '" maxlength="120" placeholder="Neon asteroid belt">')
        + field('Visual style', '<select data-f="visualStyle">'
          + ['pixel-art', 'illustrated-2d'].map(function (s) {
            return '<option' + (w.visualStyle === s ? ' selected' : '') + '>' + s + '</option>';
          }).join('') + '</select>')
        + field('Target runtime', '<select data-f="targetRuntime">'
          + ['phaser3-html5', 'godot4'].map(function (s) {
            return '<option' + (w.targetRuntime === s ? ' selected' : '') + '>' + s + '</option>';
          }).join('') + '</select>')
        + '</div><p class="muted small">All five genres assemble into engine-ready configs with per-genre Level Studio editors.</p>'
        + '<h4>' + icon('forge') + 'Theme presets</h4><div data-slot="themes">' + UI().loadingPanel('Loading theme presets…') + '</div>';
      wireThemePicker(body);
    } else if (wiz.step === 1) {
      body.innerHTML = '<div class="form-grid">'
        + field('Width (480..1920)', '<input data-f="width" type="number" min="480" max="1920" value="' + w.width + '">')
        + field('Height (270..1080)', '<input data-f="height" type="number" min="270" max="1080" value="' + w.height + '">')
        + field('Controls', '<select data-f="scheme">'
          + ['keyboard', 'keyboard-gamepad', 'mouse-keyboard'].map(function (s) {
            return '<option' + (w.scheme === s ? ' selected' : '') + '>' + s + '</option>';
          }).join('') + '</select>')
        + field('Difficulty', '<select data-f="difficulty">'
          + ['easy', 'normal', 'hard'].map(function (s) {
            return '<option' + (w.difficulty === s ? ' selected' : '') + '>' + s + '</option>';
          }).join('') + '</select>')
        + field('Difficulty ramp', '<select data-f="ramp">'
          + ['flat', 'gradual', 'steep'].map(function (s) {
            return '<option' + (w.ramp === s ? ' selected' : '') + '>' + s + '</option>';
          }).join('') + '</select>')
        + field('Seed (empty = random)', '<input data-f="seed" type="number" min="0" value="' + U().esc(w.seed) + '" placeholder="empty">')
        + '</div><label class="check"><input type="checkbox" data-f="remappable"' + (w.remappable ? ' checked' : '') + '> Remappable controls (P2 preview — stored, template ignores it)</label>';
    } else if (wiz.step === 2) {
      var foeWord = U().foeWordFor(w.genre);
      body.innerHTML =
        field('Game loop', '<textarea data-f="gameLoop" rows="2">' + U().esc(w.gameLoop) + '</textarea>')
        + '<div class="form-grid">'
        + field('Abilities (comma separated)', '<input data-f="abilities" value="' + U().esc(w.abilities.join(', ')) + '">')
        + field('Health (1..99)', '<input data-f="health" type="number" min="1" max="99" value="' + w.health + '">')
        + field('Lives (1..9)', '<input data-f="lives" type="number" min="1" max="9" value="' + w.lives + '">')
        + '</div>'
        + '<h4>' + icon('gamepad') + U().esc(foeWord + 's') + '</h4><div data-slot="enemies"></div>'
        + '<button type="button" class="btn ghost" data-a="add-enemy">' + icon('plus') + 'Add ' + U().esc(foeWord.toLowerCase()) + '</button>'
        + field('Progression', '<textarea data-f="progression" rows="2">' + U().esc(w.progression) + '</textarea>')
        + field('Scoring', '<textarea data-f="scoring" rows="2">' + U().esc(w.scoring) + '</textarea>')
        + '<div class="form-grid">'
        + field('Win condition', '<input data-f="winCondition" value="' + U().esc(w.winCondition) + '">')
        + field('Lose condition', '<input data-f="loseCondition" value="' + U().esc(w.loseCondition) + '">')
        + '</div>'
        + field('Notes (optional)', '<textarea data-f="notes" rows="2">' + U().esc(w.notes) + '</textarea>');
      var list = body.querySelector('[data-slot="enemies"]');
      renderEnemies(list);
      body.querySelector('[data-a="add-enemy"]').addEventListener('click', function () {
        collectEnemies(body);
        wiz.data.enemies.push({ id: 'enemy-' + (wiz.data.enemies.length + 1), role: '', count: 4 });
        renderEnemies(list);
      });
    } else {
      wiz.preview = U().buildWizardBlueprint(wiz.data);
      body.innerHTML = '<div data-slot="report"></div><h4>' + icon('blueprint') + 'Blueprint preview</h4><div data-slot="json"></div>'
        + '<div class="btn-row"><button type="button" class="btn ghost" data-a="validate">Validate (stateless)</button> '
        + '<button type="button" class="btn primary" data-a="create">Create project + save blueprint</button></div>'
        + '<p class="muted small">Create → POST /projects, then PUT /projects/{id}/blueprint. Assemble runs from the Blueprint view.</p>';
      body.querySelector('[data-slot="json"]').appendChild(
        UI().pre(JSON.stringify(wiz.preview, null, 2)));
      body.querySelector('[data-a="validate"]').addEventListener('click', function (e) {
        var errs = U().validateWizardLocal(wiz.data);
        if (errs.length) { UI().toast(errs[0], 'error'); return; }
        UI().busy(e.target, function () {
          return api().validateBlueprint(wiz.preview).then(function (res) {
            S().rememberReport('wizard', 'Wizard blueprint', res.report);
            body.querySelector('[data-slot="report"]').innerHTML = UI().reportHtml(res.report, 'Wizard blueprint');
            UI().toast(res.report.ok ? 'Blueprint is valid.' : 'Blueprint has errors — see report.', res.report.ok ? 'success' : 'error');
          });
        }, 'Validating…');
      });
      body.querySelector('[data-a="create"]').addEventListener('click', function (e) {
        var errs = U().validateWizardLocal(wiz.data);
        if (errs.length) { UI().toast(errs[0], 'error'); return; }
        UI().busy(e.target, function () {
          return api().createProject(wiz.data.name.trim(), wiz.data.genre).then(function (p) {
            return api().putBlueprint(p.id, wiz.preview).then(function () {
              S().set({ currentId: p.id });
              UI().toast('Project "' + p.name + '" created; blueprint saved.', 'success');
              wiz = null;
              return refreshProjects().then(function () { go('blueprint'); });
            }, function (err) {
              // Project exists but blueprint rejected: still select it for repair.
              S().set({ currentId: p.id });
              if (err && err.report) S().rememberReport('blueprint', 'Blueprint save', err.report);
              UI().toast('Project created but blueprint invalid: ' + UI().errorText(err), 'error');
              return refreshProjects().then(function () { go('blueprint'); });
            });
          });
        }, 'Creating…');
      });
    }
  }

  function renderEnemies(list) {
    var foeLower = U().foeWordFor(wiz.data.genre).toLowerCase();
    list.innerHTML = wiz.data.enemies.map(function (e, i) {
      return '<div class="row enemy-row"><input data-e="id" data-i="' + i + '" value="' + U().esc(e.id) + '" placeholder="id" size="14">'
        + '<input data-e="role" data-i="' + i + '" value="' + U().esc(e.role) + '" placeholder="role" size="34">'
        + '<input data-e="count" data-i="' + i + '" type="number" min="1" max="512" value="' + e.count + '" title="count" style="width:5em">'
        + '<button type="button" class="btn ghost danger" data-a="rm" data-i="' + i + '">' + icon('close') + 'Remove</button></div>';
    }).join('') || '<p class="muted">No ' + U().esc(foeLower + 's') + ' — add at least one.</p>';
    list.querySelectorAll('[data-a="rm"]').forEach(function (b) {
      b.addEventListener('click', function () {
        collectEnemies(list.closest('section') || document);
        wiz.data.enemies.splice(Number(b.dataset.i), 1);
        renderEnemies(list);
      });
    });
  }

  function collectEnemies(scope) {
    scope.querySelectorAll('[data-e]').forEach(function (inp) {
      var i = Number(inp.dataset.i);
      if (!wiz.data.enemies[i]) return;
      if (inp.dataset.e === 'count') wiz.data.enemies[i].count = Number(inp.value);
      else wiz.data.enemies[i][inp.dataset.e] = inp.value;
    });
  }

  // Theme picker: genre -> theme cards -> wizard prefill. Picking a theme
  // only prefills; every field stays manually editable afterwards.
  function wireThemePicker(body) {
    var genreSel = body.querySelector('[data-f="genre"]');
    if (genreSel) genreSel.addEventListener('change', function () {
      wiz.data.genre = genreSel.value;
      paintThemeCards(body);
    });
    paintThemeCards(body);
  }

  function paintThemeCards(body) {
    var slot = body.querySelector('[data-slot="themes"]');
    if (!slot) return;
    var sel = body.querySelector('[data-f="genre"]');
    var genre = sel ? sel.value : wiz.data.genre;
    if (themeCache) {
      var list = themeCache[genre] || [];
      if (!list.length) {
        slot.innerHTML = UI().emptyPanel('No presets for this genre',
          'Fill the fields manually — every option stays editable.');
        return;
      }
      slot.innerHTML = '<div class="genre-grid">' + list.map(function (t) {
        return '<div class="genre-card glass-panel"><h3>' + U().esc(t.name || t.id) + '</h3>'
          + '<p>' + U().esc(t.gameLoop || t.theme || '') + '</p>'
          + '<div class="tags"><span>' + U().esc(t.visualStyle || '') + '</span>'
          + '<span>' + U().esc((t.difficulty || {}).preset || '') + '</span></div>'
          + '<button type="button" class="btn" data-theme="' + U().esc(t.id) + '">Use this theme</button></div>';
      }).join('') + '</div>'
        + '<p class="muted small">Picking a theme prefills the wizard — every field stays editable.</p>';
      slot.querySelectorAll('[data-theme]').forEach(function (b) {
        b.addEventListener('click', function () {
          var picked = null;
          list.forEach(function (t) { if (t.id === b.dataset.theme) picked = t; });
          if (!picked) return;
          collectStep(body); // keep any typed values the theme does not cover
          wiz.data = U().applyThemeToWizard(wiz.data, picked);
          renderStep(body);
          wireThemePicker(body);
          UI().toast('Theme "' + (picked.name || picked.id) + '" applied — review and edit freely.', 'success');
        });
      });
      return;
    }
    if (themeLoadFailed) {
      slot.innerHTML = '<p class="muted small">Theme presets unavailable — fill the fields manually.</p>';
      return;
    }
    fetch('data/themes.json').then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      if (!isValidThemeData(data)) throw new Error('bad theme data shape');
      themeCache = data;
      if (slot.isConnected) paintThemeCards(body);
    }, function () {
      themeCache = null;
      themeLoadFailed = true;
      if (slot.isConnected) paintThemeCards(body);
    });
  }

  // Shape-check data/themes.json before use: a malformed local file (or a
  // bundle missing it) falls back to manual fields instead of breaking the
  // picker. Rendering stays escaped regardless.
  function isValidThemeData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    var genres = U().GENRES;
    for (var i = 0; i < genres.length; i++) {
      var list = data[genres[i]];
      if (list === undefined) continue; // picker tolerates a missing genre
      if (!Array.isArray(list)) return false;
      for (var j = 0; j < list.length; j++) {
        var t = list[j];
        if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id) return false;
      }
    }
    return true;
  }

  // Error-message keywords owned by each wizard step (from validateWizardLocal).
  var STEP_KEYS = [
    ['Project name', 'Unknown genre', 'Theme'],
    ['Width', 'Height', 'Seed'], // Seed input lives on the Setup step
    ['Game loop', 'ability', 'health', 'lives', 'Enemy', 'enemy',
      'Obstacle', 'obstacle', 'Progression',
      'Scoring', 'Win condition', 'Lose condition'],
    null, // Preview: full check
  ];

  // Copies visible step fields into wiz.data; returns the local validation
  // errors relevant to the current step so Next blocks early with feedback.
  function collectStep(root) {
    var w = wiz.data;
    root.querySelectorAll('[data-f]').forEach(function (inp) {
      var k = inp.dataset.f;
      if (inp.type === 'checkbox') w[k] = inp.checked;
      else if (inp.type === 'number') w[k] = inp.value === '' ? '' : Number(inp.value);
      else if (k === 'abilities') w.abilities = inp.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      else w[k] = inp.value;
    });
    collectEnemies(root);
    var all = U().validateWizardLocal(w);
    var keys = STEP_KEYS[wiz.step];
    if (!keys) return all;
    return all.filter(function (msg) {
      return keys.some(function (k) { return msg.indexOf(k) >= 0; });
    });
  }

  // ---------- AUTO mode (one-click pipeline) ----------
  // Self-contained in this file by design: no shared-file edits allowed, so
  // the starter theme map mirrors worker kgsm/auto.py STARTERS (id + label).
  var autoFocusAuto = false;

  var AUTO_THEMES = {
    'space-shooter': [
      ['alien-invasion', 'Alien Invasion (default)'],
      ['neon-swarm', 'Neon Swarm'],
      ['pirate-belt', 'Pirate Belt'],
    ],
    'endless-runner': [
      ['neon-rooftops', 'Neon Rooftops (default)'],
      ['desert-dash', 'Desert Dash'],
      ['ember-caverns', 'Ember Caverns'],
    ],
    'side-scroller': [
      ['mossy-cliffs', 'Mossy Cliffs (default)'],
      ['lava-caves', 'Lava Caves'],
      ['sky-ruins', 'Sky Ruins'],
    ],
    'battle-2d': [
      ['monster-arena', 'Monster Arena (default)'],
      ['robot-foundry', 'Robot Foundry'],
      ['shadow-crypt', 'Shadow Crypt'],
    ],
    farming: [
      ['sunny-acres', 'Sunny Acres (default)'],
      ['moonlit-grove', 'Moonlit Grove'],
      ['tidepool-farm', 'Tidepool Farm'],
    ],
    'puzzle-match': [
      ['gem-rush', 'Gem Rush (default)'],
      ['crystal-caverns', 'Crystal Caverns'],
      ['sunset-bazaar', 'Sunset Bazaar'],
    ],
  };

  var AUTO_STEPS = ['Create project', 'Build blueprint', 'Assemble', 'Validate', 'Package playable'];

  function autoThemeOptions(genre) {
    var list = AUTO_THEMES[genre] || [];
    return '<option value="">Auto (match prompt)</option>' + list.map(function (t) {
      return '<option value="' + U().esc(t[0]) + '">' + U().esc(t[1]) + '</option>';
    }).join('');
  }

  function autoPanelHtml() {
    var w = wiz.data;
    return '<section class="panel glass-panel glass-panel-glow auto-panel" data-slot="auto"><div class="panel-head"><h3>'
      + icon('forge') + 'AUTO — one-click game</h3><span class="pill mini">offline · deterministic</span></div>'
      + '<p class="muted small">Describe your game, pick a genre, hit Auto — the worker creates the project, '
      + 'builds and assembles the blueprint, validates it, and packages a playable ZIP. '
      + 'Success jumps straight to Playtest.</p>'
      + '<div class="form-grid">'
      + field('Project name (blank = auto)', '<input data-auto="name" value="' + U().esc(w.name) + '" maxlength="80" placeholder="Auto Space Shooter">')
      + field('Genre', '<select data-auto="genre">' + U().GENRES.map(function (g) {
        return '<option value="' + g + '"' + (w.genre === g ? ' selected' : '') + '>'
          + U().esc(genreName(g)) + '</option>';
      }).join('') + '</select>')
      + field('Theme (optional — overrides prompt)', '<select data-auto="theme">' + autoThemeOptions(w.genre) + '</select>')
      + '</div>'
      + field('Prompt — theme hint, stored in blueprint notes', '<textarea data-auto="prompt" rows="3" maxlength="4000" '
        + 'placeholder="e.g. neon alien raid over a ruined city"></textarea>')
      + '<div class="btn-row"><button type="button" class="btn primary" data-a="auto-run">'
      + icon('forge') + 'Auto-create &amp; Playtest</button></div>'
      + '<div data-auto-slot="progress"></div><div data-auto-slot="report"></div></section>';
  }

  function autoPaintProgress(scope, state) {
    // state: -1 idle, 0..N-1 running index, N done, -2 failed.
    var slot = scope.querySelector('[data-auto-slot="progress"]');
    if (!slot) return;
    if (state === -1) { slot.innerHTML = ''; return; }
    slot.innerHTML = '<ol class="steps">' + AUTO_STEPS.map(function (s, i) {
      var cls = '';
      if (state === AUTO_STEPS.length || i < state) cls = 'done';
      else if (i === state) cls = state === -2 ? '' : 'cur';
      if (state === -2 && i === 0) cls = '';
      return '<li class="' + cls + '"' + (i === state && state >= 0 ? ' aria-current="step"' : '') + '>'
        + (i + 1) + '. ' + s + '</li>';
    }).join('') + '</ol>'
      + (state === -2 ? '<p class="err-msg" role="alert">AUTO run failed — see the report below.</p>'
        : state === AUTO_STEPS.length ? '<p class="success-msg small" role="status">Done — opening Playtest…</p>'
        : '<p class="muted small">Running on the worker (one call)…</p>');
  }

  function wireAutoPanel(root) {
    var panel = root.querySelector('[data-slot="auto"]');
    if (!panel) return;
    var genreSel = panel.querySelector('[data-auto="genre"]');
    var themeSel = panel.querySelector('[data-auto="theme"]');
    genreSel.addEventListener('change', function () {
      themeSel.innerHTML = autoThemeOptions(genreSel.value);
    });
    panel.querySelector('[data-a="auto-run"]').addEventListener('click', function (e) {
      runAuto(panel, e.target);
    });
  }

  function runAuto(panel, btn) {
    if (!S().get('online')) {
      UI().toast('Worker offline — start the worker before AUTO mode.', 'error');
      return;
    }
    var genre = panel.querySelector('[data-auto="genre"]').value;
    var name = panel.querySelector('[data-auto="name"]').value.trim();
    var prompt = panel.querySelector('[data-auto="prompt"]').value;
    var themeId = panel.querySelector('[data-auto="theme"]').value;
    if (U().GENRES.indexOf(genre) < 0) { UI().toast('Unknown genre.', 'error'); return; }
    if (!name) name = 'Auto ' + genreName(genre);
    if (!U().isValidProjectName(name)) { UI().toast('Name must be 1..80 characters.', 'error'); return; }
    var body = { name: name, genre: genre };
    if (prompt.trim()) body.prompt = prompt;
    if (themeId) body.themeId = themeId;
    panel.querySelector('[data-auto-slot="report"]').innerHTML = '';
    autoPaintProgress(panel, 0);
    UI().setBusy(btn, true, 'Auto-creating…');
    api().generateAuto(body).then(function (res) {
      UI().setBusy(btn, false);
      if (!panel.isConnected) return;
      autoPaintProgress(panel, AUTO_STEPS.length);
      if (res && res.validation) S().rememberReport('auto', 'AUTO validation', res.validation);
      var p = res && res.project;
      UI().toast('AUTO created "' + (p ? p.name : name) + '" — playable packaged.', 'success');
      if (p && p.id) S().set({ currentId: p.id });
      wiz = null;
      refreshProjects().then(function () { go('playtest'); });
    }, function (err) {
      UI().setBusy(btn, false);
      if (!panel.isConnected) { UI().toast(UI().errorText(err), 'error'); return; }
      autoPaintProgress(panel, -2);
      // Contract: 422s carry the validation report — show it inline.
      if (err && err.report) {
        S().rememberReport('auto', 'AUTO validation', err.report);
        panel.querySelector('[data-auto-slot="report"]').innerHTML =
          UI().reportHtml(err.report, 'AUTO validation report');
      } else {
        panel.querySelector('[data-auto-slot="report"]').innerHTML =
          UI().errorPanel('AUTO run failed', err, '');
      }
      UI().toast(UI().errorText(err), 'error');
    });
  }

  V().register('home', { title: 'Home', render: renderHome });
  V().register('new', { title: 'New Game', render: renderWizard });
  V().refreshProjects = refreshProjects;
})();
