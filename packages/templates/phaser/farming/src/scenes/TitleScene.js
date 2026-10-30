// Title/menu screen (SDD §3.5): title, best harvest, start control.
// Runtime imports resolve in the staged/exported layout (js/game/scenes -> js/runtime).

import { createStore } from '../../runtime/store.js';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('title');
    this.starting = false;
  }

  create() {
    this.starting = false;
    const { config } = this.game.registry.get('kgsm');
    const W = config.world.width;
    const H = config.world.height;
    this.cameras.main.setBackgroundColor('#0d1a12');
    // Mini field backdrop: soil tiles + a few crops.
    const f = config.farm;
    const tile = Math.min(72, f.plotSize);
    const cols = Math.ceil(W / tile);
    const rows = 3;
    const top = H * 0.52;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.add.image(c * tile + tile / 2, top + r * tile + tile / 2, 'soil')
          .setDisplaySize(tile, tile)
          .setTint((r + c) % 2 ? 0x9a6a3f : 0x8a5a33)
          .setAlpha(0.9);
      }
    }
    const cropKeys = config.crops.map((cr) => cr.sprite);
    for (let c = 0; c < cols; c += 2) {
      this.add.image(c * tile + tile / 2, top + tile - 6, cropKeys[c % cropKeys.length])
        .setOrigin(0.5, 1).setDisplaySize(tile * 0.7, tile * 0.7);
    }
    this.add.image(W / 2 - 230, H * 0.3, 'farmer').setScale(2);

    this.add.text(W / 2, H * 0.2, 'SUNNY ACRES', {
      fontFamily: 'monospace', fontSize: '52px', color: '#ffd479',
    }).setOrigin(0.5);
    this.add.text(W / 2, H * 0.2 + 48, 'a KGSM farming template game', {
      fontFamily: 'monospace', fontSize: '14px', color: '#9fb38f',
    }).setOrigin(0.5);
    this.add.text(W / 2, H * 0.2 + 72,
      `Bank ${config.scoring.targetCoins} coins from harvests to win`, {
        fontFamily: 'monospace', fontSize: '14px', color: '#c7d0e8',
      }).setOrigin(0.5);

    const hi = createStore('farming').get('hiscore', { earned: 0, day: 0 });
    this.add.text(W / 2, H * 0.44, `BEST  ${hi.earned} COINS · DAY ${hi.day}`, {
      fontFamily: 'monospace', fontSize: '18px', color: '#7fd4ff',
    }).setOrigin(0.5);
    this.blink = this.add.text(W / 2, H * 0.94, 'PRESS SPACE OR CLICK TO START', {
      fontFamily: 'monospace', fontSize: '16px', color: '#c7d0e8',
    }).setOrigin(0.5);

    this.fireKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.input.once('pointerdown', () => this.start());
  }

  update(time) {
    this.blink.setAlpha(0.55 + 0.45 * Math.sin(time / 280));
    if (!this.starting && Phaser.Input.Keyboard.JustDown(this.fireKey)) {
      this.start();
    }
  }

  start() {
    if (this.starting) return;
    this.starting = true;
    this.scene.start('game');
  }
}
