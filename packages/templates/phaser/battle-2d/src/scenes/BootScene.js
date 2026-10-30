// Boot: loads sprite assets + builds the shared arena-floor texture.

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
    // Arena floor tile: dark stone with a subtle grid and rivets.
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x141a2e, 1);
    g.fillRect(0, 0, 256, 256);
    g.fillStyle(0x1f2742, 1);
    for (let i = 0; i <= 256; i += 32) {
      g.fillRect(i, 0, 1, 256);
      g.fillRect(0, i, 256, 1);
    }
    g.fillStyle(0x2b3763, 1);
    for (let y = 16; y < 256; y += 32) {
      for (let x = 16; x < 256; x += 32) {
        g.fillRect(x, y, 2, 2);
      }
    }
    g.generateTexture('arena-floor', 256, 256);
    g.destroy();

    const { startScene } = this.game.registry.get('kgsm');
    this.scene.start(startScene === 'game' ? 'game' : 'title');
  }
}
