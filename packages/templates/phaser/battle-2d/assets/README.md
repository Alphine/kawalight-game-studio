# Starter assets

Geometric placeholder sprites. These PNGs are canonical binaries: the
throwaway generator script was deleted after use, so they cannot be
regenerated. Their bytes are pinned by `tools/assets.test.mjs` (update the
hashes there if you intentionally replace a sprite). They exist so the
template runs on first load; replace them with Asset Forge generations or
imports before any serious playtest.

Keys (see `config.demo.json` → `assets.sprites`):

- `player.png`, `shot.png`, `foe-shot.png`, `pickup.png`
- `enemy-grunt.png`, `enemy-skitter.png`, `enemy-stinger.png`
