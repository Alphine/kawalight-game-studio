// Boot: loads sprite assets + builds the shared parallax textures
// (far skyline, clouds, mid rooftops, ground) so the template needs no extra
// asset files. Generated sprites are smoothed when downscaled to hitbox size.

const PALETTE = {
  night: 0x0b1020,
  navy: 0x1b2340,
  navyDeep: 0x11162b,
  steel: 0x2b3763,
  cyan: 0x40e0ff,
  amber: 0xffd479,
};

function makeRand(seed) {
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
    const { config } = this.game.registry.get('kgsm');
    // Generated art is drawn large and downscaled to hitbox size: smooth it.
    for (const key of Object.keys(config.assets.sprites)) {
      const tex = this.textures.get(key);
      if (tex && tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
    }

    this.buildFar();
    this.buildClouds();
    this.buildHills();
    this.buildGround();

    const { startScene } = this.game.registry.get('kgsm');
    this.scene.start(startScene === 'game' ? 'game' : 'title');
  }

  // Far skyline: faint, low-contrast towers for depth (scrolls slowest).
  buildFar() {
    const rand = makeRand(4242);
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    let x = 0;
    while (x < 320) {
      const w = 26 + Math.floor(rand() * 26);
      const bh = 40 + Math.floor(rand() * 60);
      g.fillStyle(0x161d3a, 1);
      g.fillRect(x, 120 - bh, w, bh);
      if (rand() < 0.35) g.fillRect(x + w / 2 - 1, 120 - bh - 10, 2, 10); // antenna
      x += w + 4;
    }
    g.fillStyle(0x161d3a, 1);
    g.generateTexture('far', 320, 120);
    g.destroy();
  }

  // Clouds: soft cyan-tinted haze, transparent tile.
  buildClouds() {
    const rand = makeRand(987654321);
    const c = this.make.graphics({ x: 0, y: 0 }, false);
    c.fillStyle(PALETTE.cyan, 0.12);
    for (let i = 0; i < 7; i++) {
      const x = 20 + rand() * 216;
      const y = 20 + rand() * 88;
      c.fillEllipse(x, y, 46 + rand() * 40, 14 + rand() * 10);
      c.fillEllipse(x + 14, y - 8, 30 + rand() * 22, 12 + rand() * 8);
    }
    c.generateTexture('clouds', 256, 128);
    c.destroy();
  }

  // Mid rooftops: dark silhouette with lit amber windows.
  buildHills() {
    const h = this.make.graphics({ x: 0, y: 0 }, false);
    h.fillStyle(0x131a30, 1);
    let x = 0;
    let n = 0;
    while (x < 256) {
      const w = 34 + ((n * 37) % 30);
      const bh = 34 + ((n * 53) % 38);
      h.fillRect(x, 80 - bh, w, bh);
      h.fillStyle(PALETTE.amber, 0.8);
      for (let wy = 80 - bh + 6; wy < 74; wy += 10) {
        for (let wx = x + 5; wx < x + w - 5; wx += 10) {
          if ((wx + wy + n) % 3 === 0) h.fillRect(wx, wy, 3, 4);
        }
      }
      h.fillStyle(0x131a30, 1);
      x += w + 6;
      n++;
    }
    h.generateTexture('hills', 256, 80);
    h.destroy();
  }

  // Ground: rooftop slab with a cyan neon edge and amber rivets.
  buildGround() {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(PALETTE.navy, 1);
    g.fillRect(0, 0, 128, 40);
    g.fillStyle(PALETTE.steel, 1);
    g.fillRect(0, 0, 128, 6);
    g.fillStyle(PALETTE.cyan, 1);
    g.fillRect(0, 6, 128, 2);
    g.fillStyle(PALETTE.navyDeep, 1);
    g.fillRect(0, 12, 128, 2);
    g.fillStyle(PALETTE.amber, 0.7);
    for (let rx = 8; rx < 128; rx += 24) g.fillRect(rx, 18, 4, 4);
    g.generateTexture('ground', 128, 40);
    g.destroy();
  }
}
