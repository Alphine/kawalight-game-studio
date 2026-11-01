// KGSM view: Game Blueprint review/edit/assemble. Registers into KgsmViews.
(function () {
  'use strict';

  function V() { return globalThis.KgsmViews; }
  function U() { return globalThis.KgsmUtil; }
  function UI() { return globalThis.KgsmUi; }
  function S() { return globalThis.KgsmStore; }
  function api() { return globalThis.KgsmApp.api; }
  function icon(name) {
    var I = globalThis.KgsmIcons;
    return I ? I.svg(name) : '';
  }

  function needProject(root) {
    var p = S().current();
    if (!p || p.state === '?') {
      root.innerHTML = UI().emptyPanel('No project selected',
        'Select a project on Home first — the blueprint belongs to a project.',
        '<button type="button" class="btn primary" data-a="go-home">' + icon('home') + 'Go to Home</button>');
      root.querySelector('[data-a="go-home"]').addEventListener('click', function () {
        globalThis.KgsmApp.go('home');
      });
      return null;
    }
    return p;
  }

  function render(root) {
    var p = needProject(root);
    if (!p) return;
    root.innerHTML =
      '<div class="view-head"><div><h2>' + icon('blueprint') + 'Game Blueprint</h2>'
      + '<p class="muted">Project: <strong>' + U().esc(p.name) + '</strong> · '
      + U().esc(p.genre) + ' · inspect and edit before assembly (FR-005).</p></div>'
      + '<div class="row"><button type="button" class="btn ghost" data-a="reload">' + icon('refresh') + 'Reload</button></div></div>'
      + '<div data-slot="body">' + UI().loadingPanel('Loading blueprint…') + '</div>';
    root.querySelector('[data-a="reload"]').addEventListener('click', function () { render(root); });
    load(root, p);
  }

  function load(root, p) {
    var body = root.querySelector('[data-slot="body"]');
    if (!S().get('online')) { body.innerHTML = UI().offlinePanel(); return; }
    api().getBlueprint(p.id).then(function (res) {
      if (!body.isConnected) return;
      showEditor(body, p, res.blueprint);
    }, function (err) {
      if (!body.isConnected) return;
      if (err && err.code === 'blueprint-not-found') {
        body.innerHTML = UI().emptyPanel('No blueprint stored yet',
          'Create one with the New Game wizard, or paste JSON below and save it.')
          + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('plus') + 'New blueprint JSON</h3></div>'
          + '<textarea data-f="json" rows="16" class="json" placeholder="{ … }"></textarea>'
          + '<div class="btn-row"><button type="button" class="btn ghost" data-a="validate">Validate</button> '
          + '<button type="button" class="btn primary" data-a="save">Save blueprint</button></div>'
          + '<div data-slot="report"></div></section>';
        wireEdit(body, p, null);
        return;
      }
      body.innerHTML = UI().errorPanel('Could not load blueprint', err,
        '<button type="button" class="btn ghost" data-a="retry">' + icon('refresh') + 'Retry</button>');
      body.querySelector('[data-a="retry"]').addEventListener('click', function () { load(root, p); });
    });
  }

  function summaryCards(bp) {
    var cards = [
      ['Genre', bp.genre], ['Theme', bp.theme], ['Style', bp.visualStyle],
      ['Runtime', bp.targetRuntime],
      ['Resolution', bp.resolution ? bp.resolution.width + '×' + bp.resolution.height : '—'],
      ['Difficulty', bp.difficulty ? bp.difficulty.preset + ' / ' + (bp.difficulty.ramp || '—') : '—'],
      ['Enemies', (bp.enemies || []).length], ['Seed', bp.seed == null ? 'random' : bp.seed],
    ];
    return '<div class="cards">' + cards.map(function (c) {
      return '<div class="card glass-panel"><span>' + U().esc(c[0]) + '</span><strong>' + U().esc(String(c[1])) + '</strong></div>';
    }).join('') + '</div>';
  }

  function showEditor(body, p, bp) {
    body.innerHTML = summaryCards(bp)
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('info') + 'Design text</h3></div><table class="kv"><tbody>' + UI().kvRows({
        'Game loop': bp.gameLoop, Progression: bp.progression, Scoring: bp.scoring,
        'Win': bp.winCondition, 'Lose': bp.loseCondition,
        'Abilities': (bp.player && bp.player.abilities || []).join(', '),
        'Enemies': (bp.enemies || []).map(function (e) { return e.id + ' — ' + e.role + ' ×' + (e.count || 1); }).join('; '),
      }) + '</tbody></table></section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('blueprint') + 'Edit blueprint JSON</h3></div>'
      + '<textarea data-f="json" rows="18" class="json"></textarea>'
      + '<div class="btn-row"><button type="button" class="btn ghost" data-a="validate">Validate</button> '
      + '<button type="button" class="btn primary" data-a="save">Save blueprint</button> '
      + '<button type="button" class="btn ghost" data-a="assemble">Assemble → config.json</button></div>'
      + '<div data-slot="report"></div><div data-slot="asm"></div></section>';
    body.querySelector('[data-f="json"]').value = JSON.stringify(bp, null, 2);
    wireEdit(body, p, bp);
  }

  function readJson(body) {
    var raw = body.querySelector('[data-f="json"]').value;
    try { return { ok: true, value: JSON.parse(raw) }; }
    catch (e) { return { ok: false, error: 'Invalid JSON: ' + e.message }; }
  }

  function wireEdit(body, p, bp) {
    var reportSlot = body.querySelector('[data-slot="report"]');
    body.querySelector('[data-a="validate"]').addEventListener('click', function (e) {
      var parsed = readJson(body);
      if (!parsed.ok) { UI().toast(parsed.error, 'error'); return; }
      UI().busy(e.target, function () {
        return api().validateBlueprint(parsed.value).then(function (res) {
          S().rememberReport('blueprint', 'Blueprint validation', res.report);
          reportSlot.innerHTML = UI().reportHtml(res.report, 'Blueprint validation');
          UI().toast(res.report.ok ? 'Blueprint is valid.' : 'Blueprint has errors — see report.',
            res.report.ok ? 'success' : 'error');
        });
      }, 'Validating…');
    });
    body.querySelector('[data-a="save"]').addEventListener('click', function (e) {
      var parsed = readJson(body);
      if (!parsed.ok) { UI().toast(parsed.error, 'error'); return; }
      UI().busy(e.target, function () {
        return api().putBlueprint(p.id, parsed.value).then(function (res) {
          S().rememberReport('blueprint', 'Blueprint save', res.report);
          reportSlot.innerHTML = UI().reportHtml(res.report, 'Blueprint save');
          UI().toast('Blueprint saved.', 'success');
          if (V().refreshProjects) V().refreshProjects();
        }, function (err) {
          if (err && err.report) {
            S().rememberReport('blueprint', 'Blueprint save', err.report);
            reportSlot.innerHTML = UI().reportHtml(err.report, 'Blueprint save');
          }
          throw err; // UI().busy owns the error toast
        });
      }, 'Saving…');
    });
    var asmBtn = body.querySelector('[data-a="assemble"]');
    if (asmBtn) asmBtn.addEventListener('click', function (e) {
      UI().busy(e.target, function () {
        return api().assembleBlueprint(p.id).then(function (res) {
          S().rememberReport('assemble', 'Assembly', res.report);
          var slot = body.querySelector('[data-slot="asm"]');
          slot.innerHTML = UI().reportHtml(res.report, 'Assembly (config.json written: '
            + (res.storedConfig ? 'yes' : 'no') + ')');
          UI().toast('Assembled. Review the config in Level Studio / Game Settings.', 'success');
          if (V().refreshProjects) V().refreshProjects();
        });
      }, 'Assembling…');
    });
  }

  V().register('blueprint', { title: 'Game Blueprint', render: render });
  V().needProject = needProject;
})();
