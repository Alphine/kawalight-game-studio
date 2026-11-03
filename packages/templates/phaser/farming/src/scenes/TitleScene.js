// Title/menu screen (SDD §3.5): title panel, best harvest, start control.
// Idle motion only: the farmer bobs, crops sway, the start prompt breathes.
// Runtime imports resolve in the staged/exported layout (js/game/scenes -> js/runtime).

import { createStore } from '../../runtime/store.js';
import { PALETTE, FONT, TEXT, panel, drawBackdrop } from '../ui.js';

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
    this.cameras.main.setBackgroundColor('#7fc8c0');
    drawBackdrop(this, W, H);

    // Ground: a row of soil with crops sitting on it.
    const groundY = H * 0.74;
    const tile = 72;
    const cols = Math.ceil(W / tile);
    for (let c = 0; c < cols; c++) {
      this.add.image(c * tile + tile / 2, groundY + tile / 2, 'soil')
        .setDisplaySize(tile, tile)
        .setTint(c % 2 ? 0xe0c4a0 : 0xd6b48c);
    }
    this.add.rectangle(0, groundY, W, 4, PALETTE.earth).setOrigin(0, 0).setAlpha(0.8);
    const cropKeys = config.crops.map((cr) => cr.sprite);

    let n = 0;
    for (let c = 1; c < cols; c += 3, n++) {
      const key = cropKeys[n % cropKeys.length];
      const img = this.add.image(c * tile + tile / 2, groundY + 6, key)
        .setOrigin(0.5, 1).setDisplaySize(96, 96);
      this.tweens.add({
        targets: img, angle: { from: -2.5, to: 2.5 }, duration: 1500 + n * 130,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }

    // Farmer standing on the ground, left of centre.
    const farmer = this.add.image(W * 0.12, groundY + 4, 'farmer')
      .setOrigin(0.5, 1).setDisplaySize(150, 200);
    this.tweens.add({
      targets: farmer, y: farmer.y - 6, duration: 900, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Title panel: framed, centred, clear hierarchy.
    const pw = 560;
    const ph = 210;
    const px = W / 2 - pw / 2;
    const py = H * 0.1;
    panel(this, px, py, pw, ph, { radius: 18 });
    const title = this.add.text(W / 2, py + 56, 'SUNNY ACRES', {
      ...TEXT.title, fontSize: '58px', stroke: '#2a1a10', strokeThickness: 8,
    }).setOrigin(0.5);
    this.tweens.add({
      targets: title, y: title.y - 4, duration: 1400, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.add.text(W / 2, py + 108, 'A cozy farming game', {
      fontFamily: FONT, fontSize: '16px', color: '#cdeee6',
    }).setOrigin(0.5);
    this.add.text(W / 2, py + 136,
      `Bank ${config.scoring.targetCoins} coins from harvests to win`, {
        ...TEXT.body, fontSize: '16px',
      }).setOrigin(0.5);

    const hi = createStore('farming').get('hiscore', { earned: 0, day: 0 });
    this.add.text(W / 2, py + 176, `BEST  ${hi.earned} COINS  ·  DAY ${hi.day}`, {
      fontFamily: FONT, fontSize: '16px', fontStyle: 'bold', color: '#fff0b0',
    }).setOrigin(0.5);

    // Start prompt in its own pill, breathing alpha.
    const pillW = 360;
    panel(this, W / 2 - pillW / 2, H * 0.9 - 20, pillW, 40, {
      radius: 20, fill: PALETTE.ink, alpha: 0.7, stroke: PALETTE.gold, strokeAlpha: 0.6,
    });
    this.blink = this.add.text(W / 2, H * 0.9, 'PRESS SPACE OR CLICK TO START', {
      ...TEXT.label, fontSize: '15px', color: '#fff0b0',
    }).setOrigin(0.5);

    this.fireKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.input.once('pointerdown', () => this.start());
  }

  update(time) {
    this.blink.setAlpha(0.6 + 0.4 * Math.sin(time / 280));
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
