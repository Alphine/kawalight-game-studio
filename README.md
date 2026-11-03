# Kawalight Game Studio Maker (KGSM)

Local-first AI-assisted 2D game creation studio. Governing spec:
[Kawalight Game Studio Maker SDD v1.0](Kawalight%20Game%20Studio%20Maker%20SDD%20v1.0.md).
UI target: `Kawalight Game Studio Dashboard.png` (mockup).

Product promise: **choose theme + genre → generate assets → assemble a playable
game → test and tune → export the project.**

Core design: template-driven game factory. AI assists content/config; deterministic,
tested genre templates run gameplay.

## Live app

- **Landing page:** https://basyid.dev/kgsm/
- **Studio (sign-in required):** https://basyid.dev/kgsm/app/

The live site runs the same worker and studio UI as this repo. See the
[Web bundle](#web-bundle-static-hosting) section for how it is deployed.

## Wiki

The player and maker guide lives in [`wiki/`](wiki/Home.md): getting started,
genres, AI providers, playtest and export, architecture, and troubleshooting.
The `docs/` folder keeps the exact API and runbook contracts.

## Layout (maps to SDD §5)

```text
apps/
  desktop/                 Tauri 2 shell + vanilla HTML/CSS/JS UI (SDD §5.1)
    src-tauri/             Cargo project, tauri.conf.json
    ui/                    index.html, styles.css, app.js
  worker/                  Local orchestration service, Python 3.12+ (SDD §5.2/5.3)
    src/kgsm/              project service, providers, asset pipeline,
                           validators, export orchestrator
    tests/                 pytest suite (FR-020, NFR-005)
packages/
  schemas/                 blueprint, genre config, export manifest (JSON Schema)
  templates/
    phaser/
      runtime/             shared Phaser services (audio, debug, input,
                           juice, store) as ES modules
      space-shooter/       genre module (SDD §3.1, §3.6) + demo game
      endless-runner/      genre module + demo game
      side-scroller/       genre module + demo game
      battle-2d/           genre module + demo game
      farming/             genre module + demo game
    godot/                 Godot 4 exporter templates (separate adapter, FR-021)
projects/                  local project data root (user content, git-ignored)
```

## Quickstart

```powershell
# worker tests (396 passed + 4 skipped; test_api.py uses live localhost
# sockets, so run where listen() on 127.0.0.1 is allowed)
.\.venv\Scripts\python.exe -m pytest apps\worker\tests -q

# godot exporter tests (72, no sockets needed)
.\.venv\Scripts\python.exe -m pytest packages\templates\godot\tests -q

# template logic tests (no browser needed)
node --test packages\templates\phaser\space-shooter\test\logic.test.js
node --test packages\templates\phaser\endless-runner\test\logic.test.js
node --test packages\templates\phaser\side-scroller\test\logic.test.js
node --test packages\templates\phaser\battle-2d\test\logic.test.js
node --test packages\templates\phaser\farming\test\logic.test.js

# UI logic tests (no browser needed)
node --test apps\desktop\ui\js\util.test.js

# stage + headless-Chrome smoke a demo (from the repo root)
node packages\templates\phaser\tools\stage-demo.mjs space-shooter
node packages\templates\phaser\tools\smoke.mjs space-shooter
node packages\templates\phaser\tools\stage-demo.mjs endless-runner
node packages\templates\phaser\tools\smoke.mjs endless-runner
node packages\templates\phaser\tools\stage-demo.mjs side-scroller
node packages\templates\phaser\tools\smoke.mjs side-scroller
node packages\templates\phaser\tools\stage-demo.mjs battle-2d
node packages\templates\phaser\tools\smoke.mjs battle-2d
node packages\templates\phaser\tools\stage-demo.mjs farming
node packages\templates\phaser\tools\smoke.mjs farming
```

## Test conventions

- Route tests go through `server.dispatch` directly (no sockets) —
  `test_api_genres.py`, `test_api_ops.py`, and `test_story.py` are the
  pattern. `test_api.py` is the one live-socket suite (real localhost
  `listen()` + HTTP round-trips); keep it that way and don't add more
  socket-bound suites.
- Test providers registered via `register_provider()` mutate the global
  registry: register inside fixtures with teardown that restores the
  prior state, never bare at module scope.

## Milestones

| # | Scope | Status |
|---|-------|--------|
| M0 | Repo scaffold, schemas, worker core (projects, providers-mock, assets, validation, Phaser export), space-shooter template playable, dashboard home, smoke tests | done |
| M1 | Worker HTTP API (39 endpoints, contract v1 frozen), full dashboard UI (11 views: Home, New Game wizard, Blueprint, Asset Forge/Lab, Level Studio, Game Settings, Playtest, Validation, Export, Settings), openai-compat provider | done |
| M2 | Endless-runner template (playable, tested, smoke-green) + full worker support (schema, validate, assemble, export, CLI), backup/restore (worker + CLI + UI), audio import (worker + CLI + UI view), auto-stage/preview Playtest wiring, multi-genre Level Studio | done |
| M3 | Side-scroller + battle-2D templates (playable, tested, smoke-green, full worker support), Godot 4 exporter (standalone + worker/UI wiring, secret-scanned ZIP) | done — Godot output not yet opened in a real Godot editor (acceptance pass open) |
| M4 | Farming template (playable, tested, smoke-green, full worker support), UI polish pass, portable binary v0.2.0 | done |
| AI expansion | Meta/Llama BYOK provider (Together/Groq/OpenRouter/HF presets) for images + story text, POST /stories/generate (40 endpoints), 15 starter themes (3/genre) with wizard picker | done |
| AUTO + playtest | One-click `POST /projects/auto` pipeline (44 endpoints, contract Rev 1.6) + real-game playtest stage/serve backend (`docs/auto-mode.md`, `docs/playtest.md`) | done |

## Working agreements

- Config is data: JSON validated against `packages/schemas` before it reaches
  runtime (NFR-009). Templates and schemas are versioned (NFR-012).
- API keys stay local, never enter builds, ZIPs, or logs (NFR-002, FR-008).
- Paid generation needs confirmation and respects spend limits (FR-009, FR-022).
- Provider failure never corrupts the project or last good build (NFR-003).
- Same template + config + runtime + seed = repeatable behavior (NFR-004).

## Toolchain notes

- Python 3.12+ (repo uses `.venv`), Node 18+, Rust for Tauri packaging
  (repo pins nightly via `apps/desktop/rust-toolchain.toml` because this
  machine's stable rustc is broken).
- If `rustc` on the stable toolchain is broken, repair with
  `rustup component add rustc --toolchain stable` before running the Tauri shell;
  the UI in `apps/desktop/ui` also runs in a plain browser for development.

## Binary release (v0.2.0)

- One portable folder: `apps/desktop/dist-release/` (git-ignored,
  regenerable) — `kawalight-studio-maker.exe` + `kgsm-worker-*.exe`
  sidecar side by side. Copy anywhere and run, no installer.
- First run: dashboard opens in an app window; the worker sidecar
  auto-starts on `127.0.0.1:4317`. API keys stay local (Settings view).
- Rebuild/runbook/troubleshooting: [docs/RELEASE.md](docs/RELEASE.md).
- Playtest: the worker stages the stored config and serves the REAL game
  over localhost (`POST /projects/{id}/playtest` + GET serve, contract
  §15, `docs/playtest.md`) — the running worker is the playtest server.
  The UI also keeps a schematic canvas preview for offline sketches; for
  no-worker checks use the stage-demo/smoke commands above or open an
  exported build.

## Web bundle (static hosting)

- `node packages/web/tools/make-web-bundle.mjs` rebuilds the git-ignored
  `dist-web/` folder (landing page + Studio UI + 5 staged games); never
  hand-edit that folder, just rebuild it.
- Deploy/hosting guide (shared Hostinger upload or VPS full-stack):
  [packages/web/README-DEPLOY.md](packages/web/README-DEPLOY.md).
