# Sprites

Generated with the Meta image provider (`kgsm.examples farming`). Palette:
moss green, warm straw gold, earth brown and sky aqua; light from the
upper-left; 2px dark-brown outline on sprites. Crop and farmer sprites were
keyed to transparency (flood fill from the border) after generation.

Keys (see `config.demo.json` -> `assets.sprites`):

- `soil.png` (96x96, full-bleed tile)
- `crop-turnip.png`, `crop-pumpkin.png` (128x128, mature plant; scenes scale by growth stage)
- `coin.png` (64x64), `farmer.png` (96x128)

Sprites are shown at their natural aspect ratio; scenes size them from the
texture dimensions, so swapping in other art of the same keys keeps working.
