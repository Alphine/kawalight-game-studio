// Generates deterministic farming starter sprites (pure node, no deps).
// PNG encoder/canvas shared via tools/png.mjs (zlib + CRC32, no deps).
// Usage: node tools/gen-assets.mjs  (run from packages/templates/phaser/farming)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvas, encodePng } from '../../tools/png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

const WHITE = [240, 244, 255];
const SOIL = [138, 90, 51];
const SOIL_D = [110, 70, 38];
const SOIL_L = [165, 115, 70];
const LEAF = [74, 160, 70];
const LEAF_D = [46, 120, 48];
const PURPLE = [170, 110, 200];
const ORANGE = [255, 150, 40];
const ORANGE_D = [210, 110, 25];
const YELLOW = [255, 220, 80];
const GOLD = [255, 190, 60];
const DENIM = [60, 90, 160];
const SKIN = [240, 200, 150];
const STRAW = [230, 200, 120];

// Tilled soil tile with furrows (96x96, matches demo plotSize).
function soil() {
  const c = canvas(96, 96);
  c.rect(0, 0, 95, 95, SOIL);
  c.rect(0, 0, 95, 3, SOIL_L);
  c.rect(0, 92, 95, 95, SOIL_D);
  for (let r = 0; r < 6; r++) {
    const y = 8 + r * 14;
    c.rect(6, y, 89, y + 7, SOIL_D);
    c.rect(6, y, 89, y + 2, SOIL_L);
  }
  let s = 12345; // deterministic pebbles
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    return ((s ^ (s >>> 13)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 24; i++) {
    c.set(4 + Math.floor(rand() * 88), 6 + Math.floor(rand() * 84), SOIL_L);
  }
  return c;
}

// Turnip: white root, purple shoulders, leafy top (64x64).
function turnip() {
  const c = canvas(64, 64);
  c.rect(26, 4, 30, 26, LEAF_D); // stems
  c.rect(34, 4, 38, 26, LEAF_D);
  c.disc(20, 10, 8, LEAF);
  c.disc(32, 6, 9, LEAF);
  c.disc(44, 10, 8, LEAF);
  c.disc(32, 40, 16, WHITE); // root
  c.rect(16, 26, 47, 34, PURPLE); // shoulders
  c.rect(28, 44, 36, 62, WHITE); // taper
  c.rect(30, 54, 34, 63, [210, 215, 230]);
  c.rect(24, 30, 27, 33, [200, 150, 220]); // shine
  return c;
}

// Pumpkin: ribbed orange squash with stem (64x64).
function pumpkin() {
  const c = canvas(64, 64);
  c.rect(29, 2, 35, 14, LEAF_D); // stem
  c.disc(22, 12, 6, LEAF);
  c.disc(32, 36, 24, ORANGE);
  c.rect(8, 36, 55, 58, ORANGE);
  c.disc(32, 36, 24, ORANGE);
  for (const x of [16, 26, 38, 48]) c.rect(x, 14, x + 2, 58, ORANGE_D); // ribs
  c.rect(20, 20, 24, 30, [255, 200, 130]); // shine
  c.rect(8, 56, 55, 60, ORANGE_D);
  return c;
}

// Gold coin with shine (20x20).
function coin() {
  const c = canvas(20, 20);
  c.disc(10, 10, 9, GOLD);
  c.disc(10, 10, 6, YELLOW);
  c.rect(7, 5, 9, 8, WHITE);
  c.rect(8, 12, 12, 13, GOLD);
  return c;
}

// Straw-hat farmer (36x48).
function farmer() {
  const c = canvas(36, 48);
  c.rect(4, 6, 32, 12, STRAW); // hat brim
  c.rect(10, 0, 26, 8, STRAW); // hat crown
  c.rect(10, 6, 26, 8, [200, 170, 100]);
  c.rect(13, 13, 23, 20, SKIN); // face
  c.rect(15, 15, 17, 17, [30, 30, 40]); // eyes
  c.rect(20, 15, 22, 17, [30, 30, 40]);
  c.rect(12, 21, 24, 32, DENIM); // overalls
  c.rect(16, 21, 20, 32, [45, 70, 130]);
  c.rect(5, 22, 11, 30, SKIN); // arms
  c.rect(25, 22, 31, 30, SKIN);
  c.rect(13, 33, 17, 46, DENIM); // legs
  c.rect(19, 33, 23, 46, DENIM);
  c.rect(11, 44, 17, 47, [90, 60, 40]); // boots
  c.rect(19, 44, 25, 47, [90, 60, 40]);
  return c;
}

mkdirSync(root, { recursive: true });
for (const [name, c] of [
  ['soil.png', soil()],
  ['crop-turnip.png', turnip()],
  ['crop-pumpkin.png', pumpkin()],
  ['coin.png', coin()],
  ['farmer.png', farmer()],
]) {
  writeFileSync(join(root, name), encodePng(c.w, c.h, c.px));
  console.log(`wrote ${name}`);
}
