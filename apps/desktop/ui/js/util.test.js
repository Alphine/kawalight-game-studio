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

describe('fmtDuration', () => {
  it('renders m:ss or an em dash', () => {
    assert.equal(U.fmtDuration(null), '—');
    assert.equal(U.fmtDuration(undefined), '—');
    assert.equal(U.fmtDuration(0), '0:00');
    assert.equal(U.fmtDuration(5.9), '0:05');
    assert.equal(U.fmtDuration(61.5), '1:01');
    assert.equal(U.fmtDuration(600), '10:00');
  });
});

describe('controlsKeysFor / gameSettingsSpec', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const demoDir = path.join(__dirname, '..', '..', '..', '..',
    'packages', 'templates', 'phaser');

  it('covers all five genres with schema-required control keys', () => {
    assert.deepEqual(U.controlsKeysFor('space-shooter'),
      ['up', 'down', 'left', 'right', 'fire', 'pause']);
    assert.deepEqual(U.controlsKeysFor('battle-2d'),
      ['up', 'down', 'left', 'right', 'fire', 'melee', 'pause']);
    assert.deepEqual(U.controlsKeysFor('endless-runner'), ['jump', 'slide', 'pause']);
    assert.deepEqual(U.controlsKeysFor('side-scroller'), ['left', 'right', 'jump', 'pause']);
    assert.deepEqual(U.controlsKeysFor('farming'),
      ['toolPlant', 'toolWater', 'toolHarvest', 'nextDay', 'pause']);
    assert.throws(() => U.controlsKeysFor('nope'), /unknown genre/);
  });

  it('every spec path resolves against the real demo config', () => {
    for (const genre of U.GENRES) {
      const cfg = JSON.parse(fs.readFileSync(
        path.join(demoDir, genre, 'config.demo.json'), 'utf-8'));
      const spec = U.gameSettingsSpec(genre);
      assert.ok(spec.sections.length >= 2, genre + ' needs sections');
      assert.deepEqual(spec.controls, U.controlsKeysFor(genre));
      for (const section of spec.sections) {
        assert.ok(section.fields.length > 0, genre + '/' + section.title);
        for (const f of section.fields) {
          const keys = f.path.split('.');
          let node = cfg;
          for (const k of keys) node = node == null ? node : node[k];
          assert.notEqual(node, undefined,
            genre + ': spec path missing from demo config: ' + f.path);
        }
      }
      for (const key of spec.controls) {
        assert.ok(key in cfg.controls, genre + ': control key missing: ' + key);
      }
      assert.ok('preset' in cfg.difficulty, genre + ': difficulty.preset missing');
    }
  });

  it('rejects unknown genres', () => {
    assert.throws(() => U.gameSettingsSpec('nope'), /unknown genre/);
  });
});

describe('buildPreviewPage', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const demoDir = path.join(__dirname, '..', '..', '..', '..',
    'packages', 'templates', 'phaser');

  it('builds a working page per genre from the real demo configs', () => {
    for (const genre of U.GENRES) {
      const cfg = JSON.parse(fs.readFileSync(
        path.join(demoDir, genre, 'config.demo.json'), 'utf-8'));
      assert.equal(U.genreOfConfig(cfg), genre);
      const html = U.buildPreviewPage(cfg, 'Demo ' + genre);
      assert.ok(html.includes('<!doctype html>'), genre);
      assert.ok(html.includes('<canvas id="cv">'), genre);
      // Drawing code is an external file (CSP forbids inline scripts).
      assert.ok(html.includes('<script src="js/schematic-runtime.js">'), genre);
      assert.equal(html.includes('<script>'), false, genre + ' no inline script');
      // Config values are embedded as JSON so the schematic draws real data.
      assert.ok(html.includes('"' + cfg.world.width + '"') || html.includes(':' + cfg.world.width),
        genre + ' world width embedded');
      // Two script closes: the data block and the runtime tag. No breakout.
      assert.equal(html.split('</scr' + 'ipt>').length - 1, 2, genre);

      const runtime = fs.readFileSync(path.join(__dirname, 'schematic-runtime.js'), 'utf-8');
      assert.ok(runtime.includes('kgsm-game') && runtime.includes('kgsm-shell'), genre);
      assert.ok(runtime.includes('run') && runtime.includes('pause') && runtime.includes('restart'), genre);
    }
  });

  it('escapes hostile config content and names', () => {
    const evil = {
      template: { id: 'phaser.space-shooter', version: '1.0.0' },
      world: { width: 960, height: 540 },
      note: '</scr' + 'ipt><img src=x onerror=alert(1)>',
    };
    const html = U.buildPreviewPage(evil, '<b>evil</b>');
    assert.ok(!html.includes('</scr' + 'ipt><img'), 'script breakout blocked');
    assert.ok(html.includes('\\u003c/script>'), 'angle brackets escaped in JSON');
    assert.ok(html.includes('&lt;b&gt;evil&lt;/b&gt;'), 'name escaped in title');
    assert.ok(!html.includes('<b>evil</b>'), 'raw name absent');
  });

  it('tolerates an empty config', () => {
    assert.equal(U.genreOfConfig({}), 'unknown');
    assert.equal(U.genreOfConfig(null), 'unknown');
    const html = U.buildPreviewPage({}, '');
    assert.ok(html.includes('schematic preview'));
  });
});

