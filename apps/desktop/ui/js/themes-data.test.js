const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const THEMES_PATH = path.join(__dirname, '..', 'data', 'themes.json');
const SCHEMA_PATH = path.join(__dirname, '..', '..', '..', '..',
  'packages', 'schemas', 'blueprint.schema.json');

const GENRES = ['space-shooter', 'endless-runner', 'side-scroller', 'battle-2d', 'farming'];
// space-shooter + battle-2d use enemies; the other three use obstacles (schema allOf).
const FOE_KEY = {
  'space-shooter': 'enemies',
  'battle-2d': 'enemies',
  'endless-runner': 'obstacles',
  'side-scroller': 'obstacles',
  farming: 'obstacles',
};
const REQUIRED_KEYS = ['theme', 'visualStyle', 'gameLoop', 'player',
  'progression', 'scoring', 'winCondition', 'loseCondition', 'controls', 'difficulty'];
const ID_RE = /^[a-z0-9-]{1,40}$/;

function loadThemes() {
  return JSON.parse(fs.readFileSync(THEMES_PATH, 'utf-8'));
}

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
}

describe('starter theme packs', () => {
  it('themes.json parses and covers all 5 genres', () => {
    const data = loadThemes();
    assert.deepEqual(Object.keys(data).sort(), GENRES.slice().sort());
  });

  it('each genre ships at least 3 starter themes', () => {
    const data = loadThemes();
    for (const genre of GENRES) {
      assert.ok(Array.isArray(data[genre]), genre + ' must be an array');
      assert.ok(data[genre].length >= 3,
        genre + ' needs >=3 themes, got ' + data[genre].length);
    }
  });

  it('theme ids are unique within a genre', () => {
    const data = loadThemes();
    for (const genre of GENRES) {
      const ids = data[genre].map((t) => t.id);
      assert.equal(new Set(ids).size, ids.length, genre + ' has duplicate ids');
    }
  });

  it('every theme sets all required blueprint keys with non-empty values', () => {
    const data = loadThemes();
    for (const genre of GENRES) {
      for (const t of data[genre]) {
        for (const key of REQUIRED_KEYS) {
          assert.ok(key in t, genre + '/' + t.id + ': missing ' + key);
        }
        for (const key of ['theme', 'gameLoop', 'progression', 'scoring',
          'winCondition', 'loseCondition']) {
          assert.equal(typeof t[key], 'string', genre + '/' + t.id + ': ' + key);
          assert.ok(t[key].length > 0, genre + '/' + t.id + ': empty ' + key);
        }
        // Player abilities: non-empty string list.
        assert.ok(Array.isArray(t.player.abilities), genre + '/' + t.id + ': abilities');
        assert.ok(t.player.abilities.length >= 1, genre + '/' + t.id + ': no abilities');
        for (const a of t.player.abilities) {
          assert.equal(typeof a, 'string');
          assert.ok(a.length > 0);
        }
        // Controls scheme + actions.
        assert.equal(typeof t.controls.scheme, 'string', genre + '/' + t.id);
        assert.ok(Array.isArray(t.controls.actions), genre + '/' + t.id + ': actions');
        assert.ok(t.controls.actions.length >= 1, genre + '/' + t.id + ': no actions');
        // Difficulty preset.
        assert.equal(typeof t.difficulty.preset, 'string', genre + '/' + t.id);
      }
    }
  });

  it('each theme carries its genre foe list with valid ids and roles', () => {
    const data = loadThemes();
    for (const genre of GENRES) {
      const foeKey = FOE_KEY[genre];
      for (const t of data[genre]) {
        assert.ok(Array.isArray(t[foeKey]),
          genre + '/' + t.id + ': missing ' + foeKey);
        assert.ok(t[foeKey].length >= 1, genre + '/' + t.id + ': empty ' + foeKey);
        for (const foe of t[foeKey]) {
          assert.match(foe.id, ID_RE, genre + '/' + t.id + ': bad foe id');
          assert.equal(typeof foe.role, 'string');
          assert.ok(foe.role.length > 0, genre + '/' + t.id + ': empty foe role');
        }
      }
    }
  });

  it('enums match the blueprint schema', () => {
    const schema = loadSchema();
    const data = loadThemes();
    const visualStyles = schema.properties.visualStyle.enum;
    const schemes = schema.properties.controls.properties.scheme.enum;
    const presets = schema.properties.difficulty.properties.preset.enum;
    const ramps = schema.properties.difficulty.properties.ramp.enum;
    for (const genre of GENRES) {
      for (const t of data[genre]) {
        assert.ok(visualStyles.includes(t.visualStyle),
          genre + '/' + t.id + ': visualStyle ' + t.visualStyle);
        assert.ok(schemes.includes(t.controls.scheme),
          genre + '/' + t.id + ': scheme ' + t.controls.scheme);
        assert.ok(presets.includes(t.difficulty.preset),
          genre + '/' + t.id + ': preset ' + t.difficulty.preset);
        if (t.difficulty.ramp !== undefined) {
          assert.ok(ramps.includes(t.difficulty.ramp),
            genre + '/' + t.id + ': ramp ' + t.difficulty.ramp);
        }
      }
    }
  });
});
