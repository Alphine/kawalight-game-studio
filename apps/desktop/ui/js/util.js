// KGSM UI pure helpers. Browser plain-script + Node require compatible
// (no DOM, no fetch) so node --test can cover this file directly.
(function () {
  'use strict';

  var STATES = [
    'draft', 'blueprint_ready', 'assets_pending', 'assembling',
    'playable', 'validating', 'export_ready', 'exported',
  ];

  var GENRES = [
    'space-shooter', 'endless-runner', 'side-scroller', 'battle-2d', 'farming',
    'puzzle-match',
  ];

  // Schema-required control keys per genre (mirrors packages/schemas/*.schema.json).
  var CONTROLS_BY_GENRE = {
    'space-shooter': ['up', 'down', 'left', 'right', 'fire', 'pause'],
    'battle-2d': ['up', 'down', 'left', 'right', 'fire', 'melee', 'pause'],
    'endless-runner': ['jump', 'slide', 'pause'],
    'side-scroller': ['left', 'right', 'jump', 'pause'],
    farming: ['toolPlant', 'toolWater', 'toolHarvest', 'nextDay', 'pause'],
    'puzzle-match': ['hint', 'reshuffle', 'pause'],
  };

  function controlsKeysFor(genre) {
    var keys = CONTROLS_BY_GENRE[genre];
    if (!keys) throw new Error('unknown genre: ' + genre);
    return keys.slice();
  }

  // Game Settings form spec per genre: scalar sections only (Level Studio owns
  // the level-content tables). Each field is {label, path, attrs}.
  // Paths must stay disjoint from the Level Studio panels in views-config.js.
  function gameSettingsSpec(genre) {
    function F(label, path, attrs) {
      return { label: label, path: path, attrs: attrs || '' };
    }
    var worldWH = [
      F('Width', 'world.width', 'min="480" max="1920"'),
      F('Height', 'world.height', 'min="270" max="1080"'),
    ];
    var shooterPlayer = [
      F('Speed', 'player.speed', 'min="60" max="1200"'),
      F('Health', 'player.health', 'min="1" max="20"'),
      F('Lives', 'player.lives', 'min="1" max="9"'),
      F('Invulnerable (ms)', 'player.invulnerableMs', 'min="0" max="5000"'),
      F('Radius', 'player.radius', 'min="4" max="64"'),
    ];
    var waveScoring = [
      F('Kill multiplier', 'scoring.killMultiplier', 'step="0.1" min="0" max="100"'),
      F('Wave-clear bonus', 'scoring.waveClearBonus', 'min="0"'),
    ];
    var specs = {
      'space-shooter': [
        { title: 'World', fields: worldWH },
        { title: 'Player', fields: shooterPlayer },
        { title: 'Weapon', fields: [
          F('Cooldown (ms)', 'weapon.cooldownMs', 'min="40" max="2000"'),
          F('Projectile speed', 'weapon.projectileSpeed', 'min="100" max="2000"'),
          F('Damage', 'weapon.damage', 'min="1" max="99"'),
          F('Pool size', 'weapon.poolSize', 'min="8" max="256"'),
          F('Powerup levels', 'weapon.powerupLevels', 'min="1" max="5"'),
        ] },
        { title: 'Scoring & difficulty', fields: waveScoring },
      ],
      'battle-2d': [
        { title: 'World', fields: worldWH },
        { title: 'Player', fields: shooterPlayer },
        { title: 'Melee', fields: [
          F('Cooldown (ms)', 'melee.cooldownMs', 'min="40" max="2000"'),
          F('Damage', 'melee.damage', 'min="1" max="99"'),
          F('Range', 'melee.range', 'min="16" max="400"'),
        ] },
        { title: 'Ranged', fields: [
          F('Cooldown (ms)', 'ranged.cooldownMs', 'min="40" max="2000"'),
          F('Projectile speed', 'ranged.projectileSpeed', 'min="100" max="2000"'),
          F('Damage', 'ranged.damage', 'min="1" max="99"'),
          F('Pool size', 'ranged.poolSize', 'min="8" max="256"'),
          F('Aim range', 'ranged.aimRange', 'min="40" max="3000"'),
        ] },
        { title: 'Foe shots', fields: [
          F('Pool size', 'foeShots.poolSize', 'min="8" max="256"'),
        ] },
        { title: 'Scoring & difficulty', fields: waveScoring },
      ],
      'endless-runner': [
        { title: 'World', fields: worldWH.concat([
          F('Ground Y', 'world.groundY', ''),
          F('Gravity', 'world.gravity', 'min="500" max="8000"'),
          F('Pixels / meter', 'world.pxPerMeter', 'min="10" max="200"'),
        ]) },
        { title: 'Player', fields: [
          F('X', 'player.x', ''),
          F('Width', 'player.width', 'min="8" max="128"'),
          F('Height', 'player.height', 'min="8" max="160"'),
          F('Slide height', 'player.slideHeight', 'min="4" max="160"'),
          F('Jump velocity', 'player.jumpVelocity', 'min="200" max="2500"'),
        ] },
        { title: 'Scoring & difficulty', fields: [
          F('Coin score', 'scoring.coinScore', 'min="0" max="10000"'),
          F('Milestone every (m)', 'scoring.milestoneEveryM', 'min="0" max="100000"'),
        ] },
      ],
      'side-scroller': [
        { title: 'World', fields: worldWH.concat([
          F('Gravity', 'world.gravity', 'min="500" max="8000"'),
          F('Max fall speed', 'world.maxFallSpeed', 'min="200" max="3000"'),
        ]) },
        { title: 'Player', fields: [
          F('Spawn X', 'player.spawn.x', ''),
          F('Spawn Y', 'player.spawn.y', ''),
          F('Width', 'player.width', 'min="8" max="128"'),
          F('Height', 'player.height', 'min="8" max="160"'),
          F('Move speed', 'player.moveSpeed', 'min="60" max="900"'),
          F('Acceleration', 'player.acceleration', 'min="200" max="12000"'),
          F('Air control', 'player.airControl', 'step="0.05" min="0" max="1"'),
          F('Jump velocity', 'player.jumpVelocity', 'min="200" max="2500"'),
          F('Coyote (ms)', 'player.coyoteMs', 'min="0" max="500"'),
          F('Jump buffer (ms)', 'player.jumpBufferMs', 'min="0" max="500"'),
          F('Max jumps', 'player.maxJumps', 'min="1" max="3"'),
          F('Health', 'player.health', 'min="1" max="10"'),
          F('Invulnerable (ms)', 'player.invulnMs', 'min="0" max="5000"'),
          F('Knockback', 'player.knockback', 'min="0" max="1200"'),
          F('Stomp bounce', 'player.stompBounce', 'min="100" max="2000"'),
        ] },
        { title: 'Scoring & difficulty', fields: [
          F('Coin score', 'scoring.coinScore', 'min="0" max="10000"'),
          F('Stomp score', 'scoring.stompScore', 'min="0" max="10000"'),
          F('Time bonus / sec', 'scoring.timeBonusPerSec', 'min="0" max="10000"'),
          F('Par time (sec)', 'scoring.parTimeSec', 'min="0" max="3600"'),
        ] },
        { title: 'Camera', fields: [
          F('Follow lerp', 'camera.followLerp', 'step="0.01" min="0.01" max="1"'),
          F('Deadzone X', 'camera.deadzoneX', 'min="0" max="1920"'),
          F('Deadzone Y', 'camera.deadzoneY', 'min="0" max="1080"'),
        ] },
      ],
      farming: [
        { title: 'World', fields: worldWH },
        { title: 'Scoring & difficulty', fields: [
          F('Start coins', 'scoring.startCoins', 'min="0" max="1000000"'),
          F('Target coins', 'scoring.targetCoins', 'min="1" max="100000000"'),
        ] },
      ],
      'puzzle-match': [
        { title: 'World', fields: worldWH },
        { title: 'Scoring & moves', fields: [
          F('Target score', 'scoring.targetScore', 'min="1" max="10000000"'),
          F('Points per gem', 'scoring.pointsPerGem', 'min="1" max="1000"'),
          F('Cascade bonus %', 'scoring.cascadeBonusPercent', 'min="0" max="200"'),
          F('Move limit', 'moves.limit', 'min="1" max="999"'),
        ] },
      ],
    };
    if (!specs[genre]) throw new Error('unknown genre: ' + genre);
    return { sections: specs[genre], controls: controlsKeysFor(genre) };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function joinUrl(base, path) {
    var b = String(base || '').replace(/\/+$/, '');
    var p = String(path || '');
    if (p.charAt(0) !== '/') p = '/' + p;
    return b + p;
  }

  function fmtBytes(n) {
    if (n == null || isNaN(n)) return '—';
    var v = Number(n);
    if (v < 1024) return v + ' B';
    var units = ['KB', 'MB', 'GB'];
    var u = -1;
    do { v /= 1024; u += 1; } while (v >= 1024 && u < units.length - 1);
    return v.toFixed(v >= 100 ? 0 : 1) + ' ' + units[u];
  }

  function fmtCents(cents) {
    if (cents == null) return 'unknown';
    return '$' + (Number(cents) / 100).toFixed(2);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleString();
    } catch (e) { return String(iso); }
  }

  function stateLabel(state) {
    return String(state || '').replace(/_/g, ' ');
  }

  // Contract §1: forward exactly one step; backward any distance with reason.
  function allowedTransitions(from) {
    var i = STATES.indexOf(from);
    if (i < 0) return { forward: null, backward: [] };
    return {
      forward: i + 1 < STATES.length ? STATES[i + 1] : null,
      backward: STATES.slice(0, i),
    };
  }

  function isValidProjectName(name) {
    return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 80;
  }

  function defaultWizard() {
    return {
      name: '', genre: 'space-shooter', theme: '',
      visualStyle: 'pixel-art', targetRuntime: 'phaser3-html5',
      width: 960, height: 540, scheme: 'keyboard', remappable: false,
      difficulty: 'normal', ramp: 'gradual',
      gameLoop: 'Pilot a ship, dodge waves of enemies, defeat the boss to clear the stage.',
      abilities: ['Move', 'Shoot'],
      health: 3, lives: 3,
      enemies: [{ id: 'drone', role: 'Basic drifter crossing the screen', count: 8 }],
      progression: 'Three waves of increasing density, then a boss encounter.',
      scoring: 'Points per kill multiplied by wave number; wave-clear bonus.',
      winCondition: 'Defeat the boss.',
      loseCondition: 'Lose all lives.',
      seed: '', notes: '',
    };
  }

  // Foe-list key per genre (mirrors blueprint.schema.json allOf):
  // space-shooter + battle-2d require `enemies`, the other genres `obstacles`.
  function foeKeyFor(genre) {
    return (genre === 'endless-runner' || genre === 'side-scroller' || genre === 'farming'
      || genre === 'puzzle-match')
      ? 'obstacles' : 'enemies';
  }

  // Human-readable foe word per genre for wizard labels and validation text.
  function foeWordFor(genre) {
    return foeKeyFor(genre) === 'obstacles' ? 'Obstacle' : 'Enemy';
  }

  function buildWizardBlueprint(w) {
    var abilities = (w.abilities || []).map(function (a) { return String(a).trim(); })
      .filter(function (a) { return a.length > 0; });
    var foes = (w.enemies || []).map(function (e) {
      return { id: e.id, role: e.role, count: Number(e.count) || 1 };
    });
    var bp = {
      schemaVersion: '1.0.0',
      projectName: String(w.name || '').trim(),
      genre: w.genre,
      theme: String(w.theme || '').trim(),
      visualStyle: w.visualStyle,
      targetRuntime: w.targetRuntime,
      resolution: { width: Number(w.width), height: Number(w.height) },
      controls: { scheme: w.scheme, remappable: !!w.remappable },
      difficulty: { preset: w.difficulty, ramp: w.ramp },
      gameLoop: String(w.gameLoop || '').trim(),
      player: {
        abilities: abilities,
        health: Number(w.health), lives: Number(w.lives),
      },
      progression: String(w.progression || '').trim(),
      scoring: String(w.scoring || '').trim(),
      winCondition: String(w.winCondition || '').trim(),
      loseCondition: String(w.loseCondition || '').trim(),
      seed: (w.seed === '' || w.seed == null) ? null : Number(w.seed),
      notes: String(w.notes || ''),
    };
    bp[foeKeyFor(w.genre)] = foes;
    return bp;
  }

  var ENEMY_ID_RE = /^[a-z0-9-]{1,40}$/;

  function validateWizardLocal(w) {
    var errs = [];
    if (!isValidProjectName(w.name)) errs.push('Project name must be 1..80 characters.');
    if (GENRES.indexOf(w.genre) < 0) errs.push('Unknown genre.');
    if (!w.theme || !w.theme.trim()) errs.push('Theme is required.');
    else if (w.theme.trim().length > 120) errs.push('Theme must be ≤ 120 characters.');
    if (!(w.width >= 480 && w.width <= 1920)) errs.push('Width must be 480..1920.');
    if (!(w.height >= 270 && w.height <= 1080)) errs.push('Height must be 270..1080.');
    if (!w.gameLoop || !w.gameLoop.trim()) errs.push('Game loop is required.');
    var abilities = (w.abilities || []).filter(function (a) { return String(a).trim(); });
    if (abilities.length < 1) errs.push('At least one player ability is required.');
    if (!(w.health >= 1 && w.health <= 99)) errs.push('Player health must be 1..99.');
    if (!(w.lives >= 1 && w.lives <= 9)) errs.push('Player lives must be 1..9.');
    var foeWord = foeWordFor(w.genre);
    var foeLower = foeWord.toLowerCase();
    if (!w.enemies || w.enemies.length < 1) errs.push('At least one ' + foeLower + ' is required.');
    (w.enemies || []).forEach(function (e, i) {
      if (!ENEMY_ID_RE.test(e.id || '')) errs.push(foeWord + ' #' + (i + 1) + ': id must match [a-z0-9-]{1,40}.');
      if (!e.role || !String(e.role).trim()) errs.push(foeWord + ' #' + (i + 1) + ': role is required.');
      if (!(e.count >= 1 && e.count <= 512)) errs.push(foeWord + ' #' + (i + 1) + ': count must be 1..512.');
    });
    if (!w.progression || !w.progression.trim()) errs.push('Progression is required.');
    if (!w.scoring || !w.scoring.trim()) errs.push('Scoring is required.');
    if (!w.winCondition || !w.winCondition.trim()) errs.push('Win condition is required.');
    if (!w.loseCondition || !w.loseCondition.trim()) errs.push('Lose condition is required.');
    if (w.seed !== '' && w.seed != null && !(Number(w.seed) >= 0)) errs.push('Seed must be ≥ 0 or empty.');
    return errs;
  }

  // Theme presets (apps/desktop/ui/data/themes.json): normalize the foe list.
  // space-shooter/battle-2d themes use `enemies`, the other genres use
  // `obstacles`; both are [{id, role}].
  function themeFoes(theme) {
    var list = (theme && theme.enemies) || (theme && theme.obstacles) || [];
    return list.map(function (f) {
      return { id: String((f && f.id) || ''), role: String((f && f.role) || '') };
    });
  }

  // Apply a theme preset onto New-Game wizard data. Pure: returns a new
  // object, the input is untouched. Only blueprint-shaped fields are copied;
  // name, resolution, seed, and notes are preserved for manual editing.
  function applyThemeToWizard(w, theme) {
    var next = {};
    Object.keys(w || {}).forEach(function (k) { next[k] = w[k]; });
    if (!theme) return next;
    if (theme.theme != null) next.theme = theme.theme;
    if (theme.visualStyle != null) next.visualStyle = theme.visualStyle;
    if (theme.gameLoop != null) next.gameLoop = theme.gameLoop;
    var p = theme.player || {};
    if (p.abilities) next.abilities = p.abilities.slice();
    if (p.health != null) next.health = p.health;
    if (p.lives != null) next.lives = p.lives;
    var foes = themeFoes(theme);
    if (foes.length) {
      next.enemies = foes.map(function (f) {
        return { id: f.id, role: f.role, count: 4 };
      });
    }
    if (theme.progression != null) next.progression = theme.progression;
    if (theme.scoring != null) next.scoring = theme.scoring;
    if (theme.winCondition != null) next.winCondition = theme.winCondition;
    if (theme.loseCondition != null) next.loseCondition = theme.loseCondition;
    if (theme.controls && theme.controls.scheme != null) next.scheme = theme.controls.scheme;
    if (theme.difficulty) {
      if (theme.difficulty.preset != null) next.difficulty = theme.difficulty.preset;
      if (theme.difficulty.ramp != null) next.ramp = theme.difficulty.ramp;
    }
    return next;
  }

  // Append generated story text to a blueprint's notes field. Pure: returns
  // a new blueprint, the input is untouched. Blank stories are a no-op.
  // Blueprint notes has maxLength 4000, so over-long results are truncated
  // with a visible marker instead of failing PUT with 422 after generation.
  var MAX_NOTES_LEN = 4000;
  var NOTES_TRUNC_MARKER = '\n\n[…truncated to fit the 4000-character blueprint notes limit]';
  function appendStoryToNotes(bp, storyText) {
    var next = {};
    Object.keys(bp || {}).forEach(function (k) { next[k] = bp[k]; });
    var story = String(storyText || '').trim();
    if (!story) return next;
    var prev = String(next.notes || '').trim();
    var combined = prev ? prev + '\n\n--- Story ---\n' + story : story;
    next.notes = combined.length > MAX_NOTES_LEN
      ? combined.slice(0, MAX_NOTES_LEN - NOTES_TRUNC_MARKER.length) + NOTES_TRUNC_MARKER
      : combined;
    return next;
  }

  // Normalize a worker error payload into {code, message, quote?, report?}.
  function parseApiError(payload, status, fallback) {
    var err = payload && payload.error ? payload.error : null;
    var out = {
      code: (err && err.code) || ('http-' + status),
      message: (err && err.message) || fallback || ('Request failed (HTTP ' + status + ')'),
      status: status,
    };
    if (payload && payload.quote) out.quote = payload.quote;
    if (payload && payload.report) out.report = payload.report;
    return out;
  }

  function summarizeReport(report) {
    if (!report) return { ok: false, errors: [], warnings: [] };
    return {
      ok: !!report.ok,
      errors: report.errors || [],
      warnings: report.warnings || [],
    };
  }

  function fmtDuration(sec) {
    if (sec == null || isNaN(Number(sec))) return '—';
    var s = Math.max(0, Math.floor(Number(sec)));
    var m = Math.floor(s / 60);
    var rest = s % 60;
    return m + ':' + (rest < 10 ? '0' : '') + rest;
  }

  function genreOfConfig(config) {
    var id = config && config.template && config.template.id;
    var parts = String(id || '').split('.');
    return parts.length === 2 ? parts[1] : 'unknown';
  }

  // Standalone schematic-preview page for Playtest auto-stage. Pure string
  // builder (no DOM): the caller loads the result via a Blob URL in the
  // preview iframe. The page draws the project's own config values on a
  // canvas, posts {source:'kgsm-game'} console messages, and obeys the
  // {source:'kgsm-shell', command} run/pause/restart protocol.
  function buildPreviewPage(config, projectName) {
    var genre = genreOfConfig(config);
    var safeJson = JSON.stringify(config || {}).replace(/</g, '\\u003c');
    var safeName = esc(projectName || 'Untitled project');
    var css = 'body{margin:0;background:#070b18;color:#e8ecf8;'
      + 'font-family:"Segoe UI",system-ui,sans-serif;font-size:13px}'
      + '#wrap{max-width:100%;margin:0 auto;padding:10px;text-align:center}'
      + '#hud{margin:0 0 8px;color:#8b94b3;font-size:12px}'
      + '#hud strong{color:#e8ecf8}'
      + 'canvas{background:#0a0e1a;border:1px solid #232c4d;border-radius:8px;max-width:100%}';
    var script = joinPreviewScript();
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<title>' + safeName + ' — schematic preview</title>'
      + '<style>' + css + '</style></head><body><div id="wrap">'
      + '<p id="hud">loading…</p><canvas id="cv"></canvas></div>'
      + '<script>var KGSM_CONFIG=' + safeJson + ';'
      + 'var KGSM_NAME='
      + JSON.stringify(String(projectName || '')).replace(/</g, '\\u003c') + ';'
      + 'var KGSM_GENRE=' + JSON.stringify(genre) + ';'
      + script + '</' + 'script></body></html>';
  }

  // The preview page's inline script, kept ES5 so it runs anywhere the shell
  // runs. Assembled from short concatenated parts (no nested literals).
  function joinPreviewScript() {
    var p = [];
    p.push('var cv=document.getElementById("cv"),ctx=cv.getContext("2d"),hud='
      + 'document.getElementById("hud");');
    p.push('var W=(KGSM_CONFIG.world&&KGSM_CONFIG.world.width)||960,'
      + 'H=(KGSM_CONFIG.world&&KGSM_CONFIG.world.height)||540;');
    p.push('cv.width=W;cv.height=H;');
    p.push('var tick=0,running=true,score=0,wave=0;');
    p.push('function post(l,t){try{parent.postMessage('
      + '{source:"kgsm-game",level:l,text:t},"*");}catch(e){}}');
    p.push('function fit(){var s=Math.min(1,(cv.parentNode.clientWidth-20)/W);'
      + 'cv.style.width=Math.floor(W*s)+"px";'
      + 'cv.style.height=Math.floor(H*s)+"px";}');
    p.push('window.addEventListener("resize",fit);');
    p.push('function R(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(x,y,w,h);}');
    p.push('function C(x,y,r,c){ctx.fillStyle=c;ctx.beginPath();'
      + 'ctx.arc(x,y,r,0,6.2832);ctx.fill();}');
    p.push('function T(s,x,y,c,n){ctx.fillStyle=c||"#e8ecf8";'
      + 'ctx.font=(n||12)+"px monospace";ctx.fillText(s,x,y);}');
    p.push('function stars(){var i,x,y;for(i=0;i<70;i++){x=(i*97)%W;y=(i*61)%H;'
      + 'R(x,y,2,2,i%3?"#232c4d":"#3a4670");}}');
    // Wave shooters: space-shooter + battle-2d share enemies/waves/victory.
    p.push('function drawWaves(){var i,e,n;stars();'
      + 'var P=KGSM_CONFIG.player||{};'
      + 'var px=P.x==null?W/2:P.x,py=P.y==null?H-60:P.y;'
      + 'var list=KGSM_CONFIG.enemies||[];'
      + 'var waves=KGSM_CONFIG.waves||[];'
      + 'var cur=waves.length?waves[wave%waves.length]:null;'
      + 'for(i=0;i<list.length;i++){e=list[i];'
      + 'var ex=60+((i*173+tick*(1+i%3))%(W-120));'
      + 'var ey=54+((i*89)%Math.max(60,H-220));'
      + 'C(ex,ey,Math.min(22,Math.max(6,(e.radius||10))),i%2?"#ec4899":"#3b82f6");'
      + 'T(String(e.id||("foe"+i)),ex-24,ey-14,"#8b94b3",10);'
      + 'if(cur&&cur.spawns&&cur.spawns[i%cur.spawns.length]){'
      + 'n=cur.spawns[i%cur.spawns.length].count||1;'
      + 'T("x"+n,ex+14,ey+4,"#8b94b3",10);}}'
      + 'R(px-14,py-10,28,20,"#22c55e");R(px-3,py-22,6,12,"#22c55e");'
      + 'if(running){for(i=0;i<4;i++){'
      + 'R(px-9+i*6,py-24-((tick*7+i*53)%Math.max(1,(py-40))),2,10,"#7fff9f");}}'
      + 'T("WAVE "+(wave+1)+"/"+Math.max(1,waves.length)'
      + '+(cur?("  "+cur.id):""),12,20,"#cfc2ff",13);'
      + 'var vic=KGSM_CONFIG.victory||{};'
      + 'if(vic.afterWave){T("victory after wave "+vic.afterWave,W-190,20,"#8b94b3",11);}}');
    // Endless runner: scrolling obstacles over a ground line.
    p.push('function drawRunner(){R(0,0,W,H,"#0b1024");stars();'
      + 'var wd=KGSM_CONFIG.world||{},P=KGSM_CONFIG.player||{};'
      + 'var gy=wd.groundY==null?H-80:wd.groundY;'
      + 'var spd=((wd.baseSpeed||240)+tick*((wd.speedRampPerSec||4)/60));'
      + 'spd=Math.min(spd,wd.maxSpeed||640);'
      + 'R(0,gy,W,H-gy,"#1a2440");R(0,gy,W,3,"#7c5cff");'
      + 'var hop=Math.abs(Math.sin(tick/18))*(running?1:0);'
      + 'var ph=P.height||40,px=P.x==null?120:P.x;'
      + 'R(px,gy-ph-hop*90,P.width||28,ph,"#22c55e");'
      + 'var obs=KGSM_CONFIG.obstacles||[];'
      + 'for(var i=0;i<obs.length;i++){var o=obs[i];'
      + 'var off=(tick*(spd/60)+i*420)%(W+240);'
      + 'var oy=o.kind==="high"?gy-120-(o.hoverH||60):gy-(o.h||36);'
      + 'R(W+120-off,oy,o.w||28,o.h||36,i%2?"#f59e0b":"#ec4899");'
      + 'T(String(o.id||("ob"+i)),W+120-off,oy-6,"#8b94b3",10);}'
      + 'T("speed "+Math.round(spd)+" px/s  dist "'
      + '+Math.round(tick*spd/60/(wd.pxPerMeter||50))+" m",12,20,"#cfc2ff",12);}');
    // Side scroller: level slice around the spawn with patrolling enemies.
    p.push('function drawScroller(){R(0,0,W,H,"#0b1024");'
      + 'var lvl=KGSM_CONFIG.level||{},P=KGSM_CONFIG.player||{};'
      + 'var sx=(P.spawn&&P.spawn.x)||120,sy=(P.spawn&&P.spawn.y)||300;'
      + 'var lw=(KGSM_CONFIG.world&&KGSM_CONFIG.world.levelWidth)||W;'
      + 'var ox=Math.max(0,Math.min(sx-W/2,Math.max(0,lw-W)));'
      + 'var i,a;'
      + 'var plats=lvl.platforms||[];'
      + 'for(i=0;i<plats.length;i++){a=plats[i];'
      + 'R(a.x-ox,a.y,a.w,a.h,a.oneWay?"#3a4670":"#2a3560");}'
      + 'var hz=lvl.hazards||[];'
      + 'for(i=0;i<hz.length;i++){a=hz[i];R(a.x-ox,a.y,a.w,a.h,"#ef4444");}'
      + 'var cols=lvl.collectibles||[];'
      + 'for(i=0;i<cols.length;i++){a=cols[i];C(a.x-ox,a.y,a.r||10,"#ffd479");}'
      + 'var cps=lvl.checkpoints||[];'
      + 'for(i=0;i<cps.length;i++){a=cps[i];R(a.x-ox,a.y,a.w,a.h,"#22d3ee");}'
      + 'if(lvl.exit){R(lvl.exit.x-ox,lvl.exit.y,lvl.exit.w,lvl.exit.h,"#22c55e");'
      + 'T("EXIT",lvl.exit.x-ox,lvl.exit.y-6,"#7fff9f",11);}'
      + 'var ens=lvl.enemies||[];'
      + 'for(i=0;i<ens.length;i++){a=ens[i];'
      + 'var span=Math.max(1,(a.patrolMaxX||a.x+40)-(a.patrolMinX==null?a.x-40:a.patrolMinX));'
      + 'var ex=(a.patrolMinX==null?a.x-40:a.patrolMinX)'
      + '+(running?(tick*(a.speed||40)/60)%span:span/2);'
      + 'R(ex-ox,a.y,a.w||24,a.h||24,"#ec4899");'
      + 'T(String(a.id||("foe"+i)),ex-ox-6,a.y-6,"#8b94b3",10);}'
      + 'R(sx-ox-10,sy-24,P.width||24,P.height||32,"#22c55e");'
      + 'T("spawn",sx-ox-10,sy+14,"#8b94b3",10);'
      + 'T("level "+lw+"px  cam "+Math.round(ox)+"  plats "+plats.length'
      + '+"  foes "+ens.length,12,20,"#cfc2ff",12);}');
    // Farming: plot grid with a day cycle.
    p.push('function drawFarm(){R(0,0,W,H,"#0d1a12");'
      + 'var f=KGSM_CONFIG.farm||{};'
      + 'var cols=f.cols||6,rows=f.rows||4,ps=f.plotSize||64;'
      + 'var ox=f.originX==null?60:f.originX,oy=f.originY==null?60:f.originY;'
      + 'var dayLen=f.dayLengthSec||60;'
      + 'var day=1+Math.floor(tick/60/dayLen);'
      + 'var crops=KGSM_CONFIG.crops||[];'
      + 'var r,c,g;'
      + 'for(r=0;r<rows;r++){for(c=0;c<cols;c++){'
      + 'var x=ox+c*ps,y=oy+r*ps;'
      + 'R(x,y,ps-4,ps-4,"#1d2b1f");'
      + 'if(crops.length&&(r*cols+c)%3!==2){'
      + 'var cr=crops[(r*cols+c)%crops.length];'
      + 'var st=1+Math.floor(tick/120+(r*cols+c))%(cr.stages||3);'
      + 'g=Math.min(ps-10,10+st*((ps-16)/Math.max(1,(cr.stages||3))));'
      + 'R(x+4,y+ps-8-g,ps-12,g,"#22c55e");}}}'
      + 'T("day "+day+"  plots "+(cols*rows)+"  crops "'
      + '+crops.map(function(k){return k.id;}).join(", "),12,20,"#cfc2ff",12);'
      + 'var sc=KGSM_CONFIG.scoring||{};'
      + 'if(sc.targetCoins){T("goal "+sc.targetCoins+" coins",12,38,"#8b94b3",11);}}');
    p.push('function draw(){ctx.clearRect(0,0,W,H);'
      + 'if(KGSM_GENRE==="endless-runner"){drawRunner();}'
      + 'else if(KGSM_GENRE==="side-scroller"){drawScroller();}'
      + 'else if(KGSM_GENRE==="farming"){drawFarm();}'
      + 'else{drawWaves();}}');
    p.push('function paintHud(){var s=Math.floor(tick/60);'
      + 'hud.innerHTML="";'
      + 'var b=document.createElement("strong");'
      + 'b.textContent=KGSM_NAME||KGSM_GENRE;hud.appendChild(b);'
      + 'var rest="  ·  "+KGSM_GENRE+"  ·  t+"+s+"s  ·  score "+score'
      + '+"  ·  "+(running?"running":"paused")+"  ·  schematic preview";'
      + 'hud.appendChild(document.createTextNode(rest));}');
    p.push('window.addEventListener("message",function(ev){'
      + 'var d=ev.data||{};if(d.source!=="kgsm-shell")return;'
      + 'if(d.command==="run"){running=true;post("info","preview running");}'
      + 'else if(d.command==="pause"){running=false;'
      + 'post("info","preview paused at t+"+Math.floor(tick/60)+"s");}'
      + 'else if(d.command==="restart"){tick=0;score=0;wave=0;running=true;'
      + 'post("info","preview restarted");}paintHud();});');
    p.push('function loop(){if(running){tick++;'
      + 'if(tick%20===0){score++;}'
      + 'var waves=KGSM_CONFIG.waves||[];'
      + 'if(waves.length&&tick%600===0){wave=(wave+1)%waves.length;'
      + 'post("info","wave "+(wave+1)+"/"+waves.length);}'
      + 'if(tick%300===1){post("info","t+"+Math.floor(tick/60)+"s score="'
      + '+score+" ("+KGSM_GENRE+" schematic)");}}'
      + 'draw();if(tick%15===0){paintHud();}'
      + 'requestAnimationFrame(loop);}');
    p.push('fit();paintHud();'
      + 'post("info","schematic preview booted: "+KGSM_GENRE+" "+W+"x"+H'
      + '+" — Export Center builds the playable game");'
      + 'requestAnimationFrame(loop);');
    return p.join('');
  }

  function api() {
    return {
      STATES: STATES, GENRES: GENRES,
      esc: esc, joinUrl: joinUrl, fmtBytes: fmtBytes, fmtCents: fmtCents,
      fmtDate: fmtDate, fmtDuration: fmtDuration, stateLabel: stateLabel,
      allowedTransitions: allowedTransitions, isValidProjectName: isValidProjectName,
      defaultWizard: defaultWizard, buildWizardBlueprint: buildWizardBlueprint,
      validateWizardLocal: validateWizardLocal, foeKeyFor: foeKeyFor,
      foeWordFor: foeWordFor, themeFoes: themeFoes,
      applyThemeToWizard: applyThemeToWizard, appendStoryToNotes: appendStoryToNotes,
      parseApiError: parseApiError,
      summarizeReport: summarizeReport, controlsKeysFor: controlsKeysFor,
      gameSettingsSpec: gameSettingsSpec, genreOfConfig: genreOfConfig,
      buildPreviewPage: buildPreviewPage,
    };
  }

  // Always publish the browser global (api.js reads KgsmUtil at request time);
  // additionally export for Node require() so node --test can load this file.
  if (typeof globalThis !== 'undefined') globalThis.KgsmUtil = api();
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.KgsmUtil;
})();
