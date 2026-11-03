// Title/menu screen (SDD §3.2): title, best run, start control.
// Runtime imports resolve in the staged/exported layout (js/game/scenes -> js/runtime).

import { createStore } from '../../runtime/store.js';

const FONT = 'monospace';

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
    this.cameras.main.fadeIn(350, 11, 16, 32);

    // Parallax backdrop, same layers as the game (far, clouds, mid, ground).
    this.far = this.add.tileSprite(0, groundY - 120, W, 120, 'far')
      .setOrigin(0, 0).setAlpha(0.6);
    this.clouds = this.add.tileSprite(0, 0, W, H, 'clouds')
      .setOrigin(0, 0).setAlpha(0.7);
    this.add.tileSprite(0, groundY - 80, W, 80, 'hills').setOrigin(0, 0);
    this.add.tileSprite(0, groundY, W, H - groundY, 'ground').setOrigin(0, 0);

    // Framed title panel: dark glass, cyan hairline, corner ticks.
    const pw = 560;
    const ph = 236;
    const px = W / 2 - pw / 2;
    const py = H * 0.36 - ph / 2;
    const frame = this.add.graphics();
    frame.fillStyle(0x070b16, 0.78);
    frame.fillRoundedRect(px, py, pw, ph, 14);
    frame.lineStyle(2, 0x40e0ff, 0.7);
    frame.strokeRoundedRect(px, py, pw, ph, 14);
    frame.lineStyle(3, 0x40e0ff, 1);
    const t = 18;
    for (const [cx, cy, sx, sy] of [
      [px, py, 1, 1], [px + pw, py, -1, 1], [px, py + ph, 1, -1], [px + pw, py + ph, -1, -1],
    ]) {
      frame.beginPath();
      frame.moveTo(cx, cy + sy * t);
      frame.lineTo(cx, cy);
      frame.lineTo(cx + sx * t, cy);
      frame.strokePath();
    }
    frame.setAlpha(0);
    this.tweens.add({ targets: frame, alpha: 1, duration: 400, ease: 'Cubic.easeOut' });

    const title = this.add.text(W / 2, py + 62, 'SKYLINE SPRINT', {
      fontFamily: FONT, fontSize: '50px', fontStyle: 'bold',
      color: '#7fd4ff', stroke: '#0b1020', strokeThickness: 8,
      shadow: { offsetX: 0, offsetY: 0, color: '#40e0ff', blur: 14, fill: true },
    }).setOrigin(0.5);
    this.add.text(W / 2, py + 104, 'ENDLESS RUNNER  ·  KGSM TEMPLATE', {
      fontFamily: FONT, fontSize: '13px', color: '#8b94b3',
    }).setOrigin(0.5).setLetterSpacing(3);

    const hi = createStore('endless-runner').get('hiscore', { score: 0, meters: 0 });
    this.add.text(W / 2, py + 152, `BEST  ${hi.score} PTS   ·   ${hi.meters} M`, {
      fontFamily: FONT, fontSize: '18px', fontStyle: 'bold', color: '#ffd479',
    }).setOrigin(0.5);
    this.add.text(W / 2, py + 190, 'SPACE jump   ·   S slide   ·   P pause', {
      fontFamily: FONT, fontSize: '13px', color: '#8b94b3',
    }).setOrigin(0.5);

    // Hero on the rooftop with a subtle idle bob.
    const hero = this.add.image(W / 2, groundY + 2, 'player').setOrigin(0.5, 1);
    this.tweens.add({
      targets: hero, y: groundY - 6, duration: 520,
      ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
    });
    this.hero = hero;

    this.add.rectangle(W / 2, H * 0.92, 328, 34, 0x070b16, 0.8)
      .setStrokeStyle(1, 0x40e0ff, 0.6);
    this.blink = this.add.text(W / 2, H * 0.92, 'PRESS SPACE OR CLICK TO START', {
      fontFamily: FONT, fontSize: '16px', fontStyle: 'bold', color: '#e8ecf8',
    }).setOrigin(0.5);
    this.title = title;

    this.fireKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.input.once('pointerdown', () => this.start());
  }

  update(time) {
    this.blink.setAlpha(0.55 + 0.45 * Math.sin(time / 280));
    this.clouds.tilePositionX = time * 0.01;
    this.far.tilePositionX = time * 0.03;
    if (!this.starting && Phaser.Input.Keyboard.JustDown(this.fireKey)) {
      this.start();
    }
  }

  start() {
    if (this.starting) return;
    this.starting = true;
    this.cameras.main.fadeOut(220, 11, 16, 32);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('game'));
  }
}
