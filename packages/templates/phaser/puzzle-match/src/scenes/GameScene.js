// Game screen: board, HUD, and overlays. A thin view over the pure simulation in
// logic.js. Input is handed to the simulation, and the events it returns are
// animated in order. Input is ignored while an animation runs, and the visuals
// are re-synced to the simulation grid at the end of every action.

import {
  createGame, selectAt, reshuffleNow, hint, summarize,
} from '../logic.js';
// Runtime imports resolve in the staged/exported layout (js/game/scenes -> js/runtime).
import { createStore } from '../../runtime/store.js';
import { createAudio } from '../../runtime/audio.js';
import { createDebug } from '../../runtime/debug.js';

const SWAP_MS = 120;
const CLEAR_MS = 140;
const FALL_MS = 150;
const SPAWN_MS = 170;

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  create() {
    const { config, seed, debug, demoInput } = this.game.registry.get('kgsm');
    this.cfg = config;
    this.demoInput = demoInput;
    this.sim = createGame(config, { seed });
    this.store = createStore('puzzle-match');
    this.audio = createAudio();
    this.debug = createDebug(this, debug);
    this.busy = false;
    this.paused = false;
    this.overlay = null;
    this.finished = false;

    const W = config.world.width;
    const H = config.world.height;
    const b = config.board;
    this.tile = b.tileSize;
    this.originX = b.originX;
    this.originY = b.originY;

    this.cameras.main.setBackgroundColor('#070b16');
    this.boardBg = this.add.rectangle(
      b.originX - 8, b.originY - 8, b.cols * b.tileSize + 16, b.rows * b.tileSize + 16,
      0x101a36).setOrigin(0, 0);

    // Plate per cell, a gem sprite per filled cell, and one selection ring.
    this.plates = [];
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        const { x, y } = this.cellCenter(r, c);
        this.add.image(x, y, 'plate').setDisplaySize(this.tile - 4, this.tile - 4)
          .setAlpha(0.9);
      }
    }
    this.gems = Array.from({ length: b.rows }, () => Array(b.cols).fill(null));
    this.ring = this.add.image(0, 0, 'ring').setDisplaySize(this.tile - 2, this.tile - 2)
      .setVisible(false).setDepth(6);
    this.syncGems(true);

    // HUD.
    const style = { fontFamily: 'monospace', fontSize: '16px', color: '#e8ecf8' };
    this.hudScore = this.add.text(12, 6, '', style).setDepth(10);
    this.hudMoves = this.add.text(W - 12, 6, '', style).setOrigin(1, 0).setDepth(10);
    this.hudGoal = this.add.text(12, 28, '', {
      fontFamily: 'monospace', fontSize: '13px', color: '#9fb38f',
    }).setDepth(10);
    this.updateHud();

    // Keys named by config.controls, with fallbacks for the overlay keys.
    const KC = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {};
    for (const name of new Set([...Object.values(config.controls), 'SPACE', 'ESC'])) {
      if (KC[name]) this.keys[name] = this.input.keyboard.addKey(KC[name]);
    }
    this.hintKey = this.keys[config.controls.hint];
    this.reshuffleKey = this.keys[config.controls.reshuffle];
    this.pauseKey = this.keys[config.controls.pause];
    this.spaceKey = this.keys.SPACE;

    this.input.on('pointerdown', (pointer) => this.onPointer(pointer));
    this.audio.unlock();
    this.hintTimer = null;
    this.hintGlow = [];
  }

  // ---- geometry -------------------------------------------------------------

  cellCenter(r, c) {
    return {
      x: this.originX + c * this.tile + this.tile / 2,
      y: this.originY + r * this.tile + this.tile / 2,
    };
  }

  cellAt(x, y) {
    const c = Math.floor((x - this.originX) / this.tile);
    const r = Math.floor((y - this.originY) / this.tile);
    if (r < 0 || c < 0 || r >= this.cfg.board.rows || c >= this.cfg.board.cols) return null;
    return [r, c];
  }

  spriteKey(gem) {
    return this.cfg.gems[gem].sprite;
  }

  // Create or move gem sprites so they match the simulation grid exactly.
  syncGems(instant = false) {
    const { rows, cols } = this.cfg.board;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const gem = this.sim.grid[r][c];
        const { x, y } = this.cellCenter(r, c);
        let img = this.gems[r][c];
        if (gem < 0) {
          if (img) { img.destroy(); this.gems[r][c] = null; }
          continue;
        }
        if (!img) {
          img = this.add.image(x, y, this.spriteKey(gem)).setDisplaySize(this.tile - 12, this.tile - 12);
          this.gems[r][c] = img;
        }
        img.setTexture(this.spriteKey(gem)).setDisplaySize(this.tile - 12, this.tile - 12);
        img.setPosition(x, y).setAlpha(1).setScale(1, 1).setDepth(2);
        if (instant) img.setScale(1, 1);
      }
    }
  }

  // ---- input -------------------------------------------------------------

  onPointer(pointer) {
    if (this.overlay) return;
    if (this.busy || this.paused || this.sim.phase !== 'playing') return;
    const cell = this.cellAt(pointer.x, pointer.y);
    if (!cell) return;
    this.clearHint();
    this.run(() => selectAt(this.sim, cell[0], cell[1]));
  }

  update() {
    if (this.demoInput) return;
    // SPACE starts over only after a finished game; the pause overlay is not an end screen.
    if (this.spaceKey && Phaser.Input.Keyboard.JustDown(this.spaceKey) && this.finished) {
      this.scene.restart();
      return;
    }
    if (this.pauseKey && Phaser.Input.Keyboard.JustDown(this.pauseKey)) this.togglePause();
    if (this.paused || this.busy || this.overlay) return;
    if (this.hintKey && Phaser.Input.Keyboard.JustDown(this.hintKey)) this.showHint();
    if (this.reshuffleKey && Phaser.Input.Keyboard.JustDown(this.reshuffleKey)) {
      this.clearHint();
      this.run(() => reshuffleNow(this.sim));
    }
  }

  togglePause() {
    if (this.sim.phase !== 'playing') return;
    this.paused = !this.paused;
    if (this.paused) this.showOverlay('PAUSED', 'Press P to resume');
    else this.hideOverlay();
  }

  showHint() {
    this.clearHint();
    const pair = hint(this.sim);
    if (!pair) return;
    for (const [r, c] of pair) {
      const { x, y } = this.cellCenter(r, c);
      const glow = this.add.image(x, y, 'glow').setDisplaySize(this.tile, this.tile)
        .setAlpha(0.35).setDepth(4);
      this.tweens.add({ targets: glow, alpha: 0.05, yoyo: true, repeat: -1, duration: 420 });
      this.hintGlow.push(glow);
    }
    this.hintTimer = this.time.delayedCall(2500, () => this.clearHint());
  }

  clearHint() {
    for (const glow of this.hintGlow) glow.destroy();
    this.hintGlow = [];
    if (this.hintTimer) { this.hintTimer.remove(false); this.hintTimer = null; }
  }

  // ---- running simulation actions ------------------------------------------

  // Run one simulation action, animate its events, then re-sync and check the end.
  async run(action) {
    if (this.busy) return;
    this.busy = true;
    const res = action();
    if (res && res.events && res.events.length) {
      for (const event of res.events) {
        await this.animate(event);
      }
    }
    this.syncGems();
    this.busy = false;
    this.updateHud();
    if (res && res.ok && this.sim.phase !== 'playing') this.finish();
  }

  animate(event) {
    switch (event.type) {
      case 'select': return this.markSelected(event.cell);
      case 'deselect': this.ring.setVisible(false); return Promise.resolve();
      case 'swap': return this.animateSwap(event.a, event.b);
      case 'clear': return this.animateClear(event);
      case 'fall': return this.animateFall(event);
      case 'reshuffle': return this.animateReshuffle();
      default: return Promise.resolve();
    }
  }

  tween(config) {
    return new Promise((resolve) => {
      this.tweens.add({ ...config, onComplete: () => resolve() });
    });
  }

  markSelected([r, c]) {
    const { x, y } = this.cellCenter(r, c);
    this.ring.setPosition(x, y).setVisible(true);
    return Promise.resolve();
  }

  animateSwap(a, b) {
    const ga = this.gems[a[0]][a[1]];
    const gb = this.gems[b[0]][b[1]];
    this.ring.setVisible(false);
    const pa = this.cellCenter(a[0], a[1]);
    const pb = this.cellCenter(b[0], b[1]);
    const moves = [];
    if (ga) moves.push(this.tween({ targets: ga, x: pb.x, y: pb.y, duration: SWAP_MS }));
    if (gb) moves.push(this.tween({ targets: gb, x: pa.x, y: pa.y, duration: SWAP_MS }));
    return Promise.all(moves).then(() => {
      this.gems[a[0]][a[1]] = gb;
      this.gems[b[0]][b[1]] = ga;
    });
  }

  animateClear({ cells, points }) {
    const waits = [];
    let cx = 0;
    let cy = 0;
    for (const [r, c] of cells) {
      const img = this.gems[r][c];
      const p = this.cellCenter(r, c);
      cx += p.x;
      cy += p.y;
      if (img) {
        this.gems[r][c] = null;
        waits.push(this.tween({ targets: img, scale: 0.2, alpha: 0, duration: CLEAR_MS })
          .then(() => img.destroy()));
      }
    }
    this.audio.pickup();
    const n = cells.length || 1;
    this.popupText(cx / n, cy / n, `+${points}`);
    return Promise.all(waits);
  }

  animateFall({ falls, spawns }) {
    const moving = falls.map(({ from, to }) => {
      const img = this.gems[from[0]][from[1]];
      this.gems[from[0]][from[1]] = null;
      return { img, to };
    });
    const pending = [];
    for (const { img, to } of moving) {
      if (!img) continue;
      this.gems[to[0]][to[1]] = img;
      const p = this.cellCenter(to[0], to[1]);
      pending.push(this.tween({ targets: img, x: p.x, y: p.y, duration: FALL_MS }));
    }
    // New gems enter from above their column, stacked by how far they fall.
    const perColumn = new Map();
    for (const spawn of spawns) {
      const [r, c] = spawn.at;
      if (!perColumn.has(c)) perColumn.set(c, []);
      perColumn.get(c).push(spawn);
    }
    for (const [c, list] of perColumn) {
      list.sort((x, y) => x.at[0] - y.at[0]);
      const total = list.length;
      for (const spawn of list) {
        const [r] = spawn.at;
        const target = this.cellCenter(r, c);
        const startRow = r - total;
        const img = this.add.image(target.x, this.cellCenter(startRow, c).y,
          this.spriteKey(spawn.gem)).setDisplaySize(this.tile - 12, this.tile - 12).setDepth(2);
        this.gems[r][c] = img;
        pending.push(this.tween({ targets: img, y: target.y, duration: SPAWN_MS }));
      }
    }
    return Promise.all(pending);
  }

  animateReshuffle() {
    const fades = [];
    for (const row of this.gems) {
      for (const img of row) {
        if (img) fades.push(this.tween({ targets: img, alpha: 0, duration: 120 })
          .then(() => img.destroy()));
      }
    }
    return Promise.all(fades).then(() => {
      for (let r = 0; r < this.gems.length; r++) this.gems[r].fill(null);
      this.syncGems(true);
      for (const row of this.gems) for (const img of row) if (img) img.setAlpha(0);
      const shown = [];
      for (const row of this.gems) for (const img of row) if (img) {
        shown.push(this.tween({ targets: img, alpha: 1, duration: 160 }));
      }
      return Promise.all(shown);
    });
  }

  popupText(x, y, text) {
    const label = this.add.text(x, y, text, {
      fontFamily: 'monospace', fontSize: '18px', color: '#ffd479',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({ targets: label, y: y - 40, alpha: 0, duration: 600,
      onComplete: () => label.destroy() });
  }

  // ---- HUD, overlays, end of game -----------------------------------------

  updateHud() {
    const s = summarize(this.sim);
    this.hudScore.setText(`SCORE ${s.score}`);
    this.hudMoves.setText(`MOVES ${s.movesLeft}`);
    this.hudGoal.setText(`GOAL ${s.target} · H hint · R reshuffle · P pause`);
  }

  showOverlay(title, subtitle) {
    this.hideOverlay();
    const W = this.cfg.world.width;
    const H = this.cfg.world.height;
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.6).setOrigin(0, 0).setDepth(30);
    const t = this.add.text(W / 2, H / 2 - 20, title, {
      fontFamily: 'monospace', fontSize: '44px', color: '#ffd479',
    }).setOrigin(0.5).setDepth(31);
    const s = this.add.text(W / 2, H / 2 + 26, subtitle, {
      fontFamily: 'monospace', fontSize: '16px', color: '#c7d0e8',
    }).setOrigin(0.5).setDepth(31);
    this.overlay = [dim, t, s];
  }

  hideOverlay() {
    if (this.overlay) for (const o of this.overlay) o.destroy();
    this.overlay = null;
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    const s = summarize(this.sim);
    const best = this.store.get('hiscore', { score: 0, moves: 0 });
    if (s.score > best.score) this.store.set('hiscore', { score: s.score, moves: this.cfg.moves.limit - s.movesLeft });
    if (s.phase === 'won') {
      this.audio.win();
      this.showOverlay('GEMS RUSHED!', `Score ${s.score} · SPACE to play again`);
    } else {
      this.audio.hurt();
      this.showOverlay('OUT OF MOVES', `Score ${s.score} of ${s.target} · SPACE to try again`);
    }
  }
}
