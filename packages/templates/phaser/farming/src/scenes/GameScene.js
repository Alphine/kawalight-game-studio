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
import { PALETTE, FONT, TEXT, panel, bar, drawBackdrop, Button } from '../ui.js';

const DRY_TINT = 0xffffff;
const WET_TINT = 0xd0b89a; // multiplies the soil: a richer, darker wet tone
const CROP_FILL = 0.92; // a mature crop fills this share of its plot
const FRAME = 14; // wooden frame width around the field
const HUD_Y = 6;
const HUD_H = 52;

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

    this.cameras.main.setBackgroundColor('#7fc8c0');
    drawBackdrop(this, W, H);

    // Wooden frame with a grass border, then the farmer on the left margin.
    const frame = this.add.graphics().setDepth(0);
    frame.fillStyle(PALETTE.ink, 0.35);
    frame.fillRoundedRect(f.originX - FRAME + 4, f.originY - FRAME + 7,
      this.fieldW + FRAME * 2, this.fieldH + FRAME * 2, 18);
    frame.fillStyle(PALETTE.earth, 1);
    frame.fillRoundedRect(f.originX - FRAME, f.originY - FRAME,
      this.fieldW + FRAME * 2, this.fieldH + FRAME * 2, 18);
    frame.lineStyle(2, PALETTE.ink, 1);
    frame.strokeRoundedRect(f.originX - FRAME, f.originY - FRAME,
      this.fieldW + FRAME * 2, this.fieldH + FRAME * 2, 18);
    frame.fillStyle(PALETTE.greenDeep, 1);
    frame.fillRoundedRect(f.originX - 8, f.originY - 8, this.fieldW + 16, this.fieldH + 16, 10);

    const farmerH = 150;
    this.farmerHolder = this.add.container(f.originX / 2,
      f.originY + this.fieldH - 6).setDepth(2);
    this.farmer = this.add.image(0, 0, 'farmer').setOrigin(0.5, 1);
    this.farmer.setScale(farmerH / this.farmer.height);
    this.farmerHolder.add(this.farmer);
    this.tweens.add({
      targets: this.farmerHolder, y: this.farmerHolder.y - 5, duration: 1000,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    // Soil + crop + marker layers, one entry per plot.
    this.cells = [];
    for (let r = 0; r < f.rows; r++) {
      for (let c = 0; c < f.cols; c++) {
        const cx = f.originX + c * f.plotSize + f.plotSize / 2;
        const cy = f.originY + r * f.plotSize + f.plotSize / 2;
        const baseY = cy + f.plotSize / 2 - 8;
        const soil = this.add.image(cx, cy, 'soil')
          .setDisplaySize(f.plotSize - 4, f.plotSize - 4).setDepth(1);
        const crop = this.add.image(cx, baseY, config.crops[0].sprite)
          .setOrigin(0.5, 1).setVisible(false).setDepth(3);
        const drop = this.add.image(cx + f.plotSize / 2 - 14, cy - f.plotSize / 2 + 14,
          'drop').setVisible(false).setDepth(5);
        const twinkle = this.add.image(cx, cy - f.plotSize / 2 + 14,
          'sparkle').setVisible(false).setDepth(5);
        this.cells.push({ soil, crop, drop, twinkle, baseY, key: undefined, cropIdx: -1 });
      }
    }
    this.hover = this.add.rectangle(0, 0, f.plotSize - 2, f.plotSize - 2)
      .setStrokeStyle(3, PALETTE.goldLight, 0.95).setVisible(false).setDepth(6);

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

    this.buildHud(W);

    // Toolbar: buttons in a framed strip below the field.
    this.toolY = frameBottom(f) + 8;
    panel(this, 12, this.toolY - 6, W - 24, 48, { radius: 14 }).setDepth(9);
    this.toolBtns = {};
    this.toolBtns.plant = new Button(this, 0, this.toolY, '', () => setTool(this.sim, 'plant'));
    this.toolBtns.water = new Button(this, 0, this.toolY, '', () => setTool(this.sim, 'water'));
    this.toolBtns.harvest = new Button(this, 0, this.toolY, '', () => setTool(this.sim, 'harvest'));
    this.cropBtn = new Button(this, 0, this.toolY, '', () => this.cycleCrop());
    this.sleepBtn = new Button(this, 0, this.toolY, '[N] Sleep', () => this.applyInput({ nextDay: true }));
    for (const b of [...Object.values(this.toolBtns), this.cropBtn, this.sleepBtn]) b.setDepth(10);
    this.refreshToolbar();

    // Overlay (shared by pause / complete): dim, framed card, text.
    this.overlay = this.add.container(0, 0).setDepth(50).setVisible(false);
    const dim = this.add.rectangle(0, 0, W, H, 0x04060d, 0.6).setOrigin(0, 0);
    const card = panel(this, W / 2 - 280, H / 2 - 130, 560, 260, { radius: 18 });
    this.overlayText = this.add.text(W / 2, H / 2, '', {
      ...TEXT.body, fontSize: '20px', align: 'center', lineSpacing: 6,
    }).setOrigin(0.5);
    this.overlay.add([dim, card, this.overlayText]);
    this.hiSaved = false;

    this.input.on('pointerdown', (ptr) => this.clickPlot(ptr));
    this.input.on('pointermove', (ptr) => this.moveHover(ptr));
  }

  // HUD: three framed panels above the field (day, banked goal, coins).
  buildHud(W) {
    const hw = 236;
    panel(this, 12, HUD_Y, hw, HUD_H, { radius: 12 }).setDepth(9);
    this.hudDay = this.add.text(26, HUD_Y + 8, '', TEXT.h1).setDepth(10);
    this.hudTool = this.add.text(12 + hw - 14, HUD_Y + 12, '', TEXT.small)
      .setOrigin(1, 0).setDepth(10);
    this.dayBar = bar(this, 26, HUD_Y + 38, hw - 28, 6, PALETTE.gold);
    this.dayBar.track.setDepth(10);
    this.dayBar.fill.setDepth(10);

    const cw = 460;
    const cx0 = W / 2 - cw / 2;
    panel(this, cx0, HUD_Y, cw, HUD_H, { radius: 12 }).setDepth(9);
    this.hudGoal = this.add.text(W / 2, HUD_Y + 9, '', TEXT.h2)
      .setOrigin(0.5, 0).setDepth(10);
    this.goalBar = bar(this, cx0 + 18, HUD_Y + 38, cw - 36, 8, PALETTE.greenLight);
    this.goalBar.track.setDepth(10);
    this.goalBar.fill.setDepth(10);

    const rx = W - 12 - hw;
    panel(this, rx, HUD_Y, hw, HUD_H, { radius: 12 }).setDepth(9);
    this.hudCoinIcon = this.add.image(rx + 28, HUD_Y + HUD_H / 2, 'coin')
      .setDisplaySize(34, 34).setDepth(10);
    const coinScale = this.hudCoinIcon.scaleX;
    this.tweens.add({
      targets: this.hudCoinIcon, scaleX: { from: coinScale, to: coinScale * 0.25 },
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    this.hudCoins = this.add.text(rx + 52, HUD_Y + 8, '', TEXT.h1).setDepth(10);
    this.hudStats = this.add.text(rx + 52, HUD_Y + 34, '', TEXT.small).setDepth(10);
    this.hudCoinTarget = { x: rx + 28, y: HUD_Y + HUD_H / 2 };
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
      btn.setActive(this.sim.tool === tool);
    }
    this.toolBtns.plant.setLabel(
      `[${c.toolPlant.replace('ONE', '1')}] Plant ${crop.name} (${crop.seedCost}c)`);
    this.toolBtns.water.setLabel(`[${c.toolWater.replace('TWO', '2')}] Water`);
    this.toolBtns.harvest.setLabel(`[${c.toolHarvest.replace('THREE', '3')}] Harvest`);
    this.cropBtn.setLabel(`[C] Seed: ${crop.name}`);
    this.layoutToolbar();
  }

  // Lay buttons left to right; Sleep sits at the right edge of the strip.
  layoutToolbar() {
    const W = this.cfg.world.width;
    let x = 24;
    for (const b of [this.toolBtns.plant, this.toolBtns.water, this.toolBtns.harvest, this.cropBtn]) {
      b.setPosition(x, this.toolY);
      x += b.boxW + 10;
    }
    this.sleepBtn.setPosition(W - 24 - this.sleepBtn.boxW, this.toolY);
  }

  // Sparkle, coin fly and popup on harvest; a crop ghost lifts away.
  harvestFx(e, x, y) {
    const f = this.cfg.farm;
    const crop = this.cfg.crops.find((k) => k.id === e.crop);
    const cell = this.cells[e.row * f.cols + e.col];
    if (crop && cell && cell.crop.visible) {
      const ghost = this.add.image(cell.crop.x, cell.baseY, crop.sprite)
        .setOrigin(0.5, 1).setScale(cell.crop.scale).setDepth(30);
      this.tweens.add({
        targets: ghost, y: ghost.y - 52, scale: ghost.scale * 1.12, alpha: 0,
        duration: 520, ease: 'Cubic.easeOut',
        onComplete: () => ghost.destroy(),
      });
    }
    const dest = this.hudCoinTarget;
    for (let k = 0; k < 3; k++) {
      const coin = this.add.image(x, y, 'coin').setDisplaySize(24, 24).setDepth(45);
      this.tweens.add({
        targets: coin, x: dest.x, y: dest.y, scale: 0.2, duration: 620, delay: k * 90,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          coin.destroy();
          if (k === 2) this.bumpCoins();
        },
      });
    }
  }

  bumpCoins() {
    this.tweens.killTweensOf(this.hudCoins);
    this.hudCoins.setScale(1.22);
    this.tweens.add({
      targets: this.hudCoins, scale: 1, duration: 320, ease: 'Back.easeOut',
    });
  }

  // Farmer hop for planting and harvesting.
  farmerHop() {
    this.tweens.killTweensOf(this.farmer);
    this.farmer.y = 0;
    this.tweens.add({
      targets: this.farmer, y: -14, duration: 130, yoyo: true, ease: 'Quad.easeOut',
    });
  }

  handleEvents(events) {
    for (const e of events) {
      if (e.type === 'plant' || e.type === 'water' || e.type === 'harvest'
        || e.type === 'mature' || e.type === 'grow') {
        const { x, y } = this.cellCenter(e.col, e.row);
        if (e.type === 'plant') {
          this.audio.pickup();
          this.farmerHop();
          burst(this, x, y + 20, {
            count: 6, speedMin: 30, speedMax: 110, lifespan: 300,
            colors: [0x9a6a3f, 0x5a3a22], scale: 1.0,
          });
        } else if (e.type === 'water') {
          burst(this, x, y, {
            count: 10, speedMin: 40, speedMax: 140, lifespan: 350,
            colors: [PALETTE.sky, 0xcdeee6], gravityY: 400, scale: 1.1,
          });
        } else if (e.type === 'harvest') {
          const crop = this.cfg.crops.find((k) => k.id === e.crop);
          this.audio.pickup();
          this.farmerHop();
          burst(this, x, y, {
            count: 14, speedMin: 60, speedMax: 220, lifespan: 450,
            colors: [PALETTE.gold, PALETTE.goldLight, 0xffffff], gravityY: 300, scale: 1.3,
          });
          this.harvestFx(e, x, y);
          popup(this, x, y - 20, `+${crop ? crop.sellPrice : '?'}`, {
            color: '#fff0b0', size: '18px', rise: 56,
          });
        } else if (e.type === 'mature') {
          burst(this, x, y, {
            count: 6, speedMin: 20, speedMax: 80, lifespan: 300,
            colors: [PALETTE.greenLight, PALETTE.goldLight], gravityY: -50, scale: 1.0,
          });
        }
      } else if (e.type === 'newday') {
        this.audio.win();
        popup(this, this.cfg.world.width / 2, 120, `Day ${e.day}`, {
          color: '#fff0b0', size: '30px', rise: 24, duration: 1200,
        });
      } else if (e.type === 'rain') {
        const f = this.cfg.farm;
        burst(this, f.originX + this.fieldW / 2, f.originY + 40, {
          count: 24, speedMin: 60, speedMax: 200, lifespan: 600,
          colors: [PALETTE.sky, 0xcdeee6], gravityY: 500, scale: 1.2,
        });
        popup(this, f.originX + this.fieldW / 2, f.originY + 70, 'Rain!', {
          color: '#cdeee6', size: '18px',
        });
      } else if (e.type === 'complete') {
        this.audio.win();
        this.audio.pickup();
        const f = this.cfg.farm;
        shake(this, 220, 0.01);
        flash(this, 200, 255, 240, 180);
        for (let i = 0; i < 3; i++) {
          burst(this, f.originX + (this.fieldW * (i + 1)) / 4, f.originY + 100, {
            count: 16, speedMin: 80, speedMax: 300, lifespan: 700,
            colors: [PALETTE.gold, PALETTE.goldLight, PALETTE.greenLight], scale: 1.6,
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
      this.syncHud();
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
    this.syncHud();
    this.debug.update(`day ${sim.day} plots ${sim.plots.filter((p) => p.crop !== null).length}`);
  }

  syncHud() {
    const sim = this.sim;
    const f = this.cfg.farm;
    const target = this.cfg.scoring.targetCoins;
    const best = Math.max((this.store.get('hiscore', { earned: 0 }).earned) || 0,
      sim.totalEarned);
    this.hudDay.setText(`Day ${sim.day}`);
    this.hudTool.setText(`${sim.tool.toUpperCase()}${this.demoInput ? ' · AUTO' : ''}`);
    this.dayBar.set(sim.dayTimeMs / (f.dayLengthSec * 1000));
    this.hudGoal.setText(`BANKED  ${sim.totalEarned} / ${target}`);
    this.goalBar.set(sim.totalEarned / target);
    this.hudCoins.setText(`${sim.coins} COINS`);
    this.hudStats.setText(`HARVESTS ${sim.harvested}   BEST ${best}`);
  }

  // Crop scale for a growth stage: small sprout to full plant, in the plot.
  cropScale(crop, stage) {
    const src = this.textures.get(crop.sprite).getSourceImage();
    const px = src && src.width ? src.width : 128;
    const t = Math.min(1, stage / crop.stages);
    return (this.cfg.farm.plotSize * CROP_FILL / px) * (0.3 + 0.7 * t);
  }

  // Runs once per change in a plot's crop or stage: planting springs in,
  // growth pops. Between changes the scale is left alone so tweens can run.
  stageCell(cell, plot, key) {
    const prev = cell.cropIdx;
    cell.key = key;
    if (plot.crop === null) {
      cell.cropIdx = -1;
      this.tweens.killTweensOf(cell.crop);
      cell.crop.setVisible(false);
      return;
    }
    const crop = this.cfg.crops[plot.crop];
    const target = this.cropScale(crop, plot.stage);
    cell.crop.setTexture(crop.sprite).setVisible(true);
    this.tweens.killTweensOf(cell.crop);
    if (prev !== plot.crop) {
      cell.crop.setScale(target * 0.25);
      this.tweens.add({ targets: cell.crop, scale: target, duration: 520, ease: 'Back.easeOut' });
    } else {
      this.tweens.add({ targets: cell.crop, scale: target, duration: 420, ease: 'Back.easeOut' });
    }
    cell.cropIdx = plot.crop;
  }

  syncSprites(time) {
    const sim = this.sim;
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      const plot = sim.plots[i];
      const key = plot.crop === null ? null : `${plot.crop}:${plot.stage}`;
      if (key !== cell.key) this.stageCell(cell, plot, key);
      if (plot.crop === null) {
        cell.soil.setTint(DRY_TINT);
        cell.drop.setVisible(false);
        cell.twinkle.setVisible(false);
        continue;
      }
      const crop = this.cfg.crops[plot.crop];
      const mature = plot.stage >= crop.stages;
      cell.soil.setTint(plot.watered ? WET_TINT : DRY_TINT);
      cell.drop.setVisible(!mature && !plot.watered);
      cell.twinkle.setVisible(mature);
      if (mature) {
        cell.twinkle.setAlpha(0.5 + 0.5 * Math.sin(time / 200 + i));
        cell.crop.y = cell.baseY + Math.sin(time / 300 + i * 1.7) * 2;
      } else {
        cell.crop.y = cell.baseY;
      }
    }
  }
}

function frameBottom(f) {
  return f.originY + f.rows * f.plotSize + FRAME;
}
