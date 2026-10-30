// Boot: loads sprite assets + builds the shared procedural textures
// (clouds, hills, brick, one-way plank) so the template needs no extra
// asset files for terrain and parallax.

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
    // Clouds: transparent tile with soft blobs.
    const c = this.make.graphics({ x: 0, y: 0 }, false);
    let s = 135791357;
    const rand = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    c.fillStyle(0x8fa3d8, 0.5);
    for (let i = 0; i < 7; i++) {
      const x = 20 + rand() * 216;
      const y = 20 + rand() * 88;
      c.fillEllipse(x, y, 46 + rand() * 40, 14 + rand() * 10);
      c.fillEllipse(x + 14, y - 8, 30 + rand() * 22, 12 + rand() * 8);
    }
    c.generateTexture('clouds', 256, 128);
    c.destroy();

    // Hills: layered cliff silhouette with pine ticks.
    const h = this.make.graphics({ x: 0, y: 0 }, false);
    h.fillStyle(0x1c2b3a, 1);
    for (let x = 0; x < 256; x += 4) {
      const peak = 30 + 26 * Math.abs(Math.sin(x * 0.05) + 0.5 * Math.sin(x * 0.13));
      h.fillRect(x, 120 - peak, 4, peak);
    }
    h.fillStyle(0x2e4a3f, 1);
    for (let x = 6; x < 256; x += 18) {
      const peak = 26 + 20 * Math.abs(Math.sin(x * 0.05) + 0.5 * Math.sin(x * 0.13));
      h.fillTriangle(x, 120 - peak - 10, x + 6, 120 - peak - 10, x + 3, 120 - peak - 20);
      h.fillRect(x + 2, 120 - peak - 10, 2, 8);
    }
    h.generateTexture('hills', 256, 120);
    h.destroy();

    // Brick: mossy cliff block with a grass cap (tiles across platforms).
    const b = this.make.graphics({ x: 0, y: 0 }, false);
    b.fillStyle(0x4a3b5c, 1);
    b.fillRect(0, 0, 64, 64);
    b.fillStyle(0x3a2d49, 1);
    for (let ry = 12; ry < 64; ry += 12) {
      b.fillRect(0, ry, 64, 2);
      for (let rx = (ry % 24 === 0 ? 16 : 0); rx < 64; rx += 32) {
        b.fillRect(rx, ry, 2, 12);
      }
    }
    b.fillStyle(0x5fd08a, 1);
    b.fillRect(0, 0, 64, 8);
    b.fillStyle(0x3fa065, 1);
    for (let x = 0; x < 64; x += 8) b.fillRect(x + 2, 8, 3, 5);
    b.generateTexture('brick', 64, 64);
    b.destroy();

    // One-way plank: floating timber platform top.
    const o = this.make.graphics({ x: 0, y: 0 }, false);
    o.fillStyle(0x8a5a2e, 1);
    o.fillRect(0, 0, 64, 20);
    o.fillStyle(0xa9743f, 1);
    o.fillRect(0, 0, 64, 5);
    o.fillStyle(0x5e3a1c, 1);
    for (let x = 4; x < 64; x += 16) o.fillRect(x, 8, 2, 10);
    o.generateTexture('oneway', 64, 20);
    o.destroy();

    const { startScene } = this.game.registry.get('kgsm');
    this.scene.start(startScene === 'game' ? 'game' : 'title');
  }
}
