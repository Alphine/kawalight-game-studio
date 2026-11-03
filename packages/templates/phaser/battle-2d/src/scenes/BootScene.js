// Boot: loads sprite assets, then builds the procedural arena textures.

import { buildFloorTexture, buildVignetteTexture } from '../art.js';

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
    const { config, startScene } = this.game.registry.get('kgsm');
    buildFloorTexture(this);
    buildVignetteTexture(this, config.world.width, config.world.height);
    this.scene.start(startScene === 'game' ? 'game' : 'title');
  }
}
