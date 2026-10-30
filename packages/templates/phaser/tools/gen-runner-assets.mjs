// Generates deterministic endless-runner starter sprites (pure node, no deps).
// Minimal PNG encoder: RGBA buffer + zlib (node built-in) + CRC32.
// Sprite sizes match the logical hitboxes in config.demo.json exactly.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'endless-runner', 'assets');

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
