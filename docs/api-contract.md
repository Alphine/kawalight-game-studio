# KGSM Worker HTTP API Contract v1 (frozen for wave-1 builders)

Worker: stdlib-only Python (`http.server`, `ThreadingHTTPServer`), JSON, bound to
`127.0.0.1`. Default `http://127.0.0.1:4317`; the desktop shell launches the
worker and passes the actual URL (`KGSM_WORKER_URL`). All paths below are
relative to `/api/v1`. `Content-Type: application/json; charset=utf-8` everywhere.

Status: **frozen**. Wave-1 builders implement exactly this; changes need a
contract revision (`/api/v2` or a new `contractVersion`).

## Conventions

- JSON field style: **camelCase** on the wire (DB/arg names stay snake_case in
  Python). `project.json` record shape is the project shape (§1).
- Request bodies are JSON objects (no multipart; file inputs are local paths).
  Max body 20 MB; larger returns `413 {code: body-too-large}`.
- Success: `2xx` + JSON object. Errors: `4xx/5xx` + envelope (never a bare string):
  `{"error": {"code": "<kebab-case>", "message": "<human readable>"}}`.
- Timestamps are UTC ISO-8601 (`createdAt`, `updatedAt`, `exportedAt`).
- Project-relative paths (`assets/...`, `audio/...`) must stay inside the project
  dir; `..` / absolute escapes are rejected (`400 path-escape`).
- `src` parameters are absolute local-filesystem paths readable by the worker
  (same machine, FR-010). No remote URLs in wave 1.
- Unknown JSON fields are ignored; missing/invalid fields → `400 bad-request`.
- Error code → status map: `bad-request/bad-transition/body-too-large/path-escape
  400`; `*-not-found/unknown-* 404`; `cost-blocked/exceeds-limit 402`;
  `needs-confirmation 409`; `godot-not-implemented/not-implemented 501`;
  `provider-error/export-error 502`-ish → use `502`; `internal 500`.
  Validation failures are `200` with `{ok:false,...}` on validate endpoints
  (report, not error), but `422 validation-failed` when validation gates a write.

## 0. Health

- `GET /health` → `200 {"status":"ok","worker":"kgsm","version":"0.1.0",
  "contractVersion":"1.0.0"}`. No other unauthenticated surface exists.

## 1. Projects (FR-001, SDD §2.4; `projects.py`)

Project: `{"id","name","genre","state","stateReason","archived","createdAt",
"updatedAt"}`. `genre ∈ space-shooter|endless-runner|side-scroller|battle-2d|
farming`. States: `draft → blueprint_ready → assets_pending → assembling →
playable → validating → export_ready → exported`.

- `GET /projects?includeArchived=false` → `{"projects":[...]}` (updatedAt desc).
- `POST /projects` `{"name":"1..80 chars","genre"}` → `201` project.
  Errors: `invalid-name`, `unknown-genre`.
- `GET /projects/{id}` → project. `404 project-not-found`.
- `PATCH /projects/{id}` `{"name"?,"archived"?}` → project (rename + archive).
- `POST /projects/{id}/duplicate` `{"name"}` → `201` project (copies dir except
  `project.json`; new id).
- `DELETE /projects/{id}` → `200 {"deleted":true,"id"}` (row + dir removed).
- `POST /projects/{id}/transition` `{"toState","reason"?}` → project.
  Forward exactly one step, no reason needed; backward any distance with
  non-empty `reason` (else `400 bad-transition`); skipping forward is rejected.
- `POST /projects/{id}/mark-stale` `{"reason","toState":"assets_pending"?}` →
  project. `reason` required (`400 stale-reason-required`).

## 2. Blueprints (FR-004/005; `blueprint.py`, `validation`)

Report shape (all validators): `{"ok":bool,"errors":[{"level":"error","code",
"message","path"}],"warnings":[...]}`. Stored file: `blueprint.json`.

- `POST /blueprints/validate` `{"blueprint":{...}}` → `200 {"report":{...}}`
  (stateless, nothing stored; schema `packages/schemas/blueprint.schema.json`).
- `GET /projects/{id}/blueprint` → `{"blueprint":{...}}` or `404 blueprint-not-found`.
- `PUT /projects/{id}/blueprint` `{"blueprint":{...}}` → validates, stores on
  `ok`, returns `{"stored":true,"report"}`; invalid → `422 validation-failed`
  with `{"error":...,"report":{...}}` (report attached for the UI).
- `POST /projects/{id}/blueprint/assemble` `{"blueprint"?}` → `200 {"config":
  {...},"report":{...},"storedConfig":true}`. Uses inline blueprint or stored
  `blueprint.json` (`404` if neither). Deterministic `assemble_space_shooter`;
  only `genre=space-shooter` in wave 1. Writes `config.json`. Errors:
  `assembly-failed` (message carries first validator/assembly reason).
  State transitions are explicit via §1 (assemble does not move state).

