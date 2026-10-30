# Endless-runner template (SDD §3.2)

Playable auto-scrolling runner driven 100% by `config.demo.json`. Same
layout the exporter stages, so preview == export. Mirrors the space-shooter
architecture: pure `src/logic.js` simulation + thin Phaser scenes + in-page
autotest marker.

## Run

```powershell
# one-time: vendor Phaser locally (else the page falls back to CDN)
cd packages/templates/phaser
npm install
npm run vendor

# stage + serve the demo (mirrors worker stage_export layout)
node tools/stage-demo.mjs endless-runner
npx --yes http-server dist-endless-runner -p 8766
# open http://127.0.0.1:8766
```

Query flags: `?seed=7` overrides the config seed, `?debug=1` shows the debug
line, `?autotest=1` runs the scripted logic self-check and writes PASS/FAIL
into `#kgsm-autotest`.

## Layout

- `src/logic.js` — pure simulation, no Phaser imports. Unit-tested with node.
  Exports `suggestInput` (autopilot shared by the demo and the autotest).
- `src/scenes/*` — thin Phaser views over the simulation.
- `src/main.js` — Phaser boot + autotest hook.
- `demo/` — `index.html` + `style.css` (export entry).
- `assets/` — starter placeholders; replace via Asset Forge.
- `test/` — `node --test test/`.

## Controls

Space/W/Up jump, S/Down slide, P/Esc pause. All remappable via config
`controls` (keys: SPACE, S, P, ...).

## Tuning notes

Fairness invariant: max jump reach (`2 * jumpVelocity / gravity * maxSpeed`)
plus rise room must stay under `spawning.minGapPx`, otherwise consecutive
patterns can form an unjumpable landing trap. The demo config keeps ~25px of
margin at max speed; the autopilot asserts nothing but the smoke run would
start dying early if you break it.
