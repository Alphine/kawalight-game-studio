# Starter assets

Geometric placeholder sprites generated deterministically by
`tools/gen-runner-assets.mjs` (or the worker mock provider). They exist so the
template runs on first load; replace them with Asset Forge generations or
imports before any serious playtest.

Keys (see `config.demo.json` → `assets.sprites`):

- `player.png` (36x48), `coin.png` (20x20)
- `obstacle-spike.png` (30x40), `obstacle-block.png` (36x56),
  `obstacle-drone.png` (40x26)

Sprite sizes match the logical hitboxes exactly; the scenes render them
unscaled (except the title zoom and the coin shimmer).
