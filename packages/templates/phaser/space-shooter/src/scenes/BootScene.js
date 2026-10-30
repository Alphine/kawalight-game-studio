// Boot: loads sprite assets + builds the shared starfield texture.

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
    // Shared starfield texture (no asset file needed).
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x05070f, 1);
    g.fillRect(0, 0, 256, 256);
    let s = 1234567;
    const rand = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 90; i++) {
      const b = 90 + Math.floor(rand() * 165);
      g.fillStyle((b << 16) | (b << 8) | b, 1);
      g.fillRect(Math.floor(rand() * 256), Math.floor(rand() * 256),
        rand() < 0.12 ? 2 : 1, 1);
    }
    g.generateTexture('starfield', 256, 256);
    g.destroy();

    const { startScene } = this.game.registry.get('kgsm');
    this.scene.start(startScene === 'game' ? 'game' : 'title');
  }
}
