// Boot: loads sprite assets + builds small helper textures (water drop,
// sparkle) so the template needs no extra asset files.

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
    // Water drop marker for thirsty crops.
    const d = this.make.graphics({ x: 0, y: 0 }, false);
    d.fillStyle(0x40c8ff, 1);
    d.fillTriangle(8, 0, 14, 10, 2, 10);
    d.fillCircle(8, 10, 6);
    d.fillStyle(0xcdf0ff, 1);
    d.fillCircle(6, 9, 2);
    d.generateTexture('drop', 16, 16);
    d.destroy();

    // Soft sparkle for mature crops.
    const s = this.make.graphics({ x: 0, y: 0 }, false);
    s.fillStyle(0xfff3c4, 1);
    s.fillPoints([
      new Phaser.Geom.Point(8, 0), new Phaser.Geom.Point(10, 6),
      new Phaser.Geom.Point(16, 8), new Phaser.Geom.Point(10, 10),
      new Phaser.Geom.Point(8, 16), new Phaser.Geom.Point(6, 10),
      new Phaser.Geom.Point(0, 8), new Phaser.Geom.Point(6, 6),
    ], true);
    s.generateTexture('sparkle', 16, 16);
    s.destroy();

    const { startScene } = this.game.registry.get('kgsm');
    this.scene.start(startScene === 'game' ? 'game' : 'title');
  }
}
