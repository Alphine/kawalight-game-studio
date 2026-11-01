# KGSM schema evolution policy

Every JSON document KGSM produces or consumes carries an explicit version
field. Validators are fail-closed: a document whose version is not listed
below MUST be rejected (worker: 422 `validation-failed`), never silently
accepted. This file is the single source of truth for current versions; the
forward-compat test (`schema-evolution.test.mjs`) fails if a schema file and
this table drift apart.

## Current versions

| Schema file                        | Version property | Current |
|------------------------------------|------------------|---------|
| `blueprint.schema.json`            | `schemaVersion`  | `1.0.0` |
| `space-shooter.config.schema.json` | `schemaVersion`  | `1.0.0` |
| `endless-runner.config.schema.json`| `schemaVersion`  | `1.0.0` |
| `side-scroller.config.schema.json` | `schemaVersion`  | `1.0.0` |
| `battle-2d.config.schema.json`     | `schemaVersion`  | `1.0.0` |
| `farming.config.schema.json`       | `schemaVersion`  | `1.0.0` |
| `export-manifest.schema.json`      | `manifestVersion`| `1.0.0` |

Each schema pins its current version with `"const"` and lists the property
in `"required"`, so unknown (past or future) versions fail validation by
construction.

## What counts as additive vs breaking

- Additive (minor bump `1.0.0` -> `1.1.0`): new OPTIONAL properties with
  defaults, new optional genres/templates, loosened `maxLength`/`maximum`.
  Old validators accept new documents only after they bump their pinned
  `const`; until then they keep rejecting them (safe).
- Breaking (major bump `1.x` -> `2.0.0`): new required properties, removed
  or renamed properties, tightened constraints, removed enum values, new
  required `allOf` branches. Adding enum values is breaking for strict
  consumers, so it also takes a major bump.

## Bump procedure (all steps required)

1. Update the schema file: new `const`, new `$id` (`...blueprint.v2.json`).
2. Update the Current versions table above.
3. Update every pinned validator + fixture to the new version, or add an
   explicit migration (see below). The forward-compat test must pass.
4. Note the change in the relevant contract doc (`docs/api-contract.md`
   revision history for blueprint/config shapes).

## Migrations

Prefer no migration: keep old exports readable by keeping old validators
around only when a shipped release wrote that version. When a migration is
needed, ship it as a documented one-way function
(`migrate_<doc>_1_to_2`) with a round-trip test, and record its existence
in step 4 above. Never silently re-stamp a version field to force an old
document through a new validator.
