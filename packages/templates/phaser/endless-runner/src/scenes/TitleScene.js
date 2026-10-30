// Title/menu screen (SDD §3.2): title, best run, start control.
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
    const groundY = config.world.groundY;
    this.cameras.main.setBackgroundColor('#0b1020');
    this.add.tileSprite(0, 0, W, H, 'clouds').setOrigin(0, 0).setAlpha(0.7);
    this.add.tileSprite(0, groundY - 80, W, 80, 'hills').setOrigin(0, 0);
    this.add.tileSprite(0, groundY, W, H - groundY, 'ground').setOrigin(0, 0);
    this.add.image(W / 2, groundY, 'player').setOrigin(0.5, 1).setScale(2);

    this.add.text(W / 2, H * 0.28, 'SKYLINE SPRINT', {
      fontFamily: 'monospace', fontSize: '48px', color: '#7fd4ff',
    }).setOrigin(0.5);
    this.add.text(W / 2, H * 0.28 + 44, 'a KGSM endless-runner template game', {
      fontFamily: 'monospace', fontSize: '14px', color: '#8b94b3',
    }).setOrigin(0.5);

    const hi = createStore('endless-runner').get('hiscore', { score: 0, meters: 0 });
    this.add.text(W / 2, H * 0.62, `BEST  ${hi.score} PTS · ${hi.meters}m`, {
      fontFamily: 'monospace', fontSize: '18px', color: '#ffd479',
    }).setOrigin(0.5);
    this.blink = this.add.text(W / 2, H * 0.9, 'PRESS SPACE OR CLICK TO START', {
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
