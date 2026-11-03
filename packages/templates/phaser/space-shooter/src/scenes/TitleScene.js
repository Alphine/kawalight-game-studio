// Title/menu screen (SDD §3.1): title, best score, start control.
// Runtime imports resolve in the staged/exported layout (js/game/scenes -> js/runtime).

import { createStore } from '../../runtime/store.js';
import { createBackdrop } from './backdrop.js';
import { COLOR, HEX, FONT, drawPanel, drawRule } from './ui.js';

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
    const cx = W / 2;
    const cy = H / 2;

    this.backdrop = createBackdrop(this, W, H);
    this.cameras.main.fadeIn(350, 5, 7, 15);

    // Framed title panel.
    const pw = 540;
    const ph = 312;
    drawPanel(this.add.graphics(), cx - pw / 2, cy - ph / 2, pw, ph, { radius: 18 });

    this.add.text(cx, cy - 92, 'A KGSM SPACE-SHOOTER', {
      fontFamily: FONT.ui, fontSize: '13px', color: HEX.dim,
    }).setOrigin(0.5).setLetterSpacing(4);

    const title = this.add.text(cx, cy - 46, 'GALAXY STRIKE', {
      fontFamily: FONT.ui, fontSize: '52px', fontStyle: 'bold', color: HEX.cyan,
      stroke: '#06142e', strokeThickness: 8,
      shadow: { offsetX: 0, offsetY: 6, color: '#000000', blur: 0, fill: true },
    }).setOrigin(0.5);
    title.setScale(0.6).setAlpha(0);
    this.tweens.add({
      targets: title, scale: 1, alpha: 1, duration: 620, ease: 'Back.easeOut',
    });

    drawRule(this.add.graphics(), cx - 150, cy + 2, 300, COLOR.gold, 0.6);
    this.add.text(cx, cy + 20, 'DEFEND THE SECTOR. SURVIVE FIVE WAVES.', {
      fontFamily: FONT.ui, fontSize: '14px', color: HEX.text,
    }).setOrigin(0.5).setLetterSpacing(1);

    const hi = createStore('space-shooter').get('hiscore', 0);
    this.add.text(cx, cy + 56, `BEST  ${hi}`, {
      fontFamily: FONT.mono, fontSize: '20px', fontStyle: 'bold', color: HEX.gold,
    }).setOrigin(0.5);

    this.add.text(cx, cy + 92, 'MOVE  WASD / ARROWS     FIRE  SPACE / Z     PAUSE  P / ESC', {
      fontFamily: FONT.mono, fontSize: '12px', color: HEX.dim,
    }).setOrigin(0.5);

    this.prompt = this.add.text(cx, cy + 128, 'PRESS SPACE OR CLICK TO START', {
      fontFamily: FONT.ui, fontSize: '15px', fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5).setLetterSpacing(2);
    this.tweens.add({
      targets: this.prompt, alpha: 0.3, duration: 700, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Idle showcase: the hero bobs on the left, three rivals hover on the right.
    this.hero = this.add.image(cx - 330, cy, 'player').setScale(0.42);
    this.tweens.add({
      targets: this.hero, y: cy - 14, duration: 1500, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.tweens.add({
      targets: this.hero, angle: 4, duration: 1100, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut',
    });
    const rivals = [
      { key: 'enemy-drone', x: cx + 320, y: cy - 110, delay: 0 },
      { key: 'enemy-weaver', x: cx + 355, y: cy + 8, delay: 260 },
      { key: 'enemy-diver', x: cx + 320, y: cy + 124, delay: 520 },
    ];
    for (const r of rivals) {
      const img = this.add.image(r.x, r.y, r.key).setScale(0.34);
      this.tweens.add({
        targets: img, y: r.y + 16, x: r.x - 12, duration: 1700, yoyo: true,
        repeat: -1, ease: 'Sine.easeInOut', delay: r.delay,
      });
    }

    this.fireKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.input.once('pointerdown', () => this.start());
  }

  update(time, delta) {
    this.backdrop.update(delta, 0.8);
    if (!this.starting && Phaser.Input.Keyboard.JustDown(this.fireKey)) {
      this.start();
    }
  }

  start() {
    if (this.starting) return;
    this.starting = true;
    this.cameras.main.fadeOut(260, 5, 7, 15);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('game');
    });
  }
}
