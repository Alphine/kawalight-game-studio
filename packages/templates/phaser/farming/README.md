# Farming template (SDD §3.5)

Playable grid farm driven 100% by `config.demo.json`. Same layout the
exporter stages, so preview == export. Mirrors the endless-runner
architecture: pure `src/logic.js` simulation + thin Phaser scenes + in-page
autotest marker.

## Run

```powershell
# one-time: vendor Phaser locally (else the page falls back to CDN)
cd packages/templates/phaser
npm install
npm run vendor

# stage + serve the demo (mirrors worker stage_export layout)
node tools/stage-demo.mjs farming
npx --yes http-server dist-farming -p 8767
# open http://127.0.0.1:8767
```

Query flags: `?seed=7` overrides the config seed, `?debug=1` shows the debug
line, `?autotest=1` runs the scripted logic self-check and writes PASS/FAIL
into `#kgsm-autotest`, `?scene=game&demo-input=1` boots straight into the
autopilot demo.

## Layout

- `src/logic.js` — pure simulation, no Phaser imports. Unit-tested with node.
  Exports `suggestInput` (autopilot shared by the demo and the autotest).
- `src/scenes/*` — thin Phaser views over the simulation.
- `src/main.js` — Phaser boot + autotest hook.
- `demo/` — `index.html` + `style.css` (export entry).
- `assets/` — generated Meta art, see `assets/README.md`. `tools/gen-assets.mjs` still writes placeholder shapes; do not run it over the real art.
- `test/` — `node --test test/logic.test.js` (on Node 22 a bare directory argument is not accepted).

## Controls

Click a plot to apply the current tool. 1/2/3 select plant/water/harvest,
C cycles the seed, N sleeps to the next day, P/Esc pauses. All remappable
via config `controls`.

## Tuning notes

Loop invariant: every growth stage needs one watering, so a crop takes
`stages` waterings and `stages * stageTimeSec` seconds of watered time.
Morning rain deterministically waters ~25% of thirsty plots (seeded RNG),
so the autopilot and the demo stay in sync. There is no withering: dry
crops stall but never die. Win when banked harvest earnings reach
`scoring.targetCoins`; best run persists locally.
