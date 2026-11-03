// Boot: loads gem sprites and builds the small helper textures (tile plate,
// selection ring, hint glow) so the template needs no extra asset files.

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
    const plate = this.make.graphics({ x: 0, y: 0 }, false);
    plate.fillStyle(0x1b2547, 1);
    plate.fillRoundedRect(0, 0, 64, 64, 10);
    plate.fillStyle(0x243262, 1);
    plate.fillRoundedRect(3, 3, 58, 30, 8);
    plate.generateTexture('plate', 64, 64);
    plate.destroy();

    const ring = this.make.graphics({ x: 0, y: 0 }, false);
    ring.lineStyle(4, 0xffd479, 1);
    ring.strokeRoundedRect(2, 2, 60, 60, 12);
    ring.generateTexture('ring', 64, 64);
    ring.destroy();

    const glow = this.make.graphics({ x: 0, y: 0 }, false);
    glow.fillStyle(0xffffff, 1);
    glow.fillCircle(16, 16, 16);
    glow.generateTexture('glow', 32, 32);
    glow.destroy();

    const { startScene } = this.game.registry.get('kgsm');
    this.scene.start(startScene === 'game' ? 'game' : 'title');
  }
}
