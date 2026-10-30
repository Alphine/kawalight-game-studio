// Generates deterministic farming starter sprites (pure node, no deps).
// Minimal PNG encoder: RGBA buffer + zlib (node built-in) + CRC32.
// Usage: node tools/gen-assets.mjs  (run from packages/templates/phaser/farming)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

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
