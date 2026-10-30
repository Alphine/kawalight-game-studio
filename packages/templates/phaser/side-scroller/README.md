# Side-scroller template (SDD §3.3)

Playable run-and-jump platformer driven 100% by `config.demo.json`. Same
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
node tools/stage-demo.mjs side-scroller
npx --yes http-server dist-side-scroller -p 8766
# open http://127.0.0.1:8766
```

Query flags: `?seed=7` overrides the config seed, `?debug=1` shows the debug
line, `?autotest=1` runs the scripted logic self-check and writes PASS/FAIL
into `#kgsm-autotest`, `?scene=game&demo-input=1` boots straight into the
autopilot playthrough.

## Layout

- `src/logic.js` — pure simulation, no Phaser imports. Unit-tested with node.
  Exports `suggestInput` (autopilot shared by the demo and the autotest).
- `src/scenes/*` — thin Phaser views over the simulation.
- `src/main.js` — Phaser boot + autotest hook.
- `demo/` — `index.html` + `style.css` (export entry).
- `assets/` — starter placeholders; replace via Asset Forge.
- `test/` — `node --test test/`.

## Controls

Left/Right or A/D move, Space/W/Up jump, P/Esc pause. All remappable via
config `controls` (keys: LEFT, RIGHT, SPACE, P, ...).

## Tuning notes

Fairness invariant: every pit must be narrower than the true jump reach
(`moveSpeed * jumpVelocity / gravity * (1 + 1/sqrt(2))`, about 167px in the
demo config — the descent runs at double gravity once jump is released past
the apex). Keep at least ~25px of margin so the autopilot takeoff window
stays comfortable, and keep threats ~100px clear of pit edges so a threat
hop never has to double as a pit takeoff.
