# Sprite assets

Generated with the Meta image provider (`muse-image-1.0`) from the prompts in
`example/prompts.json`, then processed: the opaque studio background is keyed out
to transparency (flood fill from the image border) so sprites sit cleanly on the
parallax layers.

Keys (see `config.demo.json` → `assets.sprites`):

- `player.png` (72x96 source, drawn at the player hitbox 36x48)
- `coin.png` (40x40 source, drawn at 24x24)
- `obstacle-spike.png` (60x80), `obstacle-block.png` (72x112),
  `obstacle-drone.png` (80x52)

Sources are drawn at the config's hitbox size each frame (`setDisplaySize`), so
the art follows the assembled config even when obstacle sizes differ from the demo.
