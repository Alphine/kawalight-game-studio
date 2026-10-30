// KGSM views: Level Studio + Game Settings (shared config.json editor).
// Level Studio owns level content (waves, obstacles, platforms, crops, ...);
// Game Settings owns world/player/scoring/difficulty/controls via the
// descriptor spec in KgsmUtil.gameSettingsSpec (paths are disjoint).
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

  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, obj);
  }
  function setPath(obj, path, value) {
    var ks = path.split('.');
    var o = obj;
    for (var i = 0; i < ks.length - 1; i++) {
      if (o[ks[i]] == null) o[ks[i]] = {};
      o = o[ks[i]];
    }
    o[ks[ks.length - 1]] = value;
  }
  function delPath(obj, path) {
    var ks = path.split('.');
    var o = obj;
    for (var i = 0; i < ks.length - 1; i++) {
      o = o == null ? o : o[ks[i]];
    }
    if (o != null) delete o[ks[ks.length - 1]];
  }
  function num(label, path, cfg, attrs) {
    return '<label class="fld"><span>' + U().esc(label) + '</span><input data-c="' + path
      + '" type="number" value="' + U().esc(getPath(cfg, path)) + '" ' + (attrs || '') + '></label>';
  }
  function optNum(label, path, cfg, attrs) {
    var v = getPath(cfg, path);
    return '<label class="fld"><span>' + U().esc(label) + ' (optional)</span><input data-c="' + path
      + '" data-c-opt="1" type="number" value="' + U().esc(v == null ? '' : v) + '" ' + (attrs || '') + '></label>';
  }
  function txt(label, path, cfg) {
    return '<label class="fld"><span>' + U().esc(label) + '</span><input data-c="' + path
      + '" value="' + U().esc(getPath(cfg, path)) + '"></label>';
  }
  function optTxt(label, path, cfg) {
    var v = getPath(cfg, path);
    return '<label class="fld"><span>' + U().esc(label) + ' (optional)</span><input data-c="' + path
      + '" data-c-opt="1" value="' + U().esc(v == null ? '' : v) + '"></label>';
  }
  function sel(label, path, cfg, options) {
    var cur = getPath(cfg, path);
    return '<label class="fld"><span>' + U().esc(label) + '</span><select data-c="' + path + '">'
      + options.map(function (o) {
        return '<option value="' + U().esc(o) + '"' + (cur === o ? ' selected' : '') + '>'
          + U().esc(o) + '</option>';
      }).join('') + '</select></label>';
  }
  function cell(path, v, w) {
    return '<td><input data-c="' + path + '" type="text" value="' + U().esc(v) + '" style="width:' + (w || '5em') + '"></td>';
  }
  function ncell(path, v, w) {
    return '<td><input data-c="' + path + '" type="number" value="' + U().esc(v) + '" style="width:' + (w || '4.5em') + '"></td>';
  }
  function optNCell(path, v, w) {
    return '<td><input data-c="' + path + '" data-c-opt="1" type="number" value="'
      + U().esc(v == null ? '' : v) + '" style="width:' + (w || '4.5em') + '"></td>';
  }
  function selCell(path, cur, options) {
    return '<td><select data-c="' + path + '">' + options.map(function (o) {
      return '<option' + (cur === o ? ' selected' : '') + '>' + U().esc(o) + '</option>';
    }).join('') + '</select></td>';
  }
  function checkCell(path, v) {
    return '<td><input data-c="' + path + '" type="checkbox"' + (v ? ' checked' : '') + '></td>';
  }
  function table(headers, rows) {
    return '<div class="table-wrap"><table class="tbl"><thead><tr>'
      + headers.map(function (h) { return '<th>' + U().esc(h) + '</th>'; }).join('')
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  var ROW_NOTE = '<p class="muted small">Row add/remove is a later item — edit values here; '
    + 'assemble a fresh config to reset the level layout.</p>';

  function shell(root, title, sub) {
    var headIcon = title === 'Level Studio' ? icon('levels') : icon('sliders');
    root.innerHTML =
      '<div class="view-head"><div><h2>' + headIcon + title + '</h2><p class="muted">' + sub + '</p></div>'
      + '<div class="row"><button type="button" class="btn ghost" data-a="reload">' + icon('refresh') + 'Reload</button></div></div>'
      + '<div data-slot="body">' + UI().loadingPanel('Loading config…') + '</div>';
    root.querySelector('[data-a="reload"]').addEventListener('click', function () {
      (title === 'Level Studio' ? renderLevels : renderGameSettings)(root);
    });
  }

  function loadConfig(body, p, onOk) {
    if (!S().get('online')) { body.innerHTML = UI().offlinePanel(); return; }
    api().getConfig(p.id).then(function (res) {
      if (!body.isConnected) return;
      onOk(res.config);
    }, function (err) {
      if (!body.isConnected) return;
      if (err && err.code === 'config-not-found') {
        body.innerHTML = UI().emptyPanel('No config.json yet',
          'Assemble the stored blueprint to create the engine-ready config, then tune it here.',
          '<button type="button" class="btn primary" data-a="asm">Assemble from blueprint</button>');
        body.querySelector('[data-a="asm"]').addEventListener('click', function (e) {
          UI().busy(e.target, function () {
            return api().assembleBlueprint(p.id).then(function (res) {
              S().rememberReport('assemble', 'Assembly', res.report);
              UI().toast('Assembled — reloading config.', 'success');
              loadConfig(body, p, onOk);
            });
          }, 'Assembling…');
        });
        return;
      }
      body.innerHTML = UI().errorPanel('Could not load config', err);
    });
  }

  function collect(body, cfg) {
    body.querySelectorAll('[data-c]').forEach(function (inp) {
      var path = inp.dataset.c;
      if (inp.type === 'checkbox') { setPath(cfg, path, inp.checked); return; }
      if (inp.dataset.cOpt && inp.value === '') { delPath(cfg, path); return; }
      var v = (inp.tagName === 'SELECT' || inp.type === 'text') ? inp.value : Number(inp.value);
      setPath(cfg, path, v);
    });
    return cfg;
  }

  function footer() {
    return '<section class="panel glass-panel"><div class="btn-row">'
      + '<button type="button" class="btn ghost" data-a="validate">Validate</button> '
      + '<button type="button" class="btn primary" data-a="save">Save config</button></div>'
      + '<div data-slot="report"></div></section>';
  }

  function wireFooter(body, p, getCfg) {
    var reportSlot = body.querySelector('[data-slot="report"]');
    body.querySelector('[data-a="validate"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () {
        return api().validateConfig(p.genre, getCfg()).then(function (res) {
          S().rememberReport('config', 'Config validation', res.report);
          reportSlot.innerHTML = UI().reportHtml(res.report, 'Config validation');
          UI().toast(res.report.ok ? 'Config is valid.' : 'Config has errors — see report.',
            res.report.ok ? 'success' : 'error');
        });
      }, 'Validating…');
    });
    body.querySelector('[data-a="save"]').addEventListener('click', function (e) {
      UI().busy(e.target, function () {
        return api().putConfig(p.id, getCfg()).then(function (res) {
          S().rememberReport('config', 'Config save', res.report);
          reportSlot.innerHTML = UI().reportHtml(res.report, 'Config save');
          UI().toast('Config saved.', 'success');
        }, function (err) {
          if (err && err.report) {
            S().rememberReport('config', 'Config save', err.report);
            reportSlot.innerHTML = UI().reportHtml(err.report, 'Config save');
          }
          UI().toast(UI().errorText(err), 'error');
          throw err;
        });
      }, 'Saving…');
    });
  }

  // ---------- Level Studio ----------
  var LEVEL_SUBS = {
    'space-shooter': 'waves, enemies, progression.',
    'battle-2d': 'waves, enemies, arena spawning, pickups.',
    'endless-runner': 'pacing, spawning, obstacles.',
    'side-scroller': 'level geometry, hazards, enemies, checkpoints, exit.',
    farming: 'field layout, crops.',
  };

  function renderLevels(root) {
    var p = V().needProject(root);
    if (!p) return;
    shell(root, 'Level Studio', 'Project: <strong>' + U().esc(p.name) + '</strong> · '
      + U().esc(LEVEL_SUBS[p.genre] || 'level content.'));
    loadConfig(root.querySelector('[data-slot="body"]'), p, function (cfg) {
      showLevels(root.querySelector('[data-slot="body"]'), p, cfg);
    });
  }

  function showLevels(body, p, cfg) {
    if (p.genre === 'endless-runner') showRunnerLevels(body, p, cfg);
    else if (p.genre === 'side-scroller') showScrollerLevels(body, p, cfg);
    else if (p.genre === 'farming') showFarmLevels(body, p, cfg);
    else showWaveLevels(body, p, cfg);
  }

  // space-shooter + battle-2d: enemies table, waves, progression.
  function showWaveLevels(body, p, cfg) {
    var battle = p.genre === 'battle-2d';
    var behaviors = battle ? ['chaser', 'weaver', 'shooter'] : ['drift', 'sine', 'dive'];
    var enemies = cfg.enemies || [];
    var waves = cfg.waves || [];
    var html = '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('gamepad') + 'Enemies (' + enemies.length + ')</h3></div>';
    if (enemies.length) {
      html += table(['id', 'sprite', 'hp', 'speed', 'dmg', 'score', 'radius', 'behavior'],
        enemies.map(function (e, i) {
          var pre = 'enemies.' + i + '.';
          return '<tr>' + cell(pre + 'id', e.id, '8em') + cell(pre + 'sprite', e.sprite, '10em')
            + ncell(pre + 'health', e.health) + ncell(pre + 'speed', e.speed)
            + ncell(pre + 'damage', e.damage) + ncell(pre + 'score', e.score)
            + ncell(pre + 'radius', e.radius)
            + selCell(pre + 'behavior.type', (e.behavior || {}).type, behaviors) + '</tr>';
        }).join('')) + ROW_NOTE;
    } else {
      html += '<p class="muted">No enemies in config.</p>';
    }
    html += '</section><section class="panel glass-panel"><div class="panel-head"><h3>' + icon('levels') + 'Waves (' + waves.length + ')</h3></div>'
      + waves.map(function (wv, i) {
        return '<div class="wave"><div class="row"><strong>' + U().esc(wv.id) + '</strong>'
          + '<label class="fld inline"><span>delay after prev (ms)</span><input data-c="waves.' + i + '.delayAfterPrevMs" type="number" value="'
          + U().esc(wv.delayAfterPrevMs != null ? wv.delayAfterPrevMs : 1500) + '" style="width:7em"></label></div>'
          + '<ul class="spawns">' + (wv.spawns || []).map(function (sp, j) {
            return '<li class="row"><span>enemy <code>' + U().esc(sp.enemyId) + '</code></span>'
              + '<label class="fld inline"><span>count</span><input data-c="waves.' + i + '.spawns.' + j + '.count" type="number" value="' + sp.count + '" style="width:4.5em"></label>'
              + '<label class="fld inline"><span>interval (ms)</span><input data-c="waves.' + i + '.spawns.' + j + '.intervalMs" type="number" value="' + sp.intervalMs + '" style="width:6em"></label></li>';
          }).join('') + '</ul></div>';
      }).join('') + '</section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('sliders') + 'Progression</h3></div><div class="form-grid">'
      + num('Victory after wave', 'victory.afterWave', cfg, 'min="1"')
      + num('Health scale / wave', 'difficulty.enemyHealthScalePerWave', cfg, 'step="0.05" min="0" max="2"')
      + num('Speed scale / wave', 'difficulty.enemySpeedScalePerWave', cfg, 'step="0.05" min="0" max="2"')
      + (battle
        ? num('Min spawn dist from player', 'spawning.minDistFromPlayer', cfg, 'min="0" max="2000"')
          + num('Pickup drop chance', 'pickups.dropChance', cfg, 'step="0.01" min="0" max="1"')
          + num('Pickup heal amount', 'pickups.healAmount', cfg, 'min="1" max="20"')
          + num('Pickup bonus score', 'pickups.bonusScore', cfg, 'min="0" max="5000"')
          + num('Pickup TTL (ms)', 'pickups.ttlMs', cfg, 'min="1000" max="120000"')
        : num('Pickup drop chance', 'pickups.dropChance', cfg, 'step="0.01" min="0" max="1"')
          + num('Pickup powerup bonus', 'pickups.powerupBonus', cfg, 'min="0"'))
      + '</div></section>'
      + footer();
    body.innerHTML = html;
    wireFooter(body, p, function () { return collect(body, cfg); });
  }

  // endless-runner: pacing, spawning, obstacles.
  function showRunnerLevels(body, p, cfg) {
    var obs = cfg.obstacles || [];
    body.innerHTML =
      '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('sliders') + 'Pacing</h3></div><div class="form-grid">'
      + num('Base speed', 'world.baseSpeed', cfg, 'min="60" max="1200"')
      + num('Max speed', 'world.maxSpeed', cfg, 'min="60" max="1600"')
      + num('Speed ramp / sec', 'world.speedRampPerSec', cfg, 'step="0.5" min="0" max="100"')
      + '</div></section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('plus') + 'Spawning</h3></div><div class="form-grid">'
      + num('Grace (px)', 'spawning.gracePx', cfg, 'min="0" max="5000"')
      + num('Start gap (px)', 'spawning.startGapPx', cfg, 'min="100" max="3000"')
      + num('Min gap (px)', 'spawning.minGapPx', cfg, 'min="100" max="3000"')
      + num('Spawn ahead (px)', 'spawning.spawnAheadPx', cfg, 'min="0" max="500"')
      + '</div></section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('warn') + 'Obstacles (' + obs.length + ')</h3></div>'
      + (obs.length ? table(['id', 'sprite', 'w', 'h', 'kind', 'hover h'],
        obs.map(function (o, i) {
          var pre = 'obstacles.' + i + '.';
          return '<tr>' + cell(pre + 'id', o.id, '8em') + cell(pre + 'sprite', o.sprite, '10em')
            + ncell(pre + 'w', o.w) + ncell(pre + 'h', o.h)
            + selCell(pre + 'kind', o.kind, ['ground', 'high'])
            + optNCell(pre + 'hoverH', o.hoverH) + '</tr>';
        }).join('')) + ROW_NOTE : '<p class="muted">No obstacles in config.</p>')
      + '</section>'
      + footer();
    wireFooter(body, p, function () { return collect(body, cfg); });
  }

  // side-scroller: level geometry + actors + exit.
  function showScrollerLevels(body, p, cfg) {
    var lvl = cfg.level || {};
    function rows(list, fn) {
      return (list || []).map(fn).join('');
    }
    body.innerHTML =
      '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('levels') + 'Level size</h3></div><div class="form-grid">'
      + num('Level width', 'world.levelWidth', cfg, 'min="960" max="12000"')
      + num('Level height', 'world.levelHeight', cfg, 'min="270" max="2160"')
      + num('Kill plane Y', 'world.killPlaneY', cfg, '')
      + '</div></section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('levels') + 'Platforms (' + (lvl.platforms || []).length + ')</h3></div>'
      + table(['x', 'y', 'w', 'h', 'one-way'], rows(lvl.platforms, function (a, i) {
        var pre = 'level.platforms.' + i + '.';
        return '<tr>' + ncell(pre + 'x', a.x) + ncell(pre + 'y', a.y)
          + ncell(pre + 'w', a.w) + ncell(pre + 'h', a.h)
          + checkCell(pre + 'oneWay', a.oneWay) + '</tr>';
      })) + ROW_NOTE + '</section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('warn') + 'Hazards (' + (lvl.hazards || []).length + ')</h3></div>'
      + ((lvl.hazards || []).length ? table(['id', 'sprite', 'x', 'y', 'w', 'h', 'dmg'],
        rows(lvl.hazards, function (a, i) {
          var pre = 'level.hazards.' + i + '.';
          return '<tr>' + cell(pre + 'id', a.id, '8em') + cell(pre + 'sprite', a.sprite, '10em')
            + ncell(pre + 'x', a.x) + ncell(pre + 'y', a.y)
            + ncell(pre + 'w', a.w) + ncell(pre + 'h', a.h)
            + ncell(pre + 'damage', a.damage == null ? 1 : a.damage) + '</tr>';
        })) + ROW_NOTE : '<p class="muted">No hazards in config.</p>') + '</section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('gamepad') + 'Enemies (' + (lvl.enemies || []).length + ')</h3></div>'
      + ((lvl.enemies || []).length ? table(['id', 'sprite', 'x', 'y', 'w', 'h', 'speed', 'patrol min', 'patrol max', 'dmg'],
        rows(lvl.enemies, function (a, i) {
          var pre = 'level.enemies.' + i + '.';
          return '<tr>' + cell(pre + 'id', a.id, '8em') + cell(pre + 'sprite', a.sprite, '10em')
            + ncell(pre + 'x', a.x) + ncell(pre + 'y', a.y)
            + ncell(pre + 'w', a.w) + ncell(pre + 'h', a.h)
            + ncell(pre + 'speed', a.speed)
            + ncell(pre + 'patrolMinX', a.patrolMinX, '5.5em')
            + ncell(pre + 'patrolMaxX', a.patrolMaxX, '5.5em')
            + ncell(pre + 'damage', a.damage == null ? 1 : a.damage) + '</tr>';
        })) + ROW_NOTE : '<p class="muted">No enemies in config.</p>') + '</section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('dot') + 'Collectibles (' + (lvl.collectibles || []).length + ')</h3></div>'
      + ((lvl.collectibles || []).length ? table(['id', 'x', 'y', 'radius', 'score'],
        rows(lvl.collectibles, function (a, i) {
          var pre = 'level.collectibles.' + i + '.';
          return '<tr>' + cell(pre + 'id', a.id, '8em')
            + ncell(pre + 'x', a.x) + ncell(pre + 'y', a.y)
            + ncell(pre + 'r', a.r == null ? 10 : a.r)
            + ncell(pre + 'score', a.score) + '</tr>';
        })) + ROW_NOTE : '<p class="muted">No collectibles in config.</p>') + '</section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('check') + 'Checkpoints (' + (lvl.checkpoints || []).length + ')</h3></div>'
      + ((lvl.checkpoints || []).length ? table(['id', 'x', 'y', 'w', 'h'],
        rows(lvl.checkpoints, function (a, i) {
          var pre = 'level.checkpoints.' + i + '.';
          return '<tr>' + cell(pre + 'id', a.id, '8em')
            + ncell(pre + 'x', a.x) + ncell(pre + 'y', a.y)
            + ncell(pre + 'w', a.w) + ncell(pre + 'h', a.h) + '</tr>';
        })) + ROW_NOTE : '<p class="muted">No checkpoints in config.</p>') + '</section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('play') + 'Exit</h3></div><div class="form-grid">'
      + num('X', 'level.exit.x', cfg, '')
      + num('Y', 'level.exit.y', cfg, '')
      + num('Width', 'level.exit.w', cfg, 'min="8" max="512"')
      + num('Height', 'level.exit.h', cfg, 'min="8" max="1024"')
      + optTxt('Sprite', 'level.exit.sprite', cfg)
      + '</div></section>'
      + footer();
    wireFooter(body, p, function () { return collect(body, cfg); });
  }

  // farming: field layout + crops.
  function showFarmLevels(body, p, cfg) {
    var crops = cfg.crops || [];
    body.innerHTML =
      '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('levels') + 'Field</h3></div><div class="form-grid">'
      + num('Columns', 'farm.cols', cfg, 'min="1" max="12"')
      + num('Rows', 'farm.rows', cfg, 'min="1" max="12"')
      + num('Plot size', 'farm.plotSize', cfg, 'min="24" max="256"')
      + num('Origin X', 'farm.originX', cfg, '')
      + num('Origin Y', 'farm.originY', cfg, '')
      + num('Day length (sec)', 'farm.dayLengthSec', cfg, 'min="5" max="600"')
      + '</div></section>'
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('dot') + 'Crops (' + crops.length + ')</h3></div>'
      + (crops.length ? table(['id', 'name', 'sprite', 'seed cost', 'sell price', 'stages', 'stage time (s)'],
        crops.map(function (c, i) {
          var pre = 'crops.' + i + '.';
          return '<tr>' + cell(pre + 'id', c.id, '8em') + cell(pre + 'name', c.name, '8em')
            + cell(pre + 'sprite', c.sprite, '10em')
            + ncell(pre + 'seedCost', c.seedCost, '5.5em')
            + ncell(pre + 'sellPrice', c.sellPrice, '5.5em')
            + ncell(pre + 'stages', c.stages)
            + ncell(pre + 'stageTimeSec', c.stageTimeSec, '5.5em') + '</tr>';
        }).join('')) + ROW_NOTE : '<p class="muted">No crops in config.</p>')
      + '</section>'
      + footer();
    wireFooter(body, p, function () { return collect(body, cfg); });
  }

  // ---------- Game Settings: spec-driven scalar editor ----------
  function renderGameSettings(root) {
    var p = V().needProject(root);
    if (!p) return;
    shell(root, 'Game Settings', 'Project: <strong>' + U().esc(p.name) + '</strong> · movement, combat, economy, controls.');
    loadConfig(root.querySelector('[data-slot="body"]'), p, function (cfg) {
      showGameSettings(root.querySelector('[data-slot="body"]'), p, cfg);
    });
  }

  function showGameSettings(body, p, cfg) {
    var spec = U().gameSettingsSpec(p.genre);
    var html = spec.sections.map(function (sec) {
      var fields = sec.fields.map(function (f) {
        return num(f.label, f.path, cfg, f.attrs);
      }).join('');
      if (sec.title === 'Scoring & difficulty') {
        fields += '<label class="fld"><span>Difficulty preset</span><select data-c="difficulty.preset">'
          + ['easy', 'normal', 'hard'].map(function (s) {
            return '<option' + (cfg.difficulty.preset === s ? ' selected' : '') + '>' + s + '</option>';
          }).join('') + '</select></label>';
      }
      return '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('sliders') + U().esc(sec.title) + '</h3></div>'
        + '<div class="form-grid">' + fields + '</div></section>';
    }).join('')
      + '<section class="panel glass-panel"><div class="panel-head"><h3>' + icon('gamepad') + 'Controls</h3></div><div class="form-grid">'
      + spec.controls.map(function (k) { return txt(k, 'controls.' + k, cfg); }).join('')
      + '</div><p class="muted small">Keyboard remapping UI is P2 (FR-028) — values are stored verbatim.</p></section>'
      + footer();
    body.innerHTML = html;
    wireFooter(body, p, function () { return collect(body, cfg); });
  }

  V().register('levels', { title: 'Level Studio', render: renderLevels });
  V().register('settings-game', { title: 'Game Settings', render: renderGameSettings });
})();
