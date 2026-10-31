// Generates deterministic endless-runner starter sprites (pure node, no deps).
// PNG encoder/canvas shared via tools/png.mjs (zlib + CRC32, no deps).
// Sprite sizes match the logical hitboxes in config.demo.json exactly.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvas, encodePng } from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'endless-runner', 'assets');

const WHITE = [240, 244, 255];
const CYAN = [64, 224, 255];
const DARK = [24, 30, 54];
const YELLOW = [255, 220, 80];
const GOLD = [255, 190, 60];
const RED = [255, 90, 90];
const STEEL = [150, 165, 200];
const ORANGE = [255, 160, 60];

// Hooded rooftop runner, mid-stride (36x48).
function player() {
  const c = canvas(36, 48);
  c.disc(18, 9, 7, CYAN); // hood
  c.disc(20, 9, 4, DARK); // face opening
  c.rect(21, 8, 23, 10, WHITE); // eye
  c.rect(13, 16, 23, 30, CYAN); // torso
  c.rect(13, 16, 15, 30, [30, 140, 180]); // shade
  c.rect(24, 18, 30, 22, CYAN); // fwd arm
  c.rect(6, 20, 12, 24, CYAN); // back arm
  c.rect(20, 31, 26, 46, DARK); // fwd leg
  c.rect(20, 44, 28, 47, WHITE); // shoe
  c.rect(10, 31, 16, 42, DARK); // back leg
  c.rect(4, 40, 10, 43, WHITE); // shoe
  return c;
}

// Triple floor spikes on a base plate (30x40).
function spike() {
  const c = canvas(30, 40);
  c.rect(0, 34, 29, 39, DARK);
  c.rect(0, 34, 29, 35, STEEL);
  for (const cx of [5, 15, 25]) {
    for (let i = 0; i < 30; i++) {
      const half = Math.max(0, Math.floor((30 - i) / 6));
      c.rect(cx - half, 4 + i, cx + half, 4 + i, STEEL);
    }
    c.rect(cx, 4, cx, 33, WHITE);
  }
  return c;
}

// Tech crate with hazard chevrons (36x56).
function block() {
  const c = canvas(36, 56);
  c.rect(0, 0, 35, 55, [58, 44, 90]);
  c.rect(0, 0, 35, 3, [90, 70, 140]);
  c.rect(0, 52, 35, 55, DARK);
  c.rect(2, 6, 33, 30, [40, 30, 66]);
  for (let i = 0; i < 8; i++) { // chevrons
    c.rect(4 + i * 4, 36 + (i % 2) * 4, 7 + i * 4, 39 + (i % 2) * 4, YELLOW);
  }
  c.rect(4, 46, 31, 49, ORANGE);
  c.rect(14, 12, 21, 24, RED); // warning light
  c.rect(15, 13, 17, 15, WHITE);
  return c;
}

// Hovering patrol drone (40x26).
function drone() {
  const c = canvas(40, 26);
  c.rect(2, 4, 12, 6, STEEL); // left rotor
  c.rect(28, 4, 38, 6, STEEL); // right rotor
  c.rect(6, 7, 8, 11, DARK);
  c.rect(32, 7, 34, 11, DARK);
  c.rect(8, 11, 32, 22, [70, 80, 120]); // hull
  c.rect(8, 11, 32, 13, [110, 125, 170]);
  c.disc(20, 17, 5, RED); // eye
  c.rect(18, 15, 21, 18, WHITE);
  c.rect(16, 23, 24, 25, CYAN); // thruster glow
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

mkdirSync(root, { recursive: true });
for (const [name, c] of [
  ['player.png', player()],
  ['obstacle-spike.png', spike()],
  ['obstacle-block.png', block()],
  ['obstacle-drone.png', drone()],
  ['coin.png', coin()],
]) {
  writeFileSync(join(root, name), encodePng(c.w, c.h, c.px));
  console.log(`wrote ${name}`);
}
