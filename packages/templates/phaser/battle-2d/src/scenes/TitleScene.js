// Title/menu screen: title, best score, start control.
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
    this.add.tileSprite(0, 0, W, H, 'arena-floor').setOrigin(0, 0);
    this.add.image(W / 2, H * 0.3, 'player').setScale(3);
    this.add.image(W / 2 - 90, H * 0.3, 'enemy-grunt').setScale(2);
    this.add.image(W / 2 + 90, H * 0.3, 'enemy-stinger').setScale(2);

    this.add.text(W / 2, H * 0.5, 'ARENA CLASH', {
      fontFamily: 'monospace', fontSize: '48px', color: '#ffb347',
    }).setOrigin(0.5);
    this.add.text(W / 2, H * 0.5 + 44, 'a KGSM battle-2d template game', {
      fontFamily: 'monospace', fontSize: '14px', color: '#8b94b3',
    }).setOrigin(0.5);

    const hi = createStore('battle-2d').get('hiscore', 0);
    this.add.text(W / 2, H * 0.68, `BEST  ${hi}`, {
      fontFamily: 'monospace', fontSize: '18px', color: '#ffd479',
    }).setOrigin(0.5);
    this.blink = this.add.text(W / 2, H * 0.8, 'PRESS SPACE OR CLICK TO START', {
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
