const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const U = require('./util.js');

describe('joinUrl', () => {
  it('joins base and path, trimming trailing slashes', () => {
    assert.equal(U.joinUrl('http://127.0.0.1:4317/', '/api/v1/health'), 'http://127.0.0.1:4317/api/v1/health');
    assert.equal(U.joinUrl('http://127.0.0.1:4317', 'api/v1/health'), 'http://127.0.0.1:4317/api/v1/health');
  });
});

describe('formatters', () => {
  it('fmtBytes scales units', () => {
    assert.equal(U.fmtBytes(512), '512 B');
    assert.equal(U.fmtBytes(2048), '2.0 KB');
    assert.equal(U.fmtBytes(null), '—');
  });
  it('fmtCents renders dollars or unknown', () => {
    assert.equal(U.fmtCents(250), '$2.50');
    assert.equal(U.fmtCents(null), 'unknown');
  });
  it('fmtDate handles empty and invalid', () => {
    assert.equal(U.fmtDate(null), '—');
    assert.equal(U.fmtDate('not-a-date'), 'not-a-date');
    assert.notEqual(U.fmtDate('2026-01-01T00:00:00Z'), '—');
  });
  it('esc escapes HTML metacharacters', () => {
    assert.equal(U.esc('<a href="x">&\'y\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;y&#39;&lt;/a&gt;');
    assert.equal(U.esc(null), '');
  });
  it('stateLabel replaces underscores', () => {
    assert.equal(U.stateLabel('blueprint_ready'), 'blueprint ready');
  });
});

describe('allowedTransitions (contract §1)', () => {
  it('moves forward exactly one step', () => {
    assert.equal(U.allowedTransitions('draft').forward, 'blueprint_ready');
    assert.equal(U.allowedTransitions('exported').forward, null);
  });
  it('moves backward any distance', () => {
    assert.deepEqual(U.allowedTransitions('playable').backward,
      ['draft', 'blueprint_ready', 'assets_pending', 'assembling']);
    assert.deepEqual(U.allowedTransitions('draft').backward, []);
  });
  it('rejects unknown states', () => {
    assert.deepEqual(U.allowedTransitions('nope'), { forward: null, backward: [] });
  });
});

describe('wizard blueprint', () => {
  it('defaultWizard fails local validation (name/theme required)', () => {
    const errs = U.validateWizardLocal(U.defaultWizard());
    assert.ok(errs.some((e) => e.includes('Project name')));
    assert.ok(errs.some((e) => e.includes('Theme')));
  });
  it('a filled wizard passes and builds a schema-shaped blueprint', () => {
    const w = U.defaultWizard();
    w.name = 'Test Game';
    w.theme = 'Neon belt';
    assert.deepEqual(U.validateWizardLocal(w), []);
    const bp = U.buildWizardBlueprint(w);
    for (const k of ['schemaVersion', 'projectName', 'genre', 'theme', 'visualStyle',
      'targetRuntime', 'resolution', 'controls', 'difficulty', 'gameLoop', 'player',
      'enemies', 'progression', 'scoring', 'winCondition', 'loseCondition']) {
      assert.ok(k in bp, 'missing ' + k);
    }
    assert.equal(bp.schemaVersion, '1.0.0');
    assert.equal(bp.seed, null);
    assert.equal(bp.player.abilities.length, 2);
  });
  it('numeric seed passes through; bad enemy ids fail', () => {
    const w = U.defaultWizard();
    w.name = 'G'; w.theme = 'T'; w.seed = 42;
    w.enemies = [{ id: 'Bad ID!', role: '', count: 0 }];
    const errs = U.validateWizardLocal(w);
    assert.equal(errs.length, 3);
    w.enemies = [{ id: 'drone', role: 'x', count: 1 }];
    assert.deepEqual(U.validateWizardLocal(w), []);
    assert.equal(U.buildWizardBlueprint(w).seed, 42);
  });
  it('isValidProjectName enforces 1..80 chars', () => {
    assert.equal(U.isValidProjectName('  '), false);
    assert.equal(U.isValidProjectName('ok'), true);
    assert.equal(U.isValidProjectName('x'.repeat(81)), false);
  });
});

describe('parseApiError / summarizeReport', () => {
  it('unwraps the contract envelope and keeps quote/report', () => {
    const q = { cents: 5 };
    const p = U.parseApiError({ error: { code: 'cost-blocked', message: 'nope' }, quote: q }, 402);
    assert.equal(p.code, 'cost-blocked');
    assert.equal(p.message, 'nope');
    assert.deepEqual(p.quote, q);
  });
  it('falls back for non-envelope payloads', () => {
    const p = U.parseApiError(null, 500);
    assert.equal(p.code, 'http-500');
    assert.ok(p.message.includes('500'));
  });
  it('summarizeReport tolerates null', () => {
    assert.deepEqual(U.summarizeReport(null), { ok: false, errors: [], warnings: [] });
    const r = U.summarizeReport({ ok: true, errors: [], warnings: [{ message: 'w' }] });
    assert.equal(r.ok, true);
    assert.equal(r.warnings.length, 1);
  });
});
