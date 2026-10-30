// Boot: loads sprite assets + builds the shared parallax textures
// (clouds, hills, ground) so the template needs no extra asset files.

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
    let s = 987654321;
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

    // Hills: dark rooftop silhouette with lit windows.
    const h = this.make.graphics({ x: 0, y: 0 }, false);
    h.fillStyle(0x131a30, 1);
    let x = 0;
    let n = 0;
    while (x < 256) {
      const w = 34 + ((n * 37) % 30);
      const bh = 34 + ((n * 53) % 38);
      h.fillRect(x, 80 - bh, w, bh);
      h.fillStyle(0xffd479, 0.8);
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

    // Ground: rooftop slab with a neon edge and rivets.
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x1b2340, 1);
    g.fillRect(0, 0, 128, 40);
    g.fillStyle(0x2b3763, 1);
    g.fillRect(0, 0, 128, 6);
    g.fillStyle(0x40e0ff, 1);
    g.fillRect(0, 6, 128, 2);
    g.fillStyle(0x11162b, 1);
    for (let rx = 8; rx < 128; rx += 24) g.fillRect(rx, 16, 4, 4);
    g.generateTexture('ground', 128, 40);
    g.destroy();

    const { startScene } = this.game.registry.get('kgsm');
    this.scene.start(startScene === 'game' ? 'game' : 'title');
  }
}
