# Architecture

```text
Browser (studio UI, vanilla JS)  ──►  Worker (Python, stdlib HTTP)  ──►  Providers (Muse, Llama, mock)
        │                                   │
        │  playtest iframe                  ├── projects + SQLite (db.py)
        ▼                                   ├── assets, audio, costs, backups
   staged Phaser game  ◄── served by ───────┤── exporters (ZIP, Godot)
                                            └── validation against packages/schemas
```

## Parts

- **Worker** (`apps/worker/src/kgsm/`): the local API. Routes are split by area
  under `api/routes_*.py`. Config is validated before it reaches the runtime.
- **Studio UI** (`apps/desktop/ui/`): one view per module (`views-*.js`), talking
  to the worker through `js/api.js`.
- **Templates** (`packages/templates/phaser/`): one folder per genre with shared
  runtime services.
- **Landing page** (`apps/web/landing/`): the public site at `basyid.dev/kgsm`.
- **Live server:** the worker runs as a systemd service behind nginx.

## Principles

- Config is data, validated against JSON Schema (NFR-009).
- Paid generation needs confirmation and respects spend limits (FR-009, FR-022).
- A provider failure never corrupts a project or its last good build (NFR-003).
- The same template, config, runtime, and seed give the same behavior (NFR-004).

The full API contract is in [docs/api-contract.md](../docs/api-contract.md).
