# Battle-2d template (top-down arena battler)

Playable arena battler driven 100% by `config.demo.json` (schema:
`packages/schemas/battle-2d.config.schema.json`). Same layout the exporter
stages, so preview == export.

## Run

```powershell
# one-time: vendor Phaser locally (else the page falls back to CDN)
cd packages/templates/phaser
npm install
npm run vendor

# stage + serve the demo (mirrors worker stage_export layout)
node tools/stage-demo.mjs battle-2d
npx --yes http-server dist-battle-2d -p 8765
# open http://127.0.0.1:8765
```

Query flags: `?seed=7` overrides the config seed, `?debug=1` shows the debug
line, `?autotest=1` runs the scripted logic self-check and writes PASS/FAIL
into `#kgsm-autotest`, `?scene=game&demo-input=1` jumps straight into an
autopilot run.

## Layout

- `src/logic.js` — pure simulation, no Phaser imports. Unit-tested with node.
- `src/scenes/*` — thin Phaser views over the simulation.
- `src/main.js` — Phaser boot + autotest hook.
- `demo/` — `index.html` + `style.css` (export entry).
- `assets/gen/` — Meta-generated sprites (keyed to transparency) that `config.demo.json` uses.
- `assets/*.png` — original starter placeholders, pinned by `tools/assets.test.mjs`.
- `src/art.js` — sprite sizing and the procedural arena floor/vignette textures.
- `example/` — the complete example game: `prompts.json` (art direction), `project/`, the playable zip and `manifest.json`.
- `test/` — `node --test test/`.

## Controls

WASD/arrows move, Space/Z fire the auto-aimed bolt, J/X swing the melee spin
slash, P/Esc pause. All remappable via config `controls` (keys: W, S, A, D,
SPACE, J, P, ...).