## 3. Configs (FR-014/016; `config_validator.py`)

Stored file: `config.json`. Schema per genre; wave 1 serves `space-shooter` only.

- `POST /configs/validate` `{"genre":"space-shooter","config":{...}}` →
  `200 {"report":{...}}`. Other genres → `501 unknown-genre` (reserved).
- `GET /projects/{id}/config` → `{"config":{...}}` or `404 config-not-found`.
- `PUT /projects/{id}/config` `{"config":{...}}` → validates against the
  project's genre schema, stores on `ok`, returns `{"stored":true,"report"}`;
  invalid → `422` with attached report (same shape as §2).

## 4. Assets (FR-010..013,025; `assets/`)

Meta sidecars (`<file>.meta.json`) carry provenance; responses return
`{"path":"assets/...","meta":{...}}` with `width,height,mode,sha256` filled in.

- `POST /projects/{id}/assets/import`
  `{"src":"<abs path>","entity":"...","role":"...","animation"?}` →
  `201 {"path","meta"}`. Exts `.png/.jpg/.jpeg/.webp`. Errors: `asset-error`.
- `POST /projects/{id}/assets/generate`
  `{"providerId","prompt","style":"pixel-art|illustrated-2d","width","height",
  "seed"?,"nImages":1,"entity","role","confirmed":false}` →
  server re-quotes (§6), enforces `authorize` (unconfirmed paid/unknown cost →
  `409 needs-confirmation` or `402 cost-blocked` with the quote attached),
  then generates, `save_generated`s each (provenance: prompt/provider/model/
  seed), `record_spend`s actuals, returns
  `201 {"assets":[{"path","meta"}],"quote":{...},"spentCents":n}`.
  Provider failure → `502 provider-error`; project/last build untouched (NFR-003).
  `1 ≤ nImages ≤ 16`.
- `POST /projects/{id}/assets/slice`
  `{"sheet":"assets/...png","entity","animation","frameRate":1..60,
  "frameWidth","frameHeight","columns"?,"rows"?,"margin":0,"spacing":0}` →
  `201` animation object `{"animation","entity","frameRate","frames":
  ["frame-000.png",...],"grid":{...}}` (frames + `animation.json` persisted).
- `POST /projects/{id}/assets/inspect` `{"path":"assets/..."}` →
  `200 {"format","mode","width","height","hasAlpha","alphaMin"?,"alphaMax"?,
  "colorCount64","distinctColorsCapped257","errors":[],"warnings":[]}`.
  Missing file is data (`errors:["file not found"]`), still `200`.
- `POST /projects/{id}/assets/palette` `{"path","maxColors":16}` →
  `200 {"path","sampledColors","topColors":[{"rgb","share"}],"pixelArtHint"}`.
- `GET /projects/{id}/assets?entity=` → `200 {"assets":[{"path","meta"?}]}` by
  walking `assets/` (meta loaded when its sidecar exists).

## 5. Providers (FR-006/007; `providers/`)

- `GET /providers` → `200 {"providers":[{"id","displayName","model"}]}`
  (wave 1: `mock`; real adapters register the same shape later).

## 6. Costs (FR-009/022, NFR-011; `costs.py`)

Quote: `{"providerId","projectId"|null,"nImages","cents"|null,
"needsConfirmation","reason"}`. `cents=null` = unknown cost (confirmation
mandatory). Limits keyed `global` or `project:<id>`; monthly spend from
`spend_ledger`.

- `POST /costs/quote` `{"providerId","nImages":1..16,"projectId"?}` → quote.
  Errors: `unknown-provider`, `bad-request` (nImages range).
- `POST /costs/authorize` `{"providerId","nImages","projectId"?,"confirmed"}` →
  `200 {"authorized":true,"quote"}` or `409/402 {"error":{"code":
  "needs-confirmation"|"cost-blocked","message":reason},"quote"}`.
  Limit breach blocks even when `confirmed=true`.
- `GET /costs/ledger?projectId?&month=YYYY-MM?` → `200 {"entries":[{"id",
  "scope","projectId"|null,"amountCents","label","createdAt"}],"totalCents":n}`
  (month defaults to current UTC; new query over `spend_ledger`).
- `GET /costs/limits?projectId=` → `200 {"global":cents|null,"project":
  cents|null,"spentThisMonth":{"global":n,"project":n}}`.
- `PUT /costs/limits` `{"scope":"global"|"project","projectId"?,"cents"|null}` →
  `200 {"scope","cents"}` (`null` clears; negative → `400 bad-request`).

## 7. Export (FR-014/017/018/030; `exporters/`)

