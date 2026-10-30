# Kawalight Game Studio Maker (KGSM)

Local-first AI-assisted 2D game creation studio. Governing spec:
[Kawalight Game Studio Maker SDD v1.0](Kawalight%20Game%20Studio%20Maker%20SDD%20v1.0.md).
UI target: `Kawalight Game Studio Dashboard.png` (mockup).

Product promise: **choose theme + genre → generate assets → assemble a playable
game → test and tune → export the project.**

Core design: template-driven game factory. AI assists content/config; deterministic,
tested genre templates run gameplay.

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
      runtime/             shared Phaser services (input, scenes, audio, UI,
                           save, debug) as ES modules
      space-shooter/       genre module #1 (SDD §3.1, §3.6) + demo game
      endless-runner/      genre module #2 + demo game (M2)
    godot/                 Godot 4 exporter templates (separate adapter, FR-021)
projects/                  local project data root (user content, git-ignored)
```

## Quickstart

```powershell
# worker tests (160; test_api.py needs a real localhost socket,
# so run outside sandboxes that forbid listen())
.\.venv\Scripts\python.exe -m pytest apps\worker\tests -q

# template logic tests (no browser needed)
node --test packages\templates\phaser\space-shooter\test\logic.test.js
node --test packages\templates\phaser\endless-runner\test\logic.test.js

# UI logic tests (no browser needed)
node --test apps\desktop\ui\js\util.test.js

# stage + headless-Chrome smoke a demo (from the repo root)
node packages\templates\phaser\tools\stage-demo.mjs space-shooter
node packages\templates\phaser\tools\smoke.mjs space-shooter
node packages\templates\phaser\tools\stage-demo.mjs endless-runner
node packages\templates\phaser\tools\smoke.mjs endless-runner
```

## Milestones

| # | Scope | Status |
|---|-------|--------|
| M0 | Repo scaffold, schemas, worker core (projects, providers-mock, assets, validation, Phaser export), space-shooter template playable, dashboard home, smoke tests | done |
| M1 | Worker HTTP API (39 endpoints, contract v1 frozen), full dashboard UI (11 views: Home, New Game wizard, Blueprint, Asset Forge/Lab, Level Studio, Game Settings, Playtest, Validation, Export, Settings), openai-compat provider | done |
| M2 | Endless-runner template (playable, tested, smoke-green) + full worker support (schema, validate, assemble, export, CLI), backup/restore (worker + CLI + UI), audio import (worker + CLI) | partial — no audio UI view yet; no auto-stage/preview wiring; Level Studio config editor still shooter-only |
| M3 | Side-scroller, battle 2D templates, Godot exporter | planned |
| M4 | Farming template, polish, packaging | partial — binary/installer v0.1.0 done; farming template pending |

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

## Binary release (v0.1.0)

- Installer + portable exe: `apps/desktop/dist-release/` (git-ignored,
  regenerable) — `Kawalight Game Studio Maker_0.1.0_x64-setup.exe` (~20 MB)
  and `kawalight-studio-maker.exe` + `kgsm-worker-*.exe` sidecar.
- First run: dashboard opens in an app window; the worker sidecar
  auto-starts on `127.0.0.1:4317`. API keys stay local (Settings view).
- Rebuild/runbook/troubleshooting: [docs/RELEASE.md](docs/RELEASE.md).
- Known binary limitation: Playtest needs a staged game served over HTTP —
  use a dev checkout or an exported build for playtests (M2: worker-hosted
  preview endpoint).
