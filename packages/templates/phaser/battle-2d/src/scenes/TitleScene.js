// Title/menu screen: framed title panel, idle-bobbing cast, best score, start.
// Runtime imports resolve in the staged/exported layout (js/game/scenes -> js/runtime).

import { createStore } from '../../runtime/store.js';
import { fitImage } from '../art.js';

const AMBER = 0xffb347;

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
    this.cameras.main.fadeIn(300, 5, 7, 15);

    this.add.tileSprite(0, 0, W, H, 'arena-floor').setOrigin(0, 0);
    this.add.image(W / 2, H / 2, 'arena-vignette').setOrigin(0.5).setDepth(2);

    // Framed title panel: ink fill, amber rule, inner hairline.
    const panel = this.add.graphics().setDepth(3);
    const pw = 560;
    const ph = 318;
    const px = W / 2 - pw / 2;
    const py = 86;
    panel.fillStyle(0x0b1020, 0.86).fillRoundedRect(px, py, pw, ph, 16);
    panel.lineStyle(2, AMBER, 0.85).strokeRoundedRect(px, py, pw, ph, 16);
    panel.lineStyle(1, 0x3d6fd6, 0.5).strokeRoundedRect(px + 7, py + 7, pw - 14, ph - 14, 11);
    panel.fillStyle(AMBER, 0.9).fillRect(W / 2 - 60, 206, 120, 2);

    // Cast: grunt, hero, stinger, idle-bobbing with staggered phase.
    const cast = [
      { key: 'enemy-grunt', x: W / 2 - 150, y: 152, size: 1.1, delay: 300 },
      { key: 'player', x: W / 2, y: 148, size: 1.3, delay: 0 },
      { key: 'enemy-stinger', x: W / 2 + 150, y: 152, size: 1.1, delay: 600 },
    ];
    for (const c of cast) {
      const img = fitImage(this.add.image(c.x, c.y, c.key).setDepth(5), c.key, c.size);
      const target = img.scaleX;
      img.setScale(0);
      this.tweens.add({ targets: img, scale: target, duration: 520, delay: c.delay, ease: 'Back.easeOut' });
      this.tweens.add({
        targets: img, y: c.y - 8, duration: 1500, delay: c.delay + 520,
        ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
      });
      if (c.key === 'player') {
        this.tweens.add({
          targets: img, angle: 4, duration: 1800, delay: c.delay + 520,
          ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
        });
      }
    }

    const title = this.add.text(W / 2, 250, 'ARENA CLASH', {
      fontFamily: 'monospace', fontSize: '54px', fontStyle: 'bold',
      color: '#ffb347', stroke: '#141a2e', strokeThickness: 8,
    }).setOrigin(0.5).setDepth(6);
    title.setShadow(0, 5, 'rgba(0,0,0,0.6)', 0, true, true);
    this.add.text(W / 2, 292, 'KGSM  BATTLE-2D  TEMPLATE', {
      fontFamily: 'monospace', fontSize: '13px', color: '#8b94b3',
    }).setOrigin(0.5).setDepth(6);

    const hi = createStore('battle-2d').get('hiscore', 0);
    this.add.text(W / 2, 334, `BEST  ${hi}`, {
      fontFamily: 'monospace', fontSize: '18px', fontStyle: 'bold', color: '#ffd479',
    }).setOrigin(0.5).setDepth(6);

    this.blink = this.add.text(W / 2, 374, 'PRESS SPACE OR CLICK TO START', {
      fontFamily: 'monospace', fontSize: '16px', color: '#e8ecf8',
    }).setOrigin(0.5).setDepth(6);
    this.tweens.add({
      targets: this.blink, alpha: { from: 0.3, to: 1 }, duration: 700,
      ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
    });

    this.add.text(W / 2, H * 0.92,
      'WASD move  ·  SPACE fire  ·  J melee  ·  P pause', {
        fontFamily: 'monospace', fontSize: '12px', color: '#5c668a',
      }).setOrigin(0.5).setDepth(6);

    this.fireKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.input.once('pointerdown', () => this.start());
  }

  update() {
    if (!this.starting && Phaser.Input.Keyboard.JustDown(this.fireKey)) {
      this.start();
    }
  }

  start() {
    if (this.starting) return;
    this.starting = true;
    this.cameras.main.fadeOut(260, 5, 7, 15);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('game');
    });
  }
}
