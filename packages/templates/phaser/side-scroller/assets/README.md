# Starter assets

Geometric placeholder sprites. These PNGs are canonical binaries: the
throwaway generator script was deleted after use, so they cannot be
regenerated. Their bytes are pinned by `tools/assets.test.mjs` (update the
hashes there if you intentionally replace a sprite). They exist so the
template runs on first load; replace them with Asset Forge generations or
imports before any serious playtest.

Keys (see `config.demo.json` → `assets.sprites`):

- `player.png` (32x44), `coin.png` (20x20)
- `walker.png` (36x28), `spikes.png` (32x24)
- `exit-door.png` (48x80), `checkpoint.png` (24x48)

Sprite sizes match the logical hitboxes exactly; the scenes render them
unscaled (except the title zoom and the coin shimmer). Terrain (brick,
one-way plank, hills, clouds) is generated procedurally in BootScene.