Builds land in `<project>/builds/`; staging is temp-dir based and ZIP publish is
atomic, so failure never corrupts the last good build (NFR-003). Exports are
secret-scanned (NFR-002); a hit fails the export (`export-error`), nothing is
published.

- `POST /projects/{id}/exports` `{"config"?}` → stages + zips playable and
  source variants (`package_all`), returns `201 {"playable":
  "builds/<slug>-playable.zip","source":"builds/<slug>-source.zip",
  "warnings":[],"manifest":{...}}` (paths project-relative; manifest =
  `kgsm-manifest.json` per `export-manifest.schema.json`).
  Uses inline `config` or stored `config.json`; invalid → `422` with report.
- `GET /projects/{id}/exports` → `200 {"exports":[{"file","bytes","createdAt"}]}`
  listing `builds/*.zip`.
- `POST /projects/{id}/exports/godot` → `501 {"error":{"code":
  "godot-not-implemented","message":"Godot export is planned for M3 (FR-021)."}}`.
  Frozen now so UI/export-center code can target it.

## 8. Backup / restore (FR-027; `project.json` is the portable record)

Backup = ZIP of the project dir (includes `project.json`) under
`.kgsm/backups/<id>-<UTC-timestamp>.zip` + sha256 sidecar.

- `POST /projects/{id}/backup` → `201 {"backupId","file":"<abs path>",
  "sha256","bytes","createdAt"}`.
- `GET /backups` → `200 {"backups":[{"backupId","projectId","file","sha256",
  "bytes","createdAt"}]}` (parsed from filenames/sidecars).
- `POST /projects/restore` `{"backupId"}` → re-creates dir + DB row from the
  ZIP's `project.json` (new id on id-collision: `{"project":{...},
  "reassignedId":true|false}`), `201`. Corrupt ZIP → `422 backup-error`.

## 9. Audio import (FR-029 wave-1 slice: import only)

- `POST /projects/{id}/audio/import` `{"src":"<abs path>","role":"...",
  "entity"?}` → `201 {"path":"audio/...","meta":{"source":"imported","role",
  "entity"|null,"sha256","bytes"}}`. Exts `.wav/.mp3/.ogg`.
  Generation/SFX-synth is out of scope (P2); this endpoint reserves the shape.
- `GET /projects/{id}/audio` → `200 {"audio":[{"path","meta"?}]}` (walk `audio/`).

## 10. Secrets (FR-008, NFR-002; `secrets.py`)

Keys live in `.kgsm/secrets.json` (owner-only perms). Values are write-only:
no endpoint ever returns one.

- `PUT /secrets/{name}` `{"value":"..."}` → `200 {"name","stored":true}`.
- `DELETE /secrets/{name}` → `200 {"name","deleted":true|false}`.
- `GET /secrets` → `200 {"names":[...]}` (names only, sorted).

## 11. Localhost security note

- Bind `127.0.0.1` only; never `0.0.0.0`. No auth token in wave 1 (single-user
  local process, same trust domain as the desktop shell); if a token is added
  later it must be a new contract revision, not a silent change.
- CORS: accept only the Tauri origin/`null` + `127.0.0.1`; still bind-local.
- `src`/path inputs are confined as in Conventions; `..` and symlink escapes
  are rejected before any filesystem write.
- Secrets: never in responses, logs, builds, ZIPs, or manifests; export scans
  for stored values and fails closed. UI shows names only.
- Billable operations always pass quote → authorize; no retries/batch without
  confirmation (NFR-011). Generation failures are `502` with project state
  untouched (NFR-003).
- Request logging redacts secret values (`secrets.redact`) and truncates
  prompts/bodies.

## 12. Project directory layout (normative for builders)

```text
projects/<id>/project.json blueprint.json config.json
               assets/<entity>/[animation/]<role>-<stem>.<ext> + .meta.json
               audio/<entity?>/<role>-<stem>.<ext> + .meta.json
               builds/<slug>-{playable,source}.zip
.kgsm/kgsm.db secrets.json backups/<id>-<ts>.zip(+sha256 sidecar)
```

## Endpoint index (39)

health 1 · projects 8 · blueprints 4 · configs 3 · assets 6 · providers 1 ·
costs 5 · export 3 · backup/restore 3 · audio 2 · secrets 3.


## Revision 1.1 (2026-10-29, additive � route count unchanged at 39)

- assemble, configs/validate, PUT config, and POST exports now also serve `endless-runner` (validated by `endless-runner.config.schema.json`, assembled by `assemble_endless_runner`, exported via the `phaser.endless-runner` template). Other genres still return `501 unknown-genre`.
- Blueprint schema is genre-conditional: `space-shooter` requires `enemies`, `endless-runner` requires `obstacles`; new optional `collectibles` (string) and `controls.actions` (string array).

