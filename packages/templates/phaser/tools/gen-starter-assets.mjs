// Generates deterministic starter placeholder sprites (pure node, no deps).
// PNG encoder/canvas shared via tools/png.mjs (zlib + CRC32, no deps).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvas, encodePng } from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'space-shooter', 'assets');

const WHITE = [240, 244, 255];
const CYAN = [64, 224, 255];
const YELLOW = [255, 220, 80];
const GREEN = [120, 255, 140];
const MAGENTA = [255, 90, 220];
const ORANGE = [255, 160, 60];
const RED = [255, 90, 90];

function ship() {
  const c = canvas(32, 32);
  for (let i = 0; i < 12; i++) c.rect(20 - i, 14 - i, 20 - i, 18 + i, CYAN);
  c.rect(6, 13, 12, 19, WHITE);
  c.rect(12, 6, 15, 11, CYAN);
  c.rect(12, 21, 15, 26, CYAN);
  c.rect(4, 15, 6, 17, YELLOW);
  return c;
}

function bolt() {
  const c = canvas(16, 8);
  c.rect(2, 3, 13, 4, YELLOW);
  c.rect(11, 1, 13, 6, WHITE);
  return c;
}

function pickup() {
  const c = canvas(16, 16);
  c.rect(6, 2, 9, 13, GREEN);
  c.rect(2, 6, 13, 9, GREEN);
  c.rect(6, 6, 9, 9, WHITE);
  return c;
}

function drone() {
  const c = canvas(32, 32);
  c.disc(16, 16, 10, MAGENTA);
  c.disc(16, 16, 5, [120, 20, 100]);
  c.rect(14, 14, 17, 17, WHITE);
  return c;
}

function weaver() {
  const c = canvas(32, 32);
  for (let i = 0; i <= 10; i++) c.rect(16 - i, 6 + i, 16 + i, 6 + i, ORANGE);
  for (let i = 0; i <= 10; i++) c.rect(16 - i + 10, 16 + i, 16 + i - 10, 16 + i, ORANGE);
  c.rect(14, 14, 17, 17, WHITE);
  return c;
}

function diver() {
  const c = canvas(32, 32);
  for (let i = 0; i < 14; i++) c.rect(4 + i, 12 - i, 4 + i, 20 + i, RED);
  c.rect(16, 12, 24, 20, [150, 30, 30]);
  c.rect(18, 14, 21, 18, WHITE);
  return c;
}

mkdirSync(root, { recursive: true });
for (const [name, c] of [
  ['player.png', ship()],
  ['shot.png', bolt()],
  ['pickup.png', pickup()],
  ['enemy-drone.png', drone()],
  ['enemy-weaver.png', weaver()],
  ['enemy-diver.png', diver()],
]) {
  writeFileSync(join(root, name), encodePng(c.w, c.h, c.px));
  console.log(`wrote ${name}`);
}
