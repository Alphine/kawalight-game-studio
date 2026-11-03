// Title screen: name, best score, and a start control.
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
    this.cameras.main.setBackgroundColor('#070b16');

    // Decorative gem board in the background.
    const keys = config.gems.map((g) => g.sprite);
    const size = 56;
    const cols = Math.ceil(W / size);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < cols; c++) {
        this.add.image(c * size + size / 2, H * 0.62 + r * size + size / 2, 'plate')
          .setDisplaySize(size - 4, size - 4).setAlpha(0.55);
        this.add.image(c * size + size / 2, H * 0.62 + r * size + size / 2,
          keys[(r * 3 + c * 5) % keys.length])
          .setDisplaySize(size - 14, size - 14).setAlpha(0.85);
      }
    }

    this.add.text(W / 2, H * 0.22, 'GEM RUSH', {
      fontFamily: 'monospace', fontSize: '56px', color: '#ffd479',
    }).setOrigin(0.5);
    this.add.text(W / 2, H * 0.22 + 52, 'a KGSM match-3 template game', {
      fontFamily: 'monospace', fontSize: '14px', color: '#9fb38f',
    }).setOrigin(0.5);
    this.add.text(W / 2, H * 0.22 + 78,
      `Reach ${config.scoring.targetScore} points in ${config.moves.limit} moves`, {
        fontFamily: 'monospace', fontSize: '15px', color: '#c7d0e8',
      }).setOrigin(0.5);

    const best = createStore('puzzle-match').get('hiscore', { score: 0, moves: 0 });
    this.add.text(W / 2, H * 0.44, `BEST  ${best.score} POINTS`, {
      fontFamily: 'monospace', fontSize: '18px', color: '#7fd4ff',
    }).setOrigin(0.5);
    this.blink = this.add.text(W / 2, H * 0.92, 'PRESS SPACE OR CLICK TO START', {
      fontFamily: 'monospace', fontSize: '16px', color: '#c7d0e8',
    }).setOrigin(0.5);

    this.fireKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
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
