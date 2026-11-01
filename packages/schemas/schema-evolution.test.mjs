// Forward-compat guard for the schema-evolution policy
// (SCHEMA-EVOLUTION.md). Stdlib only; run with:
//   node --test packages/schemas/schema-evolution.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

// Mirrors the Current versions table in SCHEMA-EVOLUTION.md:
// file -> [version property, current version].
const CURRENT = {
  'blueprint.schema.json': ['schemaVersion', '1.0.0'],
  'space-shooter.config.schema.json': ['schemaVersion', '1.0.0'],
  'endless-runner.config.schema.json': ['schemaVersion', '1.0.0'],
  'side-scroller.config.schema.json': ['schemaVersion', '1.0.0'],
  'battle-2d.config.schema.json': ['schemaVersion', '1.0.0'],
  'farming.config.schema.json': ['schemaVersion', '1.0.0'],
  'export-manifest.schema.json': ['manifestVersion', '1.0.0'],
};

const load = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

describe('schema versioning', () => {
  it('covers every schema file (no unversioned schema can sneak in)', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.schema.json'));
    assert.deepEqual(new Set(files), new Set(Object.keys(CURRENT)));
  });

  it('pins each current version with a required const (fail-closed)', () => {
    for (const [file, [prop, version]] of Object.entries(CURRENT)) {
      const schema = load(file);
      assert.ok(
        (schema.required || []).includes(prop),
        `${file}: ${prop} must be required`,
      );
      assert.deepEqual(
        schema.properties[prop],
        { const: version },
        `${file}: ${prop} must pin exactly the current version`,
      );
    }
  });

  it('rejects unknown future versions by construction', () => {
    const future = '2.0.0';
    for (const [file, [prop, version]] of Object.entries(CURRENT)) {
      assert.notEqual(
        version, future,
        `${file}: pinned ${prop} must differ from the future probe`,
      );
      assert.equal(
        load(file).properties[prop].const, version,
        `${file}: const must be the only accepted value`,
      );
    }
  });

  it('matches the policy table in SCHEMA-EVOLUTION.md (no drift)', () => {
    const policy = readFileSync(join(dir, 'SCHEMA-EVOLUTION.md'), 'utf8');
    for (const [file, [, version]] of Object.entries(CURRENT)) {
      assert.ok(policy.includes(`\`${file}\``), `policy must list ${file}`);
      assert.ok(
        policy.includes(`\`${version}\``),
        `policy must list current version ${version} for ${file}`,
      );
    }
  });
});
