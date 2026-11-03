# KGSM Worker HTTP API Contract v1 (frozen for wave-1 builders)

Worker: stdlib-only Python (`http.server`, `ThreadingHTTPServer`), JSON, bound to
`127.0.0.1`. Default `http://127.0.0.1:4317`; the desktop shell launches the
worker and passes the actual URL (`KGSM_WORKER_URL`). All paths below are
relative to `/api/v1`. `Content-Type: application/json; charset=utf-8` everywhere.

Status: **frozen**. Wave-1 builders implement exactly this. Additive
changes (new routes, fields, genres, error codes — see the Revision 1.5
policy) ship as dated Revision entries below with `contractVersion`
staying `1.0.0`; breaking changes need `/api/v2` or a `contractVersion`
bump.

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
- Error code → status map (as implemented): `400` —
  `bad-request`, `bad-transition`, `body-too-large`, `path-escape`,
  `invalid-name`, `stale-reason-required`, `asset-error`, `audio-error`,
  `unknown-theme`;
  `404` — `project-not-found`, `blueprint-not-found`, `config-not-found`,
  `asset-not-found`, `backup-not-found`, `unknown-provider`,
  `playtest-not-found`, and `not-found`
  (no route matches); `unknown-genre` is `404` on `POST /projects` but
  `501` on the config/assemble paths; `402` — `cost-blocked`;
  `409` — `needs-confirmation`; `422` — `validation-failed`,
  `assembly-failed`, `backup-error`; `500` — `internal`;
  `501` — `unknown-genre` on config/assemble paths; `502` —
  `provider-error`, `export-error`. The bare HTTP layer (malformed
  request line, unrouted non-API path) answers `http-error` with the HTTP
  status. Validation failures are `200` with `{ok:false,...}` on validate
  endpoints (report, not error), but `422 validation-failed` when
  validation gates a write.

## 0. Health

- `GET /health` → `200 {"status":"ok","worker":"kgsm","version":"0.2.0",
  "contractVersion":"1.0.0"}`. No other unauthenticated surface exists.

## 1. Projects (FR-001, SDD §2.4; `projects.py`)

Project: `{"id","name","genre","state","stateReason","archived","createdAt",
"updatedAt"}`. `genre ∈ space-shooter|endless-runner|side-scroller|battle-2d|
farming`. States: `draft → blueprint_ready → assets_pending → assembling →
playable → validating → export_ready → exported`.

- `GET /projects?includeArchived=false` → `{"projects":[...]}` (updatedAt desc).
- `POST /projects` `{"name":"1..80 chars","genre"}` → `201` project.
  Errors: `invalid-name` (`400`), `unknown-genre` (`404` here — but `501`
  on the config/assemble paths, see §3).
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
  `blueprint.json` (`404` if neither). Deterministic per-genre assemblers
  serve all five project genres; a genre id outside the known set →
  `501 unknown-genre`. Writes `config.json` only when the assembled config
  passes its genre schema (`storedConfig:false` + report otherwise).
  Errors: `assembly-failed` (`422`; message carries first
  validator/assembly reason).
  State transitions are explicit via §1 (assemble does not move state).

## 3. Configs (FR-014/016; `config_validator.py`)

Stored file: `config.json`. Schema per genre; all five project genres
are served (Revisions 1.1–1.2).

- `POST /configs/validate` `{"genre":"<one of the five>","config":{...}}` →
  `200 {"report":{...}}`. Genre ids outside the known set →
  `501 unknown-genre` (reserved).
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
  `1 ≤ nImages ≤ 16`. Generations serialize: one shared spend lock
  (asset + story routes) is held across the whole quote → authorize →
  provider-call → `record_spend` flow, so concurrent generations queue
  instead of overspending (throughput tradeoff, documented as
  implemented).
  Unknown-cost generations record `0` actual spend with the ledger label
  tagged `[unknown-cost]`.
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
  (registered today: `mock`, `openai-compat`, `llama-image`, `llama-text`;
  see `docs/providers.md`).

## 6. Costs (FR-009/022, NFR-011; `costs.py`)

