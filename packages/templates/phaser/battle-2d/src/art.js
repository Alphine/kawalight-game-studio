// Art helpers shared by the scenes: on-screen sizes for generated sprites and
// the procedurally drawn arena backdrop (floor tile + vignette).
// Palette (shared with the generated sprites): deep navy ink #141a2e,
// cobalt blue #3d6fd6, amber gold #ffb347, crimson red #d9434f, ivory #f4f1e8.

// Target on-screen size in pixels (longest side) per sprite key.
export const DISPLAY_PX = {
  player: 52,
  'enemy-grunt': 58,
  'enemy-skitter': 44,
  'enemy-stinger': 56,
  pickup: 30,
  shot: 22,
  'foe-shot': 22,
};

// Scale a Phaser image so its longest side renders at `px` pixels.
export function scaleFor(img, px) {
  const longest = Math.max(img.width, img.height) || 1;
  return px / longest;
}

// Fit an image to its target display size for `key` (falls back to 48px).
export function fitImage(img, key, multiplier = 1) {
  img.setScale(scaleFor(img, (DISPLAY_PX[key] ?? 48) * multiplier));
  return img;
}

// Deterministic 32-bit PRNG so the floor texture is identical on every boot.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 256px seamless floor tile: navy stone slabs with bevelled edges, corner
// rivets and sparse speckles. Lit from the top-left, matching the sprites.
export function buildFloorTexture(scene) {
  const size = 256;
  const slab = 64;
  const rand = rng(7);
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const shades = [0x151c33, 0x131a2f, 0x171f38, 0x121829];
  for (let sy = 0; sy < size; sy += slab) {
    for (let sx = 0; sx < size; sx += slab) {
      const base = shades[Math.floor(rand() * shades.length)];
      g.fillStyle(base, 1);
      g.fillRect(sx, sy, slab, slab);
      // Bevel: light top/left, dark bottom/right.
      g.fillStyle(0x2a3561, 0.9);
      g.fillRect(sx, sy, slab, 1);
      g.fillRect(sx, sy, 1, slab);
      g.fillStyle(0x0b0f1d, 0.95);
      g.fillRect(sx, sy + slab - 1, slab, 1);
      g.fillRect(sx + slab - 1, sy, 1, slab);
      // Rivets in the four slab corners.
      for (const [rx, ry] of [[6, 6], [slab - 7, 6], [6, slab - 7], [slab - 7, slab - 7]]) {
        g.fillStyle(0x0b0f1d, 1);
        g.fillCircle(sx + rx + 1, sy + ry + 1, 2);
        g.fillStyle(0x3d4d85, 1);
        g.fillCircle(sx + rx, sy + ry, 2);
      }
    }
  }
  // Speckle grain.
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    g.fillStyle(rand() > 0.5 ? 0x1f2a4d : 0x0e1322, 0.7);
    g.fillRect(x, y, 1, 1);
  }
  g.generateTexture('arena-floor', size, size);
  g.destroy();
}

// Full-arena vignette: transparent centre, dark navy edges. Drawn over the
// floor and under the actors to give the arena depth.
export function buildVignetteTexture(scene, width, height) {
  const tex = scene.textures.createCanvas('arena-vignette', width, height);
  const ctx = tex.getContext();
  const cx = width / 2;
  const cy = height / 2;
  const grad = ctx.createRadialGradient(cx, cy, Math.min(width, height) * 0.36,
    cx, cy, Math.max(width, height) * 0.7);
  grad.addColorStop(0, 'rgba(5, 7, 15, 0)');
  grad.addColorStop(1, 'rgba(5, 7, 15, 0.82)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  tex.refresh();
}
