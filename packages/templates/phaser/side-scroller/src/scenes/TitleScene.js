// Title/menu screen (SDD §3.3): title, best run, start control.
// Runtime imports resolve in the staged/exported layout (js/game/scenes -> js/runtime).

import { createStore } from '../../runtime/store.js';
import { framePanel, textStyle } from '../ui.js';

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
    this.cameras.main.setBackgroundColor('#0d1626');

    // Layered backdrop: sky haze, far ridge, mid hills, mossy ground.
    this.add.tileSprite(0, 0, W, H, 'clouds').setOrigin(0, 0).setAlpha(0.7);
    this.drift = this.add.tileSprite(0, H - 250, W, 150, 'ridge').setOrigin(0, 0).setAlpha(0.9);
    this.add.tileSprite(0, H - 190, W, 120, 'hills').setOrigin(0, 0);
    this.add.tileSprite(0, H - 70, W, 70, 'brick').setOrigin(0, 0);

    // Hero stands on the ground with a gentle idle bob.
    const hero = this.add.image(W / 2, H - 70, 'player').setOrigin(0.5, 1);
    hero.setScale(120 / hero.height);
    this.tweens.add({
      targets: hero, y: H - 70 - 5, duration: 900,
      ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
    });

    // Title block: framed panel, shadowed title, amber rule, subtitle.
    framePanel(this, W / 2, H * 0.27, 560, 150, { depth: 20 });
    const title = this.add.text(W / 2, H * 0.27 - 14, 'PIXEL PASS', textStyle('title'))
      .setOrigin(0.5).setDepth(21);
    title.setShadow(0, 4, '#000000', 0, true, true);
    this.tweens.add({
      targets: title, y: title.y - 4, duration: 1400,
      ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
    });
    this.add.rectangle(W / 2, H * 0.27 + 28, 260, 2, 0xffd479, 0.7).setDepth(21);
    this.add.text(W / 2, H * 0.27 + 46, 'A KGSM SIDE-SCROLLER', textStyle('subtitle'))
      .setOrigin(0.5).setDepth(21);

    // Best run, in its own small panel.
    const hi = createStore('side-scroller').get('hiscore', { score: 0, timeSec: 0 });
    framePanel(this, W / 2, H * 0.62, 280, 56, { depth: 20 });
    this.add.text(W / 2, H * 0.62, `BEST  ${hi.score} PTS`, textStyle('accent'))
      .setOrigin(0.5).setDepth(21);

    this.blink = this.add.text(W / 2, H * 0.86, 'PRESS SPACE OR CLICK TO START', textStyle('body'))
      .setOrigin(0.5).setDepth(21);
    this.add.text(W / 2, H - 14, 'ARROWS / A D to move · SPACE / W to jump · P to pause',
      textStyle('label', { fontSize: '12px' })).setOrigin(0.5, 1).setDepth(21);

    this.fireKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.input.once('pointerdown', () => this.start());
  }

  update(time) {
    if (this.drift) this.drift.tilePositionX = time * 0.01;
    this.blink.setAlpha(0.55 + 0.45 * Math.sin(time / 280));
    if (!this.starting && Phaser.Input.Keyboard.JustDown(this.fireKey)) {
      this.start();
    }
  }

  start() {
    if (this.starting) return;
    this.starting = true;
    this.cameras.main.fadeOut(220, 13, 22, 38);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('game'));
  }
}
