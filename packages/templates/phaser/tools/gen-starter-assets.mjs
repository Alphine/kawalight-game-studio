// Generates deterministic starter placeholder sprites (pure node, no deps).
// Minimal PNG encoder: RGBA buffer + zlib (node built-in) + CRC32.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'space-shooter', 'assets');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4)
      .copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function canvas(w, h) {
  return {
    w, h, px: new Uint8ClampedArray(w * h * 4),
    set(x, y, [r, g, b, a = 255]) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      this.px[i] = r; this.px[i + 1] = g; this.px[i + 2] = b; this.px[i + 3] = a;
    },
    rect(x0, y0, x1, y1, c) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
    },
    disc(cx, cy, r, c) {
      for (let y = Math.floor(cy - r); y <= cy + r; y++) {
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, c);
        }
      }
    },
  };
}

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
