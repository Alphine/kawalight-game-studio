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
import { burst, shake } from '../../runtime/juice.js';
import { framedPanel, gemColor, PALETTE } from '../ui.js';

const SWAP_MS = 150;
const CLEAR_MS = 150;
const FALL_MS = 180;
const SPAWN_MS = 210;
const HUD_H = 48;

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
    this.lastScore = 0;

    const b = config.board;
    this.tile = b.tileSize;
    this.gemSize = b.tileSize - 12;
    this.originX = b.originX;
    this.originY = b.originY;

    this.cameras.main.setBackgroundColor(PALETTE.ink);
    this.drawBoard();

    this.gems = Array.from({ length: b.rows }, () => Array(b.cols).fill(null));
    this.ring = this.add.image(0, 0, 'ring').setDisplaySize(this.tile - 2, this.tile - 2)
      .setVisible(false).setDepth(6);
    this.ringBase = this.ring.scaleX;
    this.syncGems();

    this.buildHud();
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

  // ---- drawing ----------------------------------------------------------------

  drawBoard() {
    const b = this.cfg.board;
    const pad = 10;
    // Full-frame generated backdrop behind everything, when the sprite is loaded.
    if (this.textures.exists('board-backdrop')) {
      const W = this.cfg.world.width;
      const H = this.cfg.world.height;
      this.add.image(W / 2, H / 2, 'board-backdrop').setDisplaySize(W, H).setDepth(-1);
    }
    framedPanel(this, b.originX - pad, b.originY - pad,
      b.cols * b.tileSize + pad * 2, b.rows * b.tileSize + pad * 2,
      { radius: 16, alpha: 0.96 });
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        const { x, y } = this.cellCenter(r, c);
        this.add.image(x, y, 'plate').setDisplaySize(this.tile - 4, this.tile - 4)
          .setAlpha(0.9);
      }
    }
  }

  buildHud() {
    const W = this.cfg.world.width;
    framedPanel(this, 8, 4, W - 16, HUD_H, { radius: 12, depth: 9 });
    const caption = {
      fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold', color: '#8b94b3',
    };
    const value = {
      fontFamily: 'monospace', fontSize: '22px', fontStyle: 'bold', color: '#ffd479',
    };
    this.add.text(24, 9, 'SCORE', caption).setDepth(10);
    this.hudScore = this.add.text(24, 19, '', value).setDepth(10);
    this.add.text(W - 24, 9, 'MOVES', caption).setOrigin(1, 0).setDepth(10);
    this.hudMoves = this.add.text(W - 24, 19, '', { ...value, color: '#e8ecf8' })
      .setOrigin(1, 0).setDepth(10);

    // Goal caption and a progress bar toward the target score.
    this.add.text(W / 2, 9, `GOAL ${this.cfg.scoring.targetScore}`, caption)
      .setOrigin(0.5, 0).setDepth(10);
    const barW = 260;
    const barX = W / 2 - barW / 2;
    const barY = 36;
    this.hudBarW = barW;
    this.add.rectangle(barX, barY, barW, 8, 0x0a1126).setOrigin(0, 0.5)
      .setStrokeStyle(1, PALETTE.panelEdge).setDepth(10);
    this.hudBar = this.add.rectangle(barX, barY, 0, 8, PALETTE.gold)
      .setOrigin(0, 0.5).setDepth(11);
  }

  updateHud() {
    const s = summarize(this.sim);
    this.hudScore.setText(`${s.score}`);
    this.hudMoves.setText(`${s.movesLeft}`);
    this.hudBar.setSize(this.hudBarW * Math.min(1, s.score / s.target), 8);
    if (s.score !== this.lastScore) {
      this.lastScore = s.score;
      this.tweens.killTweensOf(this.hudScore);
      this.hudScore.setScale(1);
      this.tweens.add({
        targets: this.hudScore, scale: { from: 1.3, to: 1 }, duration: 220, ease: 'Back.easeOut',
      });
    }
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

  // Gem colour for the burst, looked up from the sprite key on a gem image.
  colorFor(sprite) {
    const gem = this.cfg.gems.find((g) => g.sprite === sprite);
    return gemColor(gem ? gem.id : '');
  }

  // A gem image at its display size. The base scale is kept as data so tweens
  // can scale relative to it.
  gemImage(x, y, sprite) {
    const img = this.add.image(x, y, sprite).setDepth(2);
    img.setData('base', this.gemSize / img.width);
    return img.setScale(img.getData('base'));
  }

  // Create or move gem sprites so they match the simulation grid exactly.
  syncGems() {
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
          img = this.gemImage(x, y, this.spriteKey(gem));
          this.gems[r][c] = img;
        }
        img.setTexture(this.spriteKey(gem));
        img.setData('base', this.gemSize / img.width);
        img.setPosition(x, y).setAlpha(1).setScale(img.getData('base')).setDepth(2);
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
    // A refused swap between two neighbours gets a small nudge instead of silence.
    const from = this.sim.selected;
    const adjacent = from && Math.abs(from[0] - cell[0]) + Math.abs(from[1] - cell[1]) === 1;
    this.run(() => selectAt(this.sim, cell[0], cell[1]), adjacent ? [from, cell] : null);
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
  async run(action, refused = null) {
    if (this.busy) return;
    this.busy = true;
    const res = action();
    if (res && res.events && res.events.length) {
      for (const event of res.events) {
        await this.animate(event);
      }
    } else if (res && res.ok === false && res.reason === 'no-match' && refused) {
      await this.nudge(refused[0], refused[1]);
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
    this.tweens.killTweensOf(this.ring);
    this.ring.setScale(this.ringBase * 1.15);
    this.tweens.add({ targets: this.ring, scale: this.ringBase, duration: 160, ease: 'Back.easeOut' });
    return Promise.resolve();
  }

  animateSwap(a, b) {
    const ga = this.gems[a[0]][a[1]];
    const gb = this.gems[b[0]][b[1]];
    this.ring.setVisible(false);
    const pa = this.cellCenter(a[0], a[1]);
    const pb = this.cellCenter(b[0], b[1]);
    const ease = 'Sine.easeInOut';
    const moves = [];
    if (ga) moves.push(this.tween({ targets: ga, x: pb.x, y: pb.y, duration: SWAP_MS, ease }));
    if (gb) moves.push(this.tween({ targets: gb, x: pa.x, y: pa.y, duration: SWAP_MS, ease }));
    return Promise.all(moves).then(() => {
      this.gems[a[0]][a[1]] = gb;
      this.gems[b[0]][b[1]] = ga;
    });
  }

  // Refused swap: both gems lean toward each other and back.
  nudge([ar, ac], [br, bc]) {
    const pa = this.cellCenter(ar, ac);
    const pb = this.cellCenter(br, bc);
    const moves = [];
    const ga = this.gems[ar][ac];
    const gb = this.gems[br][bc];
    const ease = 'Sine.easeInOut';
    if (ga) moves.push(this.tween({ targets: ga, x: pa.x + (pb.x - pa.x) * 0.2,
      y: pa.y + (pb.y - pa.y) * 0.2, duration: 70, yoyo: true, ease }));
    if (gb) moves.push(this.tween({ targets: gb, x: pb.x + (pa.x - pb.x) * 0.2,
      y: pb.y + (pa.y - pb.y) * 0.2, duration: 70, yoyo: true, ease }));
    return Promise.all(moves);
  }

  animateClear({ cells, points, cascade }) {
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
        burst(this, p.x, p.y, {
          colors: [this.colorFor(img.texture.key)], count: 7,
          speedMin: 40, speedMax: 170, lifespan: 360, scale: 1.1, gravityY: 280,
        });
        // Pop up a little, then shrink away with a slight overshoot.
        const base = img.getData('base');
        waits.push(this.tween({ targets: img, scale: base * 1.2, duration: 70, ease: 'Quad.easeOut' })
          .then(() => this.tween({ targets: img, scale: 0, alpha: 0,
            duration: CLEAR_MS, ease: 'Back.easeIn' }))
          .then(() => img.destroy()));
      }
    }
    this.audio.pickup();
    const n = cells.length || 1;
    this.popupText(cx / n, cy / n, `+${points}`);
    if (cascade > 0) {
      this.popupText(cx / n, cy / n + 22, `CASCADE x${cascade + 1}`, '#7fd4ff', 13);
    }
    // A cascade shakes the board a little; a deeper one shakes it harder.
    if (cascade >= 2) shake(this, 200, 0.008);
    else if (cascade === 1) shake(this, 110, 0.004);
    // A sparkle flash marks each cascade, when the sparkle sprite is loaded.
    if (cascade > 0 && this.textures.exists('cascade-sparkle')) {
      const spark = this.add.image(cx / n, cy / n, 'cascade-sparkle')
        .setDisplaySize(64, 64).setAlpha(0.95).setDepth(18);
      this.tweens.add({
        targets: spark, scale: { from: 0.4, to: 1.3 }, alpha: 0, angle: 45,
        duration: 420, ease: 'Cubic.easeOut', onComplete: () => spark.destroy(),
      });
    }
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
      pending.push(this.tween({ targets: img, x: p.x, y: p.y, duration: FALL_MS,
        ease: 'Quad.easeIn' }));
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
        const img = this.gemImage(target.x, this.cellCenter(startRow, c).y,
          this.spriteKey(spawn.gem));
        this.gems[r][c] = img;
        pending.push(this.tween({ targets: img, y: target.y, duration: SPAWN_MS,
          ease: 'Bounce.easeOut' }));
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
      this.syncGems();
      for (const row of this.gems) for (const img of row) if (img) img.setAlpha(0);
      const shown = [];
      for (const row of this.gems) for (const img of row) if (img) {
        shown.push(this.tween({ targets: img, alpha: 1, duration: 160 }));
      }
      return Promise.all(shown);
    });
  }

  popupText(x, y, text, color = '#ffd479', size = 20) {
    const label = this.add.text(x, y, text, {
      fontFamily: 'monospace', fontSize: `${size}px`, fontStyle: 'bold', color,
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({ targets: label, y: y - 44, alpha: 0, duration: 650,
      ease: 'Cubic.easeOut', onComplete: () => label.destroy() });
  }

  // ---- overlays, end of game -----------------------------------------------

  showOverlay(title, subtitle) {
    this.hideOverlay();
    const W = this.cfg.world.width;
    const H = this.cfg.world.height;
    const dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.6).setOrigin(0, 0).setDepth(30);
    const pw = 520;
    const ph = 170;
    const panel = framedPanel(this, W / 2 - pw / 2, H / 2 - ph / 2, pw, ph,
      { radius: 18, depth: 31 });
    const t = this.add.text(W / 2, H / 2 - 26, title, {
      fontFamily: 'monospace', fontSize: '42px', fontStyle: 'bold',
      color: '#ffd479', stroke: '#5a3a00', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(32);
    const s = this.add.text(W / 2, H / 2 + 30, subtitle, {
      fontFamily: 'monospace', fontSize: '16px', color: '#c7d0e8',
    }).setOrigin(0.5).setDepth(32);
    this.tweens.add({ targets: t, scale: { from: 0.6, to: 1 }, duration: 320, ease: 'Back.easeOut' });
    this.overlay = [dim, panel, t, s];
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
