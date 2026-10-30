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
  ];

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

  function buildWizardBlueprint(w) {
    var abilities = (w.abilities || []).map(function (a) { return String(a).trim(); })
      .filter(function (a) { return a.length > 0; });
    var enemies = (w.enemies || []).map(function (e) {
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
      enemies: enemies,
      progression: String(w.progression || '').trim(),
      scoring: String(w.scoring || '').trim(),
      winCondition: String(w.winCondition || '').trim(),
      loseCondition: String(w.loseCondition || '').trim(),
      seed: (w.seed === '' || w.seed == null) ? null : Number(w.seed),
      notes: String(w.notes || ''),
    };
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
    if (!w.enemies || w.enemies.length < 1) errs.push('At least one enemy is required.');
    (w.enemies || []).forEach(function (e, i) {
      if (!ENEMY_ID_RE.test(e.id || '')) errs.push('Enemy #' + (i + 1) + ': id must match [a-z0-9-]{1,40}.');
      if (!e.role || !String(e.role).trim()) errs.push('Enemy #' + (i + 1) + ': role is required.');
      if (!(e.count >= 1 && e.count <= 512)) errs.push('Enemy #' + (i + 1) + ': count must be 1..512.');
    });
    if (!w.progression || !w.progression.trim()) errs.push('Progression is required.');
    if (!w.scoring || !w.scoring.trim()) errs.push('Scoring is required.');
    if (!w.winCondition || !w.winCondition.trim()) errs.push('Win condition is required.');
    if (!w.loseCondition || !w.loseCondition.trim()) errs.push('Lose condition is required.');
    if (w.seed !== '' && w.seed != null && !(Number(w.seed) >= 0)) errs.push('Seed must be ≥ 0 or empty.');
    return errs;
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

  function api() {
    return {
      STATES: STATES, GENRES: GENRES,
      esc: esc, joinUrl: joinUrl, fmtBytes: fmtBytes, fmtCents: fmtCents,
      fmtDate: fmtDate, stateLabel: stateLabel,
      allowedTransitions: allowedTransitions, isValidProjectName: isValidProjectName,
      defaultWizard: defaultWizard, buildWizardBlueprint: buildWizardBlueprint,
      validateWizardLocal: validateWizardLocal, parseApiError: parseApiError,
      summarizeReport: summarizeReport,
    };
  }

  // Always publish the browser global (api.js reads KgsmUtil at request time);
  // additionally export for Node require() so node --test can load this file.
  if (typeof globalThis !== 'undefined') globalThis.KgsmUtil = api();
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.KgsmUtil;
})();
