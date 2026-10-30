// Game screen: farm grid, toolbar, HUD, pause/complete overlays. Thin view
// over the pure simulation in logic.js: input in, step, sync sprites, sounds.
// Restart uses scene.restart(): no global listeners, so nothing duplicates.

import {
  createGame, stepGame, pauseGame, resumeGame, setTool, selectCrop,
  suggestInput,
} from '../logic.js';
// Runtime imports resolve in the staged/exported layout (js/game/scenes -> js/runtime).
import { createStore } from '../../runtime/store.js';
import { createAudio } from '../../runtime/audio.js';
import { createDebug } from '../../runtime/debug.js';
import { burst, shake, flash, popup } from '../../runtime/juice.js';

const DRY_TINT = 0xffffff;
const WET_TINT = 0x9a7a5a;

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  create() {
    const { config, seed, debug, demoInput } = this.game.registry.get('kgsm');
    this.cfg = config;
    this.demoInput = demoInput;
    this.sim = createGame(config, { seed });
    this.store = createStore('farming');
    this.audio = createAudio();
    this.debug = createDebug(this, debug);
    const W = config.world.width;
    const H = config.world.height;
    const f = config.farm;
    this.fieldW = f.cols * f.plotSize;
    this.fieldH = f.rows * f.plotSize;

    this.cameras.main.setBackgroundColor('#0d1a12');
    // Field frame.
    this.add.rectangle(f.originX - 8, f.originY - 8,
      this.fieldW + 16, this.fieldH + 16, 0x2a1f14).setOrigin(0, 0);
    this.add.rectangle(f.originX - 4, f.originY - 4,
      this.fieldW + 8, this.fieldH + 8, 0x4a7a3f).setOrigin(0, 0);

    // Soil + crop + marker layers, one entry per plot.
    this.cells = [];
    for (let r = 0; r < f.rows; r++) {
      for (let c = 0; c < f.cols; c++) {
        const cx = f.originX + c * f.plotSize + f.plotSize / 2;
        const cy = f.originY + r * f.plotSize + f.plotSize / 2;
        const soil = this.add.image(cx, cy, 'soil')
          .setDisplaySize(f.plotSize - 4, f.plotSize - 4);
        const crop = this.add.image(cx, cy + f.plotSize / 2 - 8, config.crops[0].sprite)
          .setOrigin(0.5, 1).setVisible(false);
        const drop = this.add.image(cx + f.plotSize / 2 - 14, cy - f.plotSize / 2 + 14,
          'drop').setVisible(false).setDepth(5);
        const twinkle = this.add.image(cx, cy - f.plotSize / 2 + 14,
          'sparkle').setVisible(false).setDepth(5);
        this.cells.push({ soil, crop, drop, twinkle });
      }
    }
    this.hover = this.add.rectangle(0, 0, f.plotSize - 2, f.plotSize - 2)
      .setStrokeStyle(2, 0xffd479).setVisible(false).setDepth(6);

    // Keys by name (config keys + fallbacks + overlay keys).
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const names = new Set([
      ...Object.values(config.controls), 'ONE', 'TWO', 'THREE', 'C', 'N',
      'P', 'ESC', 'R', 'T', 'SPACE',
    ]);
    this.keymap = {};
    for (const name of names) {
      if (KC[name]) this.keymap[name] = this.input.keyboard.addKey(KC[name]);
    }

    // HUD.
    const style = { fontFamily: 'monospace', fontSize: '16px', color: '#e8ecf8' };
    this.hudDay = this.add.text(12, 6, '', style).setDepth(10);
    this.hudCoins = this.add.text(W - 12, 6, '', style).setOrigin(1, 0).setDepth(10);
    this.hudGoal = this.add.text(12, 28, '', {
      fontFamily: 'monospace', fontSize: '13px', color: '#9fb38f',
    }).setDepth(10);
    // Day progress bar.
    this.dayBarBg = this.add.rectangle(W / 2 - 100, 12, 200, 10, 0x1b2340)
      .setOrigin(0, 0).setDepth(10);
    this.dayBar = this.add.rectangle(W / 2 - 100, 12, 0, 10, 0xffd479)
      .setOrigin(0, 0).setDepth(10);

    // Toolbar (clickable + keyboard).
    this.toolBtns = {};
    const ty = f.originY + this.fieldH + 12;
    const mkBtn = (x, label, cb) => {
      const t = this.add.text(x, ty, label, {
        fontFamily: 'monospace', fontSize: '15px', color: '#c7d0e8',
        backgroundColor: '#1b2340', padding: { x: 8, y: 4 },
      }).setInteractive({ useHandCursor: true });
      t.on('pointerdown', (ptr) => { ptr.event.stopPropagation(); cb(); });
      return t;
    };
    this.toolBtns.plant = mkBtn(24, '', () => setTool(this.sim, 'plant'));
    this.toolBtns.water = mkBtn(190, '', () => setTool(this.sim, 'water'));
    this.toolBtns.harvest = mkBtn(356, '', () => setTool(this.sim, 'harvest'));
    this.cropBtn = mkBtn(540, '', () => this.cycleCrop());
    this.sleepBtn = mkBtn(790, '[N] Sleep', () => this.applyInput({ nextDay: true }));
    this.refreshToolbar();

    // Overlay (shared by pause / complete).
    this.overlay = this.add.container(0, 0).setDepth(50).setVisible(false);
    const dim = this.add.rectangle(0, 0, W, H, 0x04060d, 0.78).setOrigin(0, 0);
    this.overlayText = this.add.text(W / 2, H / 2, '', {
      fontFamily: 'monospace', fontSize: '22px', color: '#ffffff', align: 'center',
    }).setOrigin(0.5);
    this.overlay.add([dim, this.overlayText]);
    this.hiSaved = false;

    this.input.on('pointerdown', (ptr) => this.clickPlot(ptr));
    this.input.on('pointermove', (ptr) => this.moveHover(ptr));
  }

  down(...names) {
    return names.some((n) => {
      const k = this.keymap[n];
      return k && k.isDown;
    });
  }

  justDown(...names) {
    return names.some((n) => {
      const k = this.keymap[n];
      return k && Phaser.Input.Keyboard.JustDown(k);
    });
  }

  cycleCrop() {
    const n = this.cfg.crops.length;
    selectCrop(this.sim, this.cfg, (this.sim.cropIndex + 1) % n);
    this.refreshToolbar();
  }

  plotAt(px, py) {
    const f = this.cfg.farm;
    const c = Math.floor((px - f.originX) / f.plotSize);
    const r = Math.floor((py - f.originY) / f.plotSize);
    if (c < 0 || r < 0 || c >= f.cols || r >= f.rows) return null;
    return { col: c, row: r };
  }

  cellCenter(col, row) {
    const f = this.cfg.farm;
    return {
      x: f.originX + col * f.plotSize + f.plotSize / 2,
      y: f.originY + row * f.plotSize + f.plotSize / 2,
    };
  }

  clickPlot(ptr) {
    if (this.sim.phase !== 'playing') return;
    const hit = this.plotAt(ptr.worldX, ptr.worldY);
    if (!hit) return;
    this.applyInput({ tool: this.sim.tool, cropIndex: this.sim.cropIndex, ...hit });
  }

  moveHover(ptr) {
    const hit = this.plotAt(ptr.worldX, ptr.worldY);
    if (!hit) {
      this.hover.setVisible(false);
      return;
    }
    const { x, y } = this.cellCenter(hit.col, hit.row);
    this.hover.setPosition(x, y).setVisible(true);
  }

  applyInput(input) {
    if (this.sim.phase !== 'playing') return;
    this.audio.unlock();
    this.handleEvents(stepGame(this.sim, this.cfg, input, 0));
    this.refreshToolbar();
    this.checkOverlays();
  }

  togglePause() {
    if (this.sim.phase === 'playing') {
      pauseGame(this.sim);
      this.showOverlay('PAUSED\n\nP resume · R restart · T title');
    } else if (this.sim.phase === 'paused') {
      resumeGame(this.sim);
      this.overlay.setVisible(false);
    }
  }

  showOverlay(msg) {
    this.overlayText.setText(msg);
    this.overlay.setVisible(true);
  }

  saveHi() {
    if (this.hiSaved) return this.store.get('hiscore', { earned: 0, day: 1 });
    this.hiSaved = true;
    const hi = this.store.get('hiscore', { earned: 0, day: 1 });
    const best = {
      earned: Math.max(hi.earned || 0, this.sim.totalEarned),
      day: Math.max(hi.day || 1, this.sim.day),
    };
    this.store.set('hiscore', best);
    return best;
  }

  checkOverlays() {
    if (this.sim.phase === 'complete' && !this.overlay.visible) {
      const best = this.saveHi();
      this.showOverlay(
        `HARVEST GOAL REACHED!\n\nBANKED  ${this.sim.totalEarned} COINS`
        + `\nDAY  ${this.sim.day}   HARVESTS  ${this.sim.harvested}`
        + `\nBEST  ${best.earned} COINS · DAY ${best.day}\n\nR restart · T title`);
    }
  }

  refreshToolbar() {
    const c = this.cfg.controls;
    const crop = this.cfg.crops[this.sim.cropIndex];
    for (const [tool, btn] of Object.entries(this.toolBtns)) {
      const active = this.sim.tool === tool;
      btn.setColor(active ? '#ffd479' : '#c7d0e8');
      btn.setBackgroundColor(active ? '#3a2f14' : '#1b2340');
    }
    this.toolBtns.plant.setText(
      `[${c.toolPlant.replace('ONE', '1')}] Plant ${crop.name} (${crop.seedCost}c)`);
    this.toolBtns.water.setText(`[${c.toolWater.replace('TWO', '2')}] Water`);
    this.toolBtns.harvest.setText(`[${c.toolHarvest.replace('THREE', '3')}] Harvest`);
    this.cropBtn.setText(`[C] Seed: ${crop.name}`);
  }

  handleEvents(events) {
    for (const e of events) {
      if (e.type === 'plant' || e.type === 'water' || e.type === 'harvest'
        || e.type === 'mature' || e.type === 'grow') {
        const { x, y } = this.cellCenter(e.col, e.row);
        if (e.type === 'plant') {
          this.audio.pickup();
          burst(this, x, y + 20, {
            count: 6, speedMin: 30, speedMax: 110, lifespan: 300,
            colors: [0x8a5a33, 0x5a3a22], scale: 1.0,
          });
        } else if (e.type === 'water') {
          burst(this, x, y, {
            count: 10, speedMin: 40, speedMax: 140, lifespan: 350,
            colors: [0x40c8ff, 0xcdf0ff], gravityY: 400, scale: 1.1,
          });
        } else if (e.type === 'harvest') {
          const crop = this.cfg.crops.find((k) => k.id === e.crop);
          this.audio.pickup();
          burst(this, x, y, {
            count: 12, speedMin: 60, speedMax: 220, lifespan: 450,
            colors: [0xffd479, 0xfff3c4], gravityY: 300, scale: 1.3,
          });
          popup(this, x, y - 20, `+${crop ? crop.sellPrice : '?'}`, {
            color: '#ffd479', size: '16px',
          });
        } else if (e.type === 'mature') {
          burst(this, x, y, {
            count: 5, speedMin: 20, speedMax: 80, lifespan: 300,
            colors: [0x7fff9f, 0xfff3c4], gravityY: -50, scale: 1.0,
          });
        }
      } else if (e.type === 'newday') {
        this.audio.win();
        popup(this, this.cfg.world.width / 2, 120, `Day ${e.day}`, {
          color: '#7fd4ff', size: '30px', rise: 24, duration: 1200,
        });
      } else if (e.type === 'rain') {
        const f = this.cfg.farm;
        burst(this, f.originX + this.fieldW / 2, f.originY + 40, {
          count: 24, speedMin: 60, speedMax: 200, lifespan: 600,
          colors: [0x40c8ff, 0x9fdcff], gravityY: 500, scale: 1.2,
        });
        popup(this, f.originX + this.fieldW / 2, f.originY + 70, 'Rain!', {
          color: '#9fdcff', size: '18px',
        });
      } else if (e.type === 'complete') {
        this.audio.win();
        this.audio.pickup();
        const f = this.cfg.farm;
        shake(this, 220, 0.01);
        flash(this, 200, 255, 220, 120);
        for (let i = 0; i < 3; i++) {
          burst(this, f.originX + (this.fieldW * (i + 1)) / 4, f.originY + 100, {
            count: 16, speedMin: 80, speedMax: 300, lifespan: 700,
            colors: [0xffd479, 0x7fff9f, 0xff9f9f], scale: 1.6,
          });
        }
      }
    }
    this.checkOverlays();
  }

  update(time, delta) {
    const sim = this.sim;
    const c = this.cfg.controls;
    if (this.justDown(c.pause, 'P', 'ESC')) this.togglePause();

    if (sim.phase !== 'playing' && sim.phase !== 'complete') {
      if (this.justDown('R')) { this.scene.restart(); return; }
      if (this.justDown('T')) { this.scene.start('title'); return; }
    }
    if (sim.phase === 'complete') {
      if (this.justDown('R')) { this.scene.restart(); return; }
      if (this.justDown('T')) { this.scene.start('title'); return; }
      this.syncSprites(time);
      return;
    }

    if (sim.phase === 'playing') {
      if (!this.demoInput) {
        if (this.justDown(c.toolPlant, 'ONE')) { setTool(sim, 'plant'); this.refreshToolbar(); }
        if (this.justDown(c.toolWater, 'TWO')) { setTool(sim, 'water'); this.refreshToolbar(); }
        if (this.justDown(c.toolHarvest, 'THREE')) { setTool(sim, 'harvest'); this.refreshToolbar(); }
        if (this.justDown('C')) this.cycleCrop();
        if (this.justDown(c.nextDay, 'N')) this.applyInput({ nextDay: true });
      }
      const input = this.demoInput ? suggestInput(sim, this.cfg) : {};
      if (sim.phase === 'playing') {
        this.audio.unlock();
        this.handleEvents(stepGame(sim, this.cfg, input, delta));
      }
    }
    this.syncSprites(time);
    const f = this.cfg.farm;
    this.hudDay.setText(`DAY ${sim.day}   ${sim.tool.toUpperCase()}`
      + (this.demoInput ? '   (auto)' : ''));
    this.hudCoins.setText(`${sim.coins} COINS`);
    const hi = this.store.get('hiscore', { earned: 0 });
    this.hudGoal.setText(
      `BANKED ${sim.totalEarned}/${this.cfg.scoring.targetCoins}`
      + `   HARVESTS ${sim.harvested}   BEST ${Math.max(hi.earned || 0, sim.totalEarned)}`);
    this.dayBar.width = 200 * (sim.dayTimeMs / (f.dayLengthSec * 1000));
    this.debug.update(`day ${sim.day} plots ${sim.plots.filter((p) => p.crop !== null).length}`);
  }

  syncSprites(time) {
    const sim = this.sim;
    const f = this.cfg.farm;
    const base = (f.plotSize - 4) / 64; // crop sprites are 64x64
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      const plot = sim.plots[i];
      if (plot.crop === null) {
        cell.soil.setTint(DRY_TINT);
        cell.crop.setVisible(false);
        cell.drop.setVisible(false);
        cell.twinkle.setVisible(false);
        continue;
      }
      const crop = this.cfg.crops[plot.crop];
      const mature = plot.stage >= crop.stages;
      cell.soil.setTint(plot.watered ? WET_TINT : DRY_TINT);
      const t = Math.min(1, plot.stage / crop.stages);
      cell.crop.setTexture(crop.sprite).setVisible(true)
        .setScale(base * (0.22 + 0.78 * t));
      cell.drop.setVisible(!mature && !plot.watered);
      cell.twinkle.setVisible(mature);
      if (mature) {
        cell.twinkle.setAlpha(0.5 + 0.5 * Math.sin(time / 200 + i));
        cell.crop.y = cell.soil.y + f.plotSize / 2 - 8
          + Math.sin(time / 300 + i * 1.7) * 2;
      }
    }
  }
}
