# Starter assets

Geometric placeholder sprites generated deterministically by
`tools/gen-assets.mjs` (or the worker mock provider). They exist so the
template runs on first load; replace them with Asset Forge generations or
imports before any serious playtest.

Keys (see `config.demo.json` → `assets.sprites`):

- `soil.png` (96x96)
- `crop-turnip.png` (64x64), `crop-pumpkin.png` (64x64)
- `coin.png` (20x20), `farmer.png` (36x48)

The soil sprite matches the demo `plotSize` exactly; the scenes scale crop
sprites by growth stage.
