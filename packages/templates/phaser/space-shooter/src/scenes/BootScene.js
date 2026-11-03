// Boot: loads the generated sprite assets, builds the procedural textures
// (parallax starfield, nebula, glow halo, spark) and starts the first scene.

import { SPARK_KEY, HALO_KEY, STAR_LAYERS, NEBULA_KEY } from './backdrop.js';

function mulberry(seed) {
  let s = seed >>> 0;
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
    this.makeSpark();
    this.makeHalo();
    this.makeStars();
    this.makeNebula();

    const { startScene } = this.game.registry.get('kgsm');
    this.scene.start(startScene === 'game' ? 'game' : 'title');
  }

  makeSpark() {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 0.35);
    g.fillCircle(4, 4, 4);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 2.5);
    g.generateTexture(SPARK_KEY, 8, 8);
    g.destroy();
  }

  makeHalo() {
    // Soft radial glow: concentric discs with rising alpha toward the centre.
    const size = 64;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    for (let r = size / 2; r >= 1; r -= 1) {
      const t = 1 - r / (size / 2);
      g.fillStyle(0xffffff, 0.06 + 0.5 * t * t);
      g.fillCircle(size / 2, size / 2, r);
    }
    g.generateTexture(HALO_KEY, size, size);
    g.destroy();
  }

  makeStars() {
    const rand = mulberry(1234567);
    STAR_LAYERS.forEach((layer) => {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      for (let i = 0; i < layer.count; i++) {
        const x = Math.floor(rand() * layer.size);
        const y = Math.floor(rand() * layer.size);
        const b = layer.min + Math.floor(rand() * (layer.max - layer.min));
        const tint = rand() < 0.2 ? 0x9fd8ff : rand() < 0.1 ? 0xffe2a8 : 0xffffff;
        const alpha = b / 255;
        g.fillStyle(tint, alpha);
        const big = rand() < layer.bigChance;
        g.fillRect(x, y, big ? 2 : 1, big ? 2 : 1);
      }
      g.generateTexture(layer.key, layer.size, layer.size);
      g.destroy();
    });
  }

  makeNebula() {
    // One screen-sized, seamlessly wrapping cloud layer: blobs are repeated
    // on every neighbouring tile so the scrolling tileSprite has no seams.
    const { config } = this.game.registry.get('kgsm');
    const W = config.world.width;
    const H = config.world.height;
    const rand = mulberry(987654);
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const blobs = [
      { x: 0.16, y: 0.30, r: 210, c: 0x3b1d6e, a: 0.12 },
      { x: 0.58, y: 0.18, r: 240, c: 0x12405e, a: 0.11 },
      { x: 0.80, y: 0.74, r: 190, c: 0x5a1d4a, a: 0.09 },
      { x: 0.36, y: 0.82, r: 170, c: 0x0f3a52, a: 0.10 },
    ];
    for (const b of blobs) {
      const bx = b.x * W;
      const by = b.y * H;
      for (const dx of [-W, 0, W]) {
        for (const dy of [-H, 0, H]) {
          for (let k = 8; k >= 1; k--) {
            g.fillStyle(b.c, b.a * (k / 8));
            g.fillCircle(bx + dx + (rand() - 0.5) * 12, by + dy, b.r * (k / 8));
          }
        }
      }
    }
    g.generateTexture(NEBULA_KEY, W, H);
    g.destroy();
  }
}
