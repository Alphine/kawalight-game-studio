# Space-shooter template (SDD §3.1)

Playable horizontal shooter driven 100% by `config.demo.json` (schema:
`packages/schemas/space-shooter.config.schema.json`). Same layout the exporter
stages, so preview == export.

## Run

```powershell
# one-time: vendor Phaser locally (else the page falls back to CDN)
cd packages/templates/phaser
npm install
npm run vendor

# stage + serve the demo (mirrors worker stage_export layout)
node tools/stage-demo.mjs
npx --yes http-server dist-space-shooter -p 8765
# open http://127.0.0.1:8765
```

Query flags: `?seed=7` overrides the config seed, `?debug=1` shows the debug
line, `?autotest=1` runs the scripted logic self-check and writes PASS/FAIL
into `#kgsm-autotest`.

## Layout

- `src/logic.js` — pure simulation, no Phaser imports. Unit-tested with node.
- `src/scenes/*` — thin Phaser views over the simulation.
- `src/main.js` — Phaser boot + autotest hook.
- `demo/` — `index.html` + `style.css` (export entry).
- `assets/` — starter placeholders; replace via Asset Forge.
- `test/` — `node --test test/`.

## Controls

WASD/arrows move, Space/Z fire, P/Esc pause. All remappable via config
`controls` (keys: W, S, A, D, SPACE, P, ...).