Quote: `{"providerId","projectId"|null,"nImages","cents"|null,
"needsConfirmation","reason"}`. `cents=null` = unknown cost (confirmation
mandatory). Limits keyed `global` or `project:<id>`; monthly spend from
`spend_ledger`. As implemented: priced quotes block when the new
spend would exceed a limit; unknown-cost quotes (`cents: null`) block
when spend is already at/over a limit — limits engage on both paths.
Unknown cost is also confirmation-gated and records `0` actual spend
with an `[unknown-cost]` ledger label. Story quotes (§13) reuse this
shape with `nImages: 1` standing for the single billable narrative unit. `projectId` on the §6 endpoints
is not existence-checked: quotes, authorizations, limits, and ledger
reads happily attach to phantom ids; only §13 validates the project
(`404 project-not-found`).

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
- `POST /projects/{id}/exports/godot` `{"config"?}` → stages a Godot 4
  project skeleton via the standalone `packages/templates/godot` exporter and
  publishes one secret-scanned ZIP, returns `201 {"godot":
  "builds/<slug>-godot4.zip","warnings":[],"manifest":{...}}` (manifest =
  `kgsm-manifest.json` per `export-manifest.schema.json`, stamped
  `godot.<genre>`). Uses inline `config` or stored `config.json` (a
  `phaser.<genre>` config; worker re-stamps the id internally); invalid →
  `422` with report. Config/blueprint genre must match the project genre
  (`422` otherwise); a missing `blueprint.json` falls back to a minimal
  blueprint synthesized from the project record.

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

Keys live in `.kgsm/secrets.json` as plaintext JSON. The worker applies
`chmod 0o600` on save, best-effort: POSIX owner-only where supported, a
no-op on Windows, where the file relies on the user-profile ACLs. Values
are write-only: no endpoint ever returns one.

- `PUT /secrets/{name}` `{"value":"..."}` → `200 {"name","stored":true}`.
- `DELETE /secrets/{name}` → `200 {"name","deleted":true|false}`.
- `GET /secrets` → `200 {"names":[...]}` (names only, sorted).

## 11. Localhost security note

- Bind `127.0.0.1` only; never `0.0.0.0`. No auth token in wave 1 (single-user
  local process, same trust domain as the desktop shell); if a token is added
  later it must be a new contract revision, not a silent change.
- CORS: reflect only `http(s)` origins on `127.0.0.1`/`localhost` plus
  the `tauri` scheme / `tauri.localhost`; the opaque `null` origin is
  explicitly rejected. Still bind-local.
- Cross-site guard: CORS alone does not stop a simple cross-origin POST
  from running its side effects, so any request carrying an `Origin` outside
  the allowlist above gets `403 forbidden-origin`, and every mutating method
  (`POST`/`PUT`/`PATCH`/`DELETE`) must send `Content-Type: application/json`
  or gets `415 unsupported-media-type`. Requests without an `Origin` header
  (CLI, scripts, tests) are unaffected by the origin check.
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

## 13. Story generation (NEW; `story.py`)

Produces lore/story/dialogue text via a text-capable provider.
`providerId` defaults to `mock` (deterministic offline placeholder, zero
cost); any registered provider exposing `generate_text` works as a real
backend, while image-only providers fail with `502 provider-error`.
Cost-guarded exactly like asset generation (§4): the handler re-quotes
(one story = one billable unit, carried as `nImages: 1` in the quote),
enforces `authorize`, then generates and `record_spend`s actuals.
`projectId`, when given, must reference an existing project (else `404
project-not-found`) and scopes the spend. Like §4, the whole flow runs
under the shared spend lock (concurrent generations serialize), and
unknown-cost stories record `0` actual spend with an `[unknown-cost]`
ledger label, exactly like §4 asset rows.

- `POST /stories/generate`
  `{"prompt":"non-empty, ≤8000 chars","genre"?:"≤64 chars",
  "projectId"?,"providerId"?:="mock","confirmed":false}` →
  `201 {"text","provider","model","usage":{"promptChars","textChars",...},
  "quote":{...},"spentCents":n}`.
  Unconfirmed paid/unknown cost → `409 needs-confirmation` or
  `402 cost-blocked` with the quote attached. Errors: `unknown-provider`
  (`404`), `project-not-found` (`404`), `provider-error` (`502`; nothing
  spent, NFR-003).

## 14. Auto mode (one-click game; `auto.py`, `docs/auto-mode.md`)

