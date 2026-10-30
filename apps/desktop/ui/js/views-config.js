// KGSM views: Level Studio + Game Settings (shared config.json editor).
(function () {
  'use strict';

  function V() { return globalThis.KgsmViews; }
  function U() { return globalThis.KgsmUtil; }
  function UI() { return globalThis.KgsmUi; }
  function S() { return globalThis.KgsmStore; }
  function api() { return globalThis.KgsmApp.api; }

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
  function num(label, path, cfg, attrs) {
    return '<label class="fld"><span>' + U().esc(label) + '</span><input data-c="' + path
      + '" type="number" value="' + U().esc(getPath(cfg, path)) + '" ' + (attrs || '') + '></label>';
  }
  function txt(label, path, cfg) {
    return '<label class="fld"><span>' + U().esc(label) + '</span><input data-c="' + path
      + '" value="' + U().esc(getPath(cfg, path)) + '"></label>';
  }

  function shell(root, title, sub) {
    root.innerHTML =
      '<div class="view-head"><div><h2>' + title + '</h2><p class="muted">' + sub + '</p></div>'
      + '<div class="row"><button type="button" class="btn ghost" data-a="reload">Reload</button></div></div>'
      + '<div data-slot="body">' + UI().loadingPanel('Loading config…') + '</div>';
    root.querySelector('[data-a="reload"]').addEventListener('click', function () {
      (title === 'Level Studio' ? renderLevels : renderGameSettings)(root);
    });
  }

  function loadConfig(body, p, onOk) {
    if (!S().get('online')) { body.innerHTML = UI().offlinePanel(); return; }
    if (p.genre !== 'space-shooter') {
      body.innerHTML = UI().emptyPanel('Config editor is space-shooter only in wave 1',
        'Genre "' + p.genre + '" has no config schema yet (contract §3 returns 501 unknown-genre). '
        + 'Per-genre editors are an M2 item. Your blueprint is still reviewable under Game Blueprint.');
      return;
    }
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
      var v = inp.type === 'number' ? Number(inp.value) : inp.value;
      setPath(cfg, inp.dataset.c, v);
    });
    return cfg;
  }

  function footer(p, body, getCfg) {
    return '<section class="panel"><div class="btn-row">'
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

  // ---------- Level Studio: enemies + waves + progression ----------
  function renderLevels(root) {
    var p = V().needProject(root);
    if (!p) return;
    shell(root, 'Level Studio', 'Project: <strong>' + U().esc(p.name) + '</strong> · waves, enemies, progression.');
    loadConfig(root.querySelector('[data-slot="body"]'), p, function (cfg) {
      showLevels(root.querySelector('[data-slot="body"]'), p, cfg);
    });
  }

  function showLevels(body, p, cfg) {
    var enemies = cfg.enemies || [];
    var waves = cfg.waves || [];
    body.innerHTML =
      '<section class="panel"><h3>Enemies (' + enemies.length + ')</h3>'
      + (enemies.length ? '<div class="table-wrap"><table class="tbl"><thead><tr>'
        + '<th>id</th><th>sprite</th><th>hp</th><th>speed</th><th>dmg</th><th>score</th><th>radius</th><th>behavior</th>'
        + '</tr></thead><tbody>' + enemies.map(function (e, i) {
          function cell(path, v, w) {
            return '<td><input data-c="enemies.' + i + '.' + path + '" type="text" value="' + U().esc(v) + '" style="width:' + (w || '5em') + '"></td>';
          }
          function ncell(path, v) {
            return '<td><input data-c="enemies.' + i + '.' + path + '" type="number" value="' + U().esc(v) + '" style="width:4.5em"></td>';
          }
          return '<tr>' + cell('id', e.id, '8em') + cell('sprite', e.sprite, '10em')
            + ncell('health', e.health) + ncell('speed', e.speed) + ncell('damage', e.damage)
            + ncell('score', e.score) + ncell('radius', e.radius)
            + cell('behavior.type', (e.behavior || {}).type, '5em') + '</tr>';
        }).join('') + '</tbody></table></div>'
        + '<p class="muted small">Row add/remove is an M2 item — edit values here, or hand-edit config.json via Export Center preview.</p>'
        : '<p class="muted">No enemies in config.</p>') + '</section>'
      + '<section class="panel"><h3>Waves (' + waves.length + ')</h3>'
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
      + '<section class="panel"><h3>Progression</h3><div class="form-grid">'
      + num('Victory after wave', 'victory.afterWave', cfg, 'min="1"')
      + num('Health scale / wave', 'difficulty.enemyHealthScalePerWave', cfg, 'step="0.05" min="0" max="2"')
      + num('Speed scale / wave', 'difficulty.enemySpeedScalePerWave', cfg, 'step="0.05" min="0" max="2"')
      + num('Pickup drop chance', 'pickups.dropChance', cfg.pickups ? 'step="0.01" min="0" max="1"' : '')
      + num('Pickup powerup bonus', 'pickups.powerupBonus', cfg, 'min="0"')
      + '</div></section>'
      + footer();
    // Coerce numeric cells that were rendered as text for ids: fix enemy numeric types on collect.
    wireFooter(body, p, function () {
      var c = collect(body, cfg);
      (c.enemies || []).forEach(function (e) {
        ['health', 'damage', 'score'].forEach(function (k) { e[k] = Number(e[k]); });
        ['speed', 'radius'].forEach(function (k) { e[k] = Number(e[k]); });
      });
      (c.waves || []).forEach(function (wv) {
        wv.delayAfterPrevMs = Number(wv.delayAfterPrevMs);
        (wv.spawns || []).forEach(function (sp) {
          sp.count = Number(sp.count); sp.intervalMs = Number(sp.intervalMs);
        });
      });
      return c;
    });
  }

  // ---------- Game Settings: world/player/weapon/scoring/controls ----------
  function renderGameSettings(root) {
    var p = V().needProject(root);
    if (!p) return;
    shell(root, 'Game Settings', 'Project: <strong>' + U().esc(p.name) + '</strong> · movement, combat, economy, controls.');
    loadConfig(root.querySelector('[data-slot="body"]'), p, function (cfg) {
      showGameSettings(root.querySelector('[data-slot="body"]'), p, cfg);
    });
  }

  function showGameSettings(body, p, cfg) {
    body.innerHTML =
      '<section class="panel"><h3>World</h3><div class="form-grid">'
      + num('Width', 'world.width', cfg, 'min="480" max="1920"')
      + num('Height', 'world.height', cfg, 'min="270" max="1080"')
      + '</div></section>'
      + '<section class="panel"><h3>Player</h3><div class="form-grid">'
      + num('Speed', 'player.speed', cfg, 'min="60" max="1200"')
      + num('Health', 'player.health', cfg, 'min="1" max="20"')
      + num('Lives', 'player.lives', cfg, 'min="1" max="9"')
      + num('Invulnerable (ms)', 'player.invulnerableMs', cfg, 'min="0" max="5000"')
      + num('Radius', 'player.radius', cfg, 'min="4" max="64"')
      + '</div></section>'
      + '<section class="panel"><h3>Weapon</h3><div class="form-grid">'
      + num('Cooldown (ms)', 'weapon.cooldownMs', cfg, 'min="40" max="2000"')
      + num('Projectile speed', 'weapon.projectileSpeed', cfg, 'min="100" max="2000"')
      + num('Damage', 'weapon.damage', cfg, 'min="1" max="99"')
      + num('Pool size', 'weapon.poolSize', cfg, 'min="8" max="256"')
      + num('Powerup levels', 'weapon.powerupLevels', cfg, 'min="1" max="5"')
      + '</div></section>'
      + '<section class="panel"><h3>Scoring & difficulty</h3><div class="form-grid">'
      + num('Kill multiplier', 'scoring.killMultiplier', cfg, 'step="0.1" min="0" max="100"')
      + num('Wave-clear bonus', 'scoring.waveClearBonus', cfg, 'min="0"')
      + '<label class="fld"><span>Difficulty preset</span><select data-c="difficulty.preset">'
      + ['easy', 'normal', 'hard'].map(function (s) {
        return '<option' + (cfg.difficulty.preset === s ? ' selected' : '') + '>' + s + '</option>';
      }).join('') + '</select></label>'
      + '</div></section>'
      + '<section class="panel"><h3>Controls</h3><div class="form-grid">'
      + ['up', 'down', 'left', 'right', 'fire', 'pause'].map(function (k) {
        return txt(k, 'controls.' + k, cfg);
      }).join('') + '</div>'
      + '<p class="muted small">Keyboard remapping UI is P2 (FR-028) — values are stored verbatim.</p></section>'
      + footer();
    wireFooter(body, p, function () {
      var c = collect(body, cfg);
      // select element for preset is collected as string already; numerics are numbers.
      return c;
    });
  }

  V().register('levels', { title: 'Level Studio', render: renderLevels });
  V().register('settings-game', { title: 'Game Settings', render: renderGameSettings });
})();
