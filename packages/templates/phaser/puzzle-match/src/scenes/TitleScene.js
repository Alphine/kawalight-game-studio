// Title screen: a framed title card, five idle-bobbing gems, best score, and a
// start control. Runtime imports resolve in the staged/exported layout
// (js/game/scenes -> js/runtime).

import { createStore } from '../../runtime/store.js';
import { framedPanel, PALETTE } from '../ui.js';

const HERO_SIZE = 46;

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
    this.cameras.main.setBackgroundColor(PALETTE.ink);
    if (this.textures.exists('board-backdrop')) {
      this.add.image(W / 2, H / 2, 'board-backdrop').setDisplaySize(W, H).setDepth(-1);
    }

    // Decorative board along the bottom, drawn with the same plates as the game.
    const keys = config.gems.map((g) => g.sprite);
    const size = 54;
    const cols = Math.ceil(W / size);
    const x0 = (W - cols * size) / 2;
    const top = 360;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < cols; c++) {
        const x = x0 + c * size + size / 2;
        const y = top + r * size + size / 2;
        this.add.image(x, y, 'plate').setDisplaySize(size - 4, size - 4).setAlpha(0.45);
        this.add.image(x, y, keys[(r * 3 + c * 5) % keys.length])
          .setDisplaySize(size - 16, size - 16).setAlpha(0.8);
      }
    }

    // Hero row: one gem per kind, each bobbing and tilting on its own rhythm.
    const spacing = 62;
    const heroX0 = W / 2 - ((keys.length - 1) * spacing) / 2;
    keys.forEach((key, i) => {
      const x = heroX0 + i * spacing;
      const img = this.add.image(x, 66, key).setDisplaySize(HERO_SIZE, HERO_SIZE);
      this.tweens.add({
        targets: img, y: 58, duration: 800 + i * 90, yoyo: true, repeat: -1,
        ease: 'Sine.easeInOut', delay: i * 140,
      });
      this.tweens.add({
        targets: img, angle: { from: -7, to: 7 }, duration: 1100 + i * 70, yoyo: true,
        repeat: -1, ease: 'Sine.easeInOut', delay: i * 90,
      });
    });

    // Title card: name, a tagline underneath, and the win condition.
    const cardW = 600;
    const cardH = 130;
    const cardY = 96;
    framedPanel(this, W / 2 - cardW / 2, cardY, cardW, cardH, { radius: 18 });
    // Gem emblem on each side of the name, when the emblem sprite is loaded.
    if (this.textures.exists('title-emblem')) {
      const emblemY = cardY + cardH / 2;
      this.add.image(W / 2 - 245, emblemY, 'title-emblem').setDisplaySize(110, 110);
      this.add.image(W / 2 + 245, emblemY, 'title-emblem').setDisplaySize(110, 110).setFlipX(true);
    }
    this.add.text(W / 2, cardY + 50, 'GEM RUSH', {
      fontFamily: 'monospace', fontSize: '60px', fontStyle: 'bold',
      color: '#ffd479', stroke: '#5a3a00', strokeThickness: 8,
    }).setOrigin(0.5).setShadow(0, 5, '#000000', 0, true, true);
    this.add.text(W / 2, cardY + 104, 'A KGSM MATCH-3 TEMPLATE GAME', {
      fontFamily: 'monospace', fontSize: '13px', color: '#9fb38f',
    }).setOrigin(0.5);
    this.add.text(W / 2, 250,
      `Reach ${config.scoring.targetScore} points in ${config.moves.limit} moves`, {
        fontFamily: 'monospace', fontSize: '16px', color: '#c7d0e8',
      }).setOrigin(0.5);

    // Best score in its own small panel.
    const best = createStore('puzzle-match').get('hiscore', { score: 0, moves: 0 });
    framedPanel(this, W / 2 - 150, 270, 300, 40, { radius: 12, edge: 0x3a5aa0 });
    this.add.text(W / 2, 290, `BEST  ${best.score} POINTS`, {
      fontFamily: 'monospace', fontSize: '18px', fontStyle: 'bold', color: '#7fd4ff',
    }).setOrigin(0.5);

    this.blink = this.add.text(W / 2, 332, 'PRESS SPACE OR CLICK TO START', {
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
