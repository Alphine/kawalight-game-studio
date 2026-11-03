// Game screen: HUD, pause/game-over overlays. Thin view over the
// pure simulation in logic.js: input in, step, sync sprites, play sounds.
// Restart uses scene.restart(): no global listeners, so nothing duplicates.

import { createGame, stepGame, pauseGame, resumeGame, suggestInput } from '../logic.js';
// Runtime imports resolve in the staged/exported layout (js/game/scenes -> js/runtime).
import { createStore } from '../../runtime/store.js';
import { createAudio } from '../../runtime/audio.js';
import { createDebug } from '../../runtime/debug.js';
import { burst, shake, flash, hitFlash, popup } from '../../runtime/juice.js';

const FONT = 'monospace';
const COIN_DRAW = 24; // display size of a coin (hitbox radius 10 + halo)

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  create() {
    const { config, seed, debug, demoInput } = this.game.registry.get('kgsm');
    this.cfg = config;
    this.demoInput = demoInput;
    this.sim = createGame(config, { seed });
    this.store = createStore('endless-runner');
    this.audio = createAudio();
    this.debug = createDebug(this, debug);
    const W = config.world.width;
    const H = config.world.height;
    this.groundY = config.world.groundY;
    this.lastDust = 0;

    this.cameras.main.setBackgroundColor('#0b1020');
    this.far = this.add.tileSprite(0, this.groundY - 120, W, 120, 'far')
      .setOrigin(0, 0).setAlpha(0.55);
    this.clouds = this.add.tileSprite(0, 0, W, H, 'clouds')
      .setOrigin(0, 0).setAlpha(0.7);
    this.hills = this.add.tileSprite(0, this.groundY - 80, W, 80, 'hills')
      .setOrigin(0, 0);
    this.ground = this.add.tileSprite(0, this.groundY, W, H - this.groundY, 'ground')
      .setOrigin(0, 0);
    this.typeToKey = new Map(config.obstacles.map((o) => [o.id, o.sprite]));
    this.typeToDef = new Map(config.obstacles.map((o) => [o.id, o]));

    // Player (feet-anchored) + obstacle/coin pools.
    this.playerImg = this.add.image(config.player.x, this.groundY, 'player')
      .setOrigin(0.5, 1).setDisplaySize(config.player.width, config.player.height);
    this.obstacleImgs = new Map();
    this.coinImgs = new Map();

    // Keys by name (config keys + fallbacks + overlay keys).
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const names = new Set([
      ...Object.values(config.controls), 'UP', 'DOWN', 'LEFT', 'RIGHT',
      'W', 'S', 'SPACE', 'Z', 'ESC', 'R', 'T', 'P',
    ]);
    this.keymap = {};
    for (const name of names) {
      if (KC[name]) this.keymap[name] = this.input.keyboard.addKey(KC[name]);
    }

    // HUD: a slim glass bar across the top, three readouts.
    const bar = this.add.graphics().setDepth(9);
    bar.fillStyle(0x070b16, 0.6);
    bar.fillRect(0, 0, W, 38);
    bar.lineStyle(1, 0x40e0ff, 0.45);
    bar.lineBetween(0, 38, W, 38);
    const label = { fontFamily: FONT, fontSize: '12px', color: '#8b94b3' };
    const value = { fontFamily: FONT, fontSize: '17px', fontStyle: 'bold', color: '#e8ecf8' };
    this.hudDist = this.add.text(16, 19, '', value).setOrigin(0, 0.5).setDepth(10);
    this.add.text(16, 5, 'DISTANCE', label).setDepth(10);
    this.hudScore = this.add.text(W / 2, 19, '', {
      ...value, fontSize: '20px', color: '#ffd479',
    }).setOrigin(0.5, 0.5).setDepth(10);
    this.hudCoins = this.add.text(W - 16, 19, '', value).setOrigin(1, 0.5).setDepth(10);
    this.hudBest = this.add.text(W - 16, 5, '', { ...label, align: 'right' })
      .setOrigin(1, 0).setDepth(10);

    // Overlay (shared by pause / game over): dim, framed panel, message.
    this.overlay = this.add.container(0, 0).setDepth(50).setVisible(false);
    const dim = this.add.rectangle(0, 0, W, H, 0x04060d, 0.78).setOrigin(0, 0);
    this.overlayPanel = this.add.graphics();
    this.overlayText = this.add.text(W / 2, H / 2, '', {
      fontFamily: FONT, fontSize: '20px', color: '#e8ecf8', align: 'center',
      lineSpacing: 6,
    }).setOrigin(0.5);
    this.overlay.add([dim, this.overlayPanel, this.overlayText]);
    this.hiSaved = false;
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

  readRunnerInput() {
    const c = this.cfg.controls;
    return {
      jump: this.down(c.jump, 'UP', 'W', 'SPACE'),
      slide: this.down(c.slide, 'DOWN', 'S'),
    };
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
    const b = this.overlayText.getBounds();
    const pad = 32;
    const W = this.cfg.world.width;
    const H = this.cfg.world.height;
    const x = W / 2 - b.width / 2 - pad;
    const y = H / 2 - b.height / 2 - pad;
    this.overlayPanel.clear();
    this.overlayPanel.fillStyle(0x0b1020, 0.92);
    this.overlayPanel.fillRoundedRect(x, y, b.width + pad * 2, b.height + pad * 2, 14);
    this.overlayPanel.lineStyle(2, 0x40e0ff, 0.75);
    this.overlayPanel.strokeRoundedRect(x, y, b.width + pad * 2, b.height + pad * 2, 14);
    this.overlay.setVisible(true).setAlpha(0);
    this.tweens.add({ targets: this.overlay, alpha: 1, duration: 220, ease: 'Cubic.easeOut' });
  }

  saveHi() {
    if (this.hiSaved) return null;
    this.hiSaved = true;
    const meters = Math.floor(this.sim.distancePx / this.cfg.world.pxPerMeter);
    const hi = this.store.get('hiscore', { score: 0, meters: 0 });
    const best = {
      score: Math.max(hi.score || 0, this.sim.score),
      meters: Math.max(hi.meters || 0, meters),
    };
    this.store.set('hiscore', best);
    return best;
  }

  feetY(h) {
    return this.groundY - h;
  }

  handleEvents(events) {
    const px = this.cfg.player.x;
    for (const e of events) {
      if (e.type === 'jump') {
        burst(this, px, this.groundY, {
          count: 6, speedMin: 30, speedMax: 120, lifespan: 300,
          colors: [0x8b94b3, 0xcfd6ea], scale: 1.0,
        });
      } else if (e.type === 'land') {
        burst(this, px, this.groundY, {
          count: 5, speedMin: 20, speedMax: 90, lifespan: 250,
          colors: [0x5b688f, 0x8b94b3], scale: 0.9,
        });
      } else if (e.type === 'coin') {
        this.audio.pickup();
        const cx = this.cfg.player.x;
        const cy = this.feetY(e.y) - 12;
        burst(this, cx, cy, {
          count: 10, speedMin: 40, speedMax: 180, lifespan: 380,
          colors: [0x40e0ff, 0xffd479, 0xfff3c4], gravityY: 200, scale: 1.1,
        });
        popup(this, cx, cy - 14, `+${this.cfg.scoring.coinScore}`, {
          color: '#ffd479', size: '15px',
        });
      } else if (e.type === 'milestone') {
        this.audio.win();
        burst(this, this.cfg.world.width / 2, 60, {
          count: 18, speedMin: 60, speedMax: 240, lifespan: 600,
          colors: [0x7fd4ff, 0xffd479], gravityY: 300, scale: 1.4,
        });
        popup(this, this.cfg.world.width / 2, 96, `${e.meters}m!`, {
          color: '#7fd4ff', size: '26px', rise: 30, duration: 1100,
        });
      } else if (e.type === 'gameover') {
        this.audio.hurt();
        this.audio.boom(true);
        const best = this.saveHi();
        shake(this, 260, 0.024);
        flash(this, 220, 255, 90, 90);
        burst(this, px, this.feetY(this.sim.player.h) - 20, {
          count: 26, speedMin: 80, speedMax: 360, lifespan: 650,
          colors: [0xff5a5a, 0xffb347, 0xffffff, 0x40e0ff], scale: 1.8,
        });
        hitFlash(this, this.playerImg, 0xff5a5a, 200);
        this.showOverlay(
          `WIPED OUT\n\nSCORE  ${e.score}\nDIST  ${e.meters}m   COINS  ${e.coins}`
          + `\nBEST  ${best.score} PTS · ${best.meters}m\n\nR restart · T title`);
      }
    }
  }

  update(time, delta) {
    const sim = this.sim;
    const pauseKeys = [this.cfg.controls.pause, 'P', 'ESC'];
    if (this.justDown(...pauseKeys)) this.togglePause();

    const overlayKeys = sim.phase !== 'playing';
    if (overlayKeys && this.justDown('R')) {
      this.scene.restart();
      return;
    }
    if (overlayKeys && this.justDown('T')) {
      this.scene.start('title');
      return;
    }

    if (sim.phase === 'playing') {
      this.audio.unlock();
      const input = this.demoInput
        ? suggestInput(sim, this.cfg)
        : this.readRunnerInput();
      this.handleEvents(stepGame(sim, this.cfg, input, delta));
      const dx = sim.speed * (delta / 1000);
      this.far.tilePositionX += dx * 0.2;
      this.clouds.tilePositionX += dx * 0.12;
      this.hills.tilePositionX += dx * 0.4;
      this.ground.tilePositionX += dx;
      // Footfall dust while running on the slab.
      if (sim.player.grounded && sim.phase === 'playing' && time - this.lastDust > 150) {
        this.lastDust = time;
        burst(this, this.cfg.player.x - 12, this.groundY, {
          count: 2, speedMin: 15, speedMax: 60, lifespan: 260,
          colors: [0x5b688f, 0x8b94b3], scale: 0.8, gravityY: 300,
        });
      }
    }
    this.syncSprites(time);
    const meters = Math.floor(sim.distancePx / this.cfg.world.pxPerMeter);
    this.hudDist.setText(`${meters} m`);
    this.hudScore.setText(`${sim.score}`);
    this.hudCoins.setText(`COINS ${sim.coins}`);
    const hi = this.store.get('hiscore', { score: 0 });
    this.hudBest.setText(`BEST ${Math.max(hi.score || 0, sim.score)}`);
    this.debug.update(`speed ${Math.round(sim.speed)} obs ${sim.obstacles.length}`);
  }

  syncSprites(time) {
    const sim = this.sim;
    const p = this.cfg.player;
    const pl = sim.player;
    // Run bob while grounded; airborne tilt follows vertical velocity.
    const bob = pl.grounded && sim.phase === 'playing'
      ? Math.abs(Math.sin(time / 85)) * 3 : 0;
    this.playerImg.setPosition(p.x, this.feetY(pl.h) - bob);
    if (sim.phase === 'gameover') {
      this.playerImg.setDisplaySize(p.width, p.height).setRotation(-1.35);
    } else {
      const h = pl.sliding ? p.slideHeight : p.height;
      this.playerImg.setDisplaySize(p.width, h);
      this.playerImg.setRotation(pl.grounded ? 0
        : Math.max(-0.35, Math.min(0.4, -pl.vy / 2600)));
    }

    const seenObs = new Set();
    for (const o of sim.obstacles) {
      seenObs.add(o.uid);
      let img = this.obstacleImgs.get(o.uid);
      if (!img) {
        const key = this.typeToKey.get(o.type) || 'player';
        const def = this.typeToDef.get(o.type) || { w: o.w, h: o.h };
        img = this.add.image(o.x, this.groundY - o.y, key).setOrigin(0.5, 1)
          .setDisplaySize(def.w, def.h);
        this.obstacleImgs.set(o.uid, img);
      }
      img.setPosition(o.x, this.groundY - o.y);
    }
    for (const [uid, img] of this.obstacleImgs) {
      if (!seenObs.has(uid)) {
        img.destroy();
        this.obstacleImgs.delete(uid);
      }
    }

    const seenCoins = new Set();
    for (const cn of sim.pickups) {
      seenCoins.add(cn.uid);
      let img = this.coinImgs.get(cn.uid);
      if (!img) {
        img = this.add.image(cn.x, this.feetY(cn.y), 'coin').setDisplaySize(COIN_DRAW, COIN_DRAW);
        img.kgsmBase = COIN_DRAW / img.width;
        this.coinImgs.set(cn.uid, img);
      }
      img.setPosition(cn.x, this.feetY(cn.y));
      // Coin shimmer: squash the width as it spins, height stays fixed.
      const spin = 0.35 + 0.65 * Math.abs(Math.cos(time / 160 + cn.uid));
      img.setScale(img.kgsmBase * spin, img.kgsmBase);
    }
    for (const [uid, img] of this.coinImgs) {
      if (!seenCoins.has(uid)) {
        img.destroy();
        this.coinImgs.delete(uid);
      }
    }
  }
}
