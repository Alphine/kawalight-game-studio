// Boot: loads the generated sprite art + builds the shared procedural textures
// (sky haze, far ridges, mid hills, mossy brick, one-way plank) so terrain and
// parallax need no extra asset files. Every texture uses the same four-hue
// palette as the generated sprites: night navy, stone violet, deep moss, and
// warm amber. Light comes from the upper left everywhere.

export const PALETTE = {
  navy: 0x0d1626,
  deep: 0x1c2b3a,
  violet: 0x4a3b5c,
  violetDark: 0x352a45,
  violetLight: 0x6d5c85,
  moss: 0x5fd08a,
  mossDark: 0x3fa065,
  pine: 0x2e4a3f,
  amber: 0xffd479,
};

function rng(seedValue) {
  let s = seedValue >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    const { config } = this.game.registry.get('kgsm');
    for (const [key, file] of Object.entries(config.assets.sprites)) {
      this.load.image(key, file);
    }
  }

  create() {
    this.makeClouds();
    this.makeRidge();
    this.makeHills();
    this.makeBrick();
    this.makePlank();

    const { startScene } = this.game.registry.get('kgsm');
    this.scene.start(startScene === 'game' ? 'game' : 'title');
  }

  // Sky haze: soft violet puffs on a transparent tile (parallax layer 1).
  makeClouds() {
    const c = this.make.graphics({ x: 0, y: 0 }, false);
    const rand = rng(135791357);
    c.fillStyle(PALETTE.violetLight, 0.45);
    for (let i = 0; i < 7; i++) {
      const x = 20 + rand() * 216;
      const y = 20 + rand() * 88;
      c.fillEllipse(x, y, 46 + rand() * 40, 14 + rand() * 10);
      c.fillEllipse(x + 14, y - 8, 30 + rand() * 22, 12 + rand() * 8);
    }
    c.generateTexture('clouds', 256, 128);
    c.destroy();
  }

  // Far ridge: two stacked silhouettes with a lit rim (parallax layer 2).
  makeRidge() {
    const W = 512;
    const H = 150;
    const r = this.make.graphics({ x: 0, y: 0 }, false);
    const profile = (x, amp, freq, phase) =>
      amp * Math.abs(Math.sin(x * freq + phase) + 0.45 * Math.sin(x * freq * 2.7 + phase * 1.3));
    r.fillStyle(PALETTE.deep, 1);
    for (let x = 0; x < W; x += 2) {
      const peak = 36 + profile(x, 44, 0.021, 0.7);
      r.fillRect(x, H - peak, 2, peak);
    }
    r.fillStyle(PALETTE.violet, 0.9);
    for (let x = 0; x < W; x += 2) {
      const peak = 16 + profile(x, 34, 0.034, 2.1);
      r.fillRect(x, H - peak, 2, peak);
    }
    r.fillStyle(PALETTE.violetLight, 0.6);
    for (let x = 0; x < W; x += 2) {
      const peak = 16 + profile(x, 34, 0.034, 2.1);
      r.fillRect(x, H - peak, 2, 2);
    }
    r.generateTexture('ridge', W, H);
    r.destroy();
  }

  // Mid hills: moss-capped cliff silhouette with pine ticks (parallax layer 3).
  makeHills() {
    const h = this.make.graphics({ x: 0, y: 0 }, false);
    h.fillStyle(PALETTE.pine, 1);
    for (let x = 0; x < 256; x += 4) {
      const peak = 30 + 26 * Math.abs(Math.sin(x * 0.05) + 0.5 * Math.sin(x * 0.13));
      h.fillRect(x, 120 - peak, 4, peak);
    }
    h.fillStyle(PALETTE.mossDark, 1);
    for (let x = 0; x < 256; x += 4) {
      const peak = 30 + 26 * Math.abs(Math.sin(x * 0.05) + 0.5 * Math.sin(x * 0.13));
      h.fillRect(x, 120 - peak, 4, 3);
    }
    h.fillStyle(PALETTE.moss, 1);
    for (let x = 6; x < 256; x += 18) {
      const peak = 26 + 20 * Math.abs(Math.sin(x * 0.05) + 0.5 * Math.sin(x * 0.13));
      h.fillTriangle(x, 120 - peak - 10, x + 6, 120 - peak - 10, x + 3, 120 - peak - 20);
      h.fillRect(x + 2, 120 - peak - 10, 2, 8);
    }
    h.generateTexture('hills', 256, 120);
    h.destroy();
  }

  // Mossy stone brick: lit top bevel, shaded seams, moss cap (platform fill).
  makeBrick() {
    const b = this.make.graphics({ x: 0, y: 0 }, false);
    b.fillStyle(PALETTE.violet, 1);
    b.fillRect(0, 0, 64, 64);
    b.fillStyle(PALETTE.violetLight, 0.55);
    b.fillRect(0, 9, 64, 1);
    b.fillStyle(PALETTE.violetDark, 1);
    for (let ry = 12; ry < 64; ry += 12) {
      b.fillRect(0, ry, 64, 2);
      for (let rx = (ry % 24 === 0 ? 16 : 0); rx < 64; rx += 32) {
        b.fillRect(rx, ry, 2, 12);
      }
    }
    b.fillStyle(PALETTE.deep, 0.5);
    b.fillRect(0, 60, 64, 4);
    b.fillStyle(PALETTE.moss, 1);
    b.fillRect(0, 0, 64, 8);
    b.fillStyle(PALETTE.mossDark, 1);
    for (let x = 0; x < 64; x += 8) b.fillRect(x + 2, 8, 3, 5);
    b.generateTexture('brick', 64, 64);
    b.destroy();
  }

  // One-way plank: warm timber with an amber-lit top edge.
  makePlank() {
    const o = this.make.graphics({ x: 0, y: 0 }, false);
    o.fillStyle(0x8a5a2e, 1);
    o.fillRect(0, 0, 64, 20);
    o.fillStyle(PALETTE.amber, 0.9);
    o.fillRect(0, 0, 64, 3);
    o.fillStyle(0xa9743f, 1);
    o.fillRect(0, 3, 64, 2);
    o.fillStyle(0x5e3a1c, 1);
    for (let x = 4; x < 64; x += 16) o.fillRect(x, 8, 2, 10);
    o.fillStyle(PALETTE.deep, 0.6);
    o.fillRect(0, 18, 64, 2);
    o.generateTexture('oneway', 64, 20);
    o.destroy();
  }
}