- `POST /projects/auto` `{"name","genre","prompt"?,"themeId"?}` →
  creates the project, builds a blueprint (explicit `themeId`,
  whitespace-trimmed, or a keyword-matched starter theme per genre;
  `prompt` recorded into blueprint notes, truncated to 4000 chars),
  assembles, validates, stores the blueprint + config
  (`blueprint.json` + `config.json` in the project dir), and packages
  a phaser playable ZIP plus its `-source.zip` sibling — returns `201
  {"project", "blueprint", "config", "validation", "playable"}` (the
  `playable` path is the playable ZIP; the source ZIP sits alongside
  it under `builds/`). Any post-create failure cleans up: no half
  project is left behind. Errors: `bad-request` (`400`, wrong field
  type), `invalid-name` (`400`), `unknown-theme` (`400`),
  `unknown-genre` (`404`), `validation-failed` (`422` with report),
  `assembly-failed` (`422`, no report), `export-error` (`502`),
  `internal` (`500`, packaged manifest unreadable). Deterministic
  offline; no provider spend.

## 15. Playtest serve (real game; `playtest.py`, `docs/playtest.md`)

- `POST /projects/{id}/playtest` → stages the stored config into
  `builds/playtest/` via the shared exporter (the staged tree is
  secret-scanned exactly like an export), returns `201 {"url":
  "/api/v1/projects/{id}/playtest/", "stagedAt"}`. Errors:
  `project-not-found` (`404`), `config-not-found` (`404`), `internal`
  (`500`, stored `config.json` is corrupt), `export-error` (`502`).
- `GET /projects/{id}/playtest[/]` and
  `GET /projects/{id}/playtest/<path...>` → staged file bytes with
  the file's MIME type — the ONE non-JSON reply in the API (an
  iframe points at the `url`; load it WITH the trailing slash so
  relative asset URLs resolve). Serve failures are JSON `404
  playtest-not-found` (never 400/500): pre-stage, missing file,
  directory, or any path-escape/symlink guard violation; unknown
  project id is `404 project-not-found`.

## Endpoint index (44)

health 1 · projects 8 · blueprints 4 · configs 3 · assets 6 · providers 1 ·
costs 5 · export 3 · backup/restore 3 · audio 2 · secrets 3 · stories 1 ·
auto 1 · playtest 3.


## Revision 1.1 (2026-10-29, additive — route count unchanged at 39)

- assemble, configs/validate, PUT config, and POST exports now also serve `endless-runner` (validated by `endless-runner.config.schema.json`, assembled by `assemble_endless_runner`, exported via the `phaser.endless-runner` template). Other genres still return `501 unknown-genre`.
- Blueprint schema is genre-conditional: `space-shooter` requires `enemies`, `endless-runner` requires `obstacles`; new optional `collectibles` (string) and `controls.actions` (string array).


## Revision 1.2 (2026-10-30, additive - route count unchanged at 39)

- assemble, configs/validate, PUT config, and POST exports now also serve
  side-scroller, battle-2d, and farming (validated by
  side-scroller.config.schema.json, battle-2d.config.schema.json, and
  farming.config.schema.json; assembled by assemble_side_scroller,
  assemble_battle_2d, and assemble_farming; exported via the
  phaser.side-scroller, phaser.battle-2d, and phaser.farming templates).
  All five project genres are now served; unknown-genre 501 remains for
  genre/template ids outside the known set.
- Blueprint schema is genre-conditional for all genres: space-shooter and
  battle-2d require enemies; endless-runner, side-scroller, and farming
  require obstacles. controls.scheme gains mouse-keyboard for farming.


## Revision 1.3 (2026-10-30, additive - route count unchanged at 39)

- `POST /projects/{id}/exports/godot` is implemented (was `501
  godot-not-implemented`): validates the project's `phaser.<genre>` config,
  re-stamps the template id to `godot.<genre>`, and returns `201 {"godot",
  "warnings", "manifest"}` with a secret-scanned `*-godot4.zip` in `builds/`.
  Config/blueprint genre must match the project genre (`422` otherwise);
  missing `blueprint.json` falls back to a synthesized minimal blueprint.
  Error code `godot-not-implemented` is retired.


## Revision 1.4 (2026-10-31, additive - route count 39 -> 40)