describe('themeFoes', () => {
  it('normalizes enemies and obstacles to id/role pairs', () => {
    assert.deepEqual(U.themeFoes({ enemies: [{ id: 'a', role: 'x' }] }), [{ id: 'a', role: 'x' }]);
    assert.deepEqual(U.themeFoes({ obstacles: [{ id: 'b', role: 'y' }] }), [{ id: 'b', role: 'y' }]);
    assert.deepEqual(U.themeFoes({}), []);
    assert.deepEqual(U.themeFoes(null), []);
  });
});

describe('applyThemeToWizard', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const themes = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'data', 'themes.json'), 'utf-8'));

  it('prefills an enemies-genre theme and preserves manual fields', () => {
    const w = U.defaultWizard();
    w.name = 'My Game'; w.seed = 7; w.notes = 'keep me';
    const before = JSON.parse(JSON.stringify(w));
    const next = U.applyThemeToWizard(w, themes['space-shooter'][0]);
    assert.deepEqual(w, before, 'input untouched');
    assert.equal(next.name, 'My Game');
    assert.equal(next.seed, 7);
    assert.equal(next.notes, 'keep me');
    assert.equal(next.theme, 'Neon Swarm over Vega Prime');
    assert.equal(next.visualStyle, 'pixel-art');
    assert.ok(next.gameLoop.includes('Vega Prime'));
    assert.deepEqual(next.abilities, ['move', 'shoot', 'dash']);
    assert.equal(next.enemies.length, 3);
    assert.deepEqual(next.enemies[0], { id: 'ember-drone', role: 'basic drifter that flies straight at the player', count: 4 });
    assert.equal(next.scheme, 'keyboard');
    assert.equal(next.difficulty, 'normal');
    assert.equal(next.ramp, 'gradual');
    assert.deepEqual(U.validateWizardLocal(next), []);
  });

  it('maps obstacle-genre foes onto the wizard enemy list', () => {
    const w = U.defaultWizard();
    w.name = 'G'; w.genre = 'endless-runner';
    const next = U.applyThemeToWizard(w, themes['endless-runner'][0]);
    assert.equal(next.theme, 'Neon Rooftops sprint');
    assert.deepEqual(next.enemies.map((e) => e.id),
      ['vent-spike', 'billboard-crate', 'patrol-drone']);
    assert.deepEqual(U.validateWizardLocal(next), []);
    const farm = U.applyThemeToWizard(w, themes.farming[0]);
    assert.equal(farm.scheme, 'mouse-keyboard');
    assert.equal(farm.enemies.length, 2);
  });

  it('null theme returns an equal copy', () => {
    const w = U.defaultWizard();
    const next = U.applyThemeToWizard(w, null);
    assert.deepEqual(next, w);
    assert.notEqual(next, w);
  });
});

describe('appendStoryToNotes', () => {
  it('sets or appends notes without touching the input', () => {
    assert.deepEqual(U.appendStoryToNotes({ notes: '' }, '  Once upon…  '), { notes: 'Once upon…' });
    const bp = { genre: 'farming', notes: 'plan' };
    const next = U.appendStoryToNotes(bp, 'A tale.');
    assert.equal(bp.notes, 'plan', 'input untouched');
    assert.equal(next.genre, 'farming');
    assert.equal(next.notes, 'plan\n\n--- Story ---\nA tale.');
    assert.deepEqual(U.appendStoryToNotes({ notes: 'x' }, '   '), { notes: 'x' });
  });
});

describe('free genre (custom genre text)', () => {
  const ready = (over) => Object.assign(U.defaultWizard(), { name: 'Cat Game', theme: 'Cats' }, over || {});

  it('defaultWizard starts with free genre off and empty text', () => {
    const w = U.defaultWizard();
    assert.equal(w.freeGenre, false);
    assert.equal(w.customGenre, '');
  });

  it('validateCustomGenre accepts trimmed text up to 120 characters', () => {
    assert.equal(U.validateCustomGenre('  tower defense with cats  '), null);
    assert.equal(U.validateCustomGenre('x'.repeat(120)), null);
  });

  it('validateCustomGenre rejects empty, oversize and control-character text', () => {
    assert.match(U.validateCustomGenre('   '), /required/);
    assert.match(U.validateCustomGenre(undefined), /required/);
    assert.match(U.validateCustomGenre('x'.repeat(121)), /120/);
    assert.match(U.validateCustomGenre('cats\nmice'), /control/);
    assert.match(U.validateCustomGenre('cats\tmice'), /control/);
    assert.match(U.validateCustomGenre('cats\u007f'), /control/);
  });

  it('customGenreFor returns text only when free genre is on', () => {
    assert.equal(U.customGenreFor(ready({ freeGenre: true, customGenre: '  visual novel mystery ' })), 'visual novel mystery');
    assert.equal(U.customGenreFor(ready({ freeGenre: false, customGenre: 'ignored' })), '');
    assert.equal(U.customGenreFor(null), '');
  });

  it('validateWizardLocal requires a description only in free-genre mode', () => {
    assert.deepEqual(U.validateWizardLocal(ready({ freeGenre: false })), []);
    const errs = U.validateWizardLocal(ready({ freeGenre: true, customGenre: '  ' }));
    assert.ok(errs.some((e) => /Free genre/.test(e)), errs.join('|'));
    assert.deepEqual(U.validateWizardLocal(ready({ freeGenre: true, customGenre: 'cats in space' })), []);
  });

  it('free genre keeps the base mechanic as the blueprint genre', () => {
    const bp = U.buildWizardBlueprint(ready({ genre: 'farming', freeGenre: true, customGenre: 'cozy cafe' }));
    assert.equal(bp.genre, 'farming');
    assert.equal(Object.prototype.hasOwnProperty.call(bp, 'customGenre'), false);
  });
});