- New `POST /stories/generate` (§13): lore/story/dialogue text via a
  text-capable provider (`story.py` + `routes_story.py`). `providerId`
  defaults to `mock` (deterministic offline placeholder, zero cost); real
  backends plug in duck-typed via `generate_text` with no `providers/`
  changes. Cost-guarded exactly like asset generation (quote → authorize →
  `409`/`402` with quote attached → `record_spend`); failures spend
  nothing (NFR-003). Wire-up: mount `routes_story.ROUTES` in
  `server._collect_routes` (one line).


## Revision 1.5 (2026-10-31, additive — route count unchanged at 40)

Doc-clarification revision: no wire changes, `contractVersion` stays
`1.0.0`. It formally adopts the additive-vs-breaking policy applied by
Revisions 1.1–1.4 and corrects stale normative text to the implementation
(descriptions below state code behavior as it is):

- **Revision policy.** Additive changes — new routes, new optional
  request/response fields, new genres served by existing routes, new
  error codes for previously-unhandled cases, new providers behind the
  existing shapes — ship as dated Revision entries with `contractVersion`
  unchanged. Breaking changes — removing/renaming routes or fields,
  changing status codes or envelope shapes, altering validation
  acceptance, adding auth — require `/api/v2` or a `contractVersion`
  bump. Revisions are append-only: old entries are never edited.
- **Error map (Conventions).** `unknown-genre` is `404` on
  `POST /projects` but `501` on the config/assemble paths; retired codes
  `exceeds-limit`, `not-implemented`, and `godot-not-implemented` are
  unemitted and removed from the map; actually-emitted codes
  (`unknown-provider`, `not-found`, `asset-not-found`,
  `backup-not-found`, `http-error`, `asset-error`, `audio-error`,
  `backup-error`, `assembly-failed`, `invalid-name`,
  `stale-reason-required`) are now listed with their statuses.
- **§0/§1/§2/§3/§5.** Health `version` is `0.2.0`; assemble,
  configs/validate, PUT config, and exports serve all five genres (`501`
  only for genre ids outside the known set); assemble reports
  `storedConfig:false` (nothing written) when the assembled config fails
  its genre schema; `GET /providers` lists `mock`, `openai-compat`,
  `llama-image`, `llama-text`.
- **§6/§13 costs.** Priced quotes block when new spend would exceed
  a limit; unknown-cost quotes block when spend is already at/over a
  limit (limits engage on both paths). Unknown cost is also
  confirmation-gated and records `0` with an `[unknown-cost]` ledger
  label. Story quotes reuse the quote shape with `nImages: 1` for the
  single narrative unit. `projectId` on §6 endpoints is not
  existence-checked; only §13 returns `404 project-not-found`.
- **§4/§13 serialization.** One shared spend lock (asset + story
  routes) is held across the whole quote → authorize → provider-call →
  spend flow: concurrent generations queue (throughput tradeoff, kept
  as implemented). Unknown-cost rows in both §4 and §13 carry an
  `[unknown-cost]` ledger label.
- **§10 secrets.** The store is plaintext JSON; `chmod 0o600` is
  best-effort (no-op on Windows, which relies on user-profile ACLs).
- **§11 CORS.** Only `http(s)` `127.0.0.1`/`localhost` origins plus the
  `tauri` scheme / `tauri.localhost` are reflected; opaque `null` is
  rejected.
- **Schema evolution.** Every schema pins `schemaVersion` const
  `1.0.0` and validators fail closed on anything else; there is no
  migration path yet. The Godot exporter works around the
  `phaser.<genre>` template-id pin by re-stamping a copy in memory
  (`docs/godot-exporter.md`). A future migration policy ships as a new
  Revision; until then builders must emit exactly `1.0.0`.


## Revision 1.6 (2026-11-01, additive — route count 40 → 44)

- **§14 Auto mode.** New `POST /projects/auto`: one call runs
  create → blueprint → assemble → validate → store config →
  package playable. Fully specified in `docs/auto-mode.md`.
- **§15 Playtest serve.** New `POST /projects/{id}/playtest`
  (stage) plus two GET serve routes returning RAW BYTES with the
  staged file's MIME type — the deliberate exception to the
  JSON-everywhere convention, so a Playtest iframe can load the
  staged game directly. Serve failures stay JSON `404
  playtest-not-found`. Fully specified in `docs/playtest.md`.
