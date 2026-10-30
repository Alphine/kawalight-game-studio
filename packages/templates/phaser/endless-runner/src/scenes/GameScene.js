// Game screen: HUD, pause/game-over overlays. Thin view over the
// pure simulation in logic.js: input in, step, sync sprites, play sounds.
// Restart uses scene.restart(): no global listeners, so nothing duplicates.

import { createGame, stepGame, pauseGame, resumeGame, suggestInput } from '../logic.js';
// Runtime imports resolve in the staged/exported layout (js/game/scenes -> js/runtime).
import { createStore } from '../../runtime/store.js';
import { createAudio } from '../../runtime/audio.js';
import { createDebug } from '../../runtime/debug.js';
import { burst, shake, flash, hitFlash, popup } from '../../runtime/juice.js';

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

    this.cameras.main.setBackgroundColor('#0b1020');
    this.clouds = this.add.tileSprite(0, 0, W, H, 'clouds')
      .setOrigin(0, 0).setAlpha(0.7);
    this.hills = this.add.tileSprite(0, this.groundY - 80, W, 80, 'hills')
      .setOrigin(0, 0);
    this.ground = this.add.tileSprite(0, this.groundY, W, H - this.groundY, 'ground')
      .setOrigin(0, 0);
    this.typeToKey = new Map(config.obstacles.map((o) => [o.id, o.sprite]));

    // Player (feet-anchored) + obstacle/coin pools.
    this.playerImg = this.add.image(config.player.x, this.groundY, 'player')
      .setOrigin(0.5, 1);
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

    // HUD.
    const style = { fontFamily: 'monospace', fontSize: '16px', color: '#e8ecf8' };
    this.hudScore = this.add.text(12, 8, '', style).setDepth(10);
    this.hudBest = this.add.text(W - 12, 8, '', style).setOrigin(1, 0).setDepth(10);

    // Overlay (shared by pause / game over).
    this.overlay = this.add.container(0, 0).setDepth(50).setVisible(false);
    const dim = this.add.rectangle(0, 0, W, H, 0x04060d, 0.78).setOrigin(0, 0);
    this.overlayText = this.add.text(W / 2, H / 2, '', {
      fontFamily: 'monospace', fontSize: '22px', color: '#ffffff', align: 'center',
    }).setOrigin(0.5);
    this.overlay.add([dim, this.overlayText]);
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
    this.overlay.setVisible(true);
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
          count: 8, speedMin: 40, speedMax: 160, lifespan: 350,
          colors: [0xffd479, 0xfff3c4], gravityY: 200, scale: 1.1,
        });
        popup(this, cx, cy - 14, `+${this.cfg.scoring.coinScore}`, {
          color: '#ffd479', size: '15px',
        });
      } else if (e.type === 'milestone') {
        this.audio.win();
        popup(this, this.cfg.world.width / 2, 96, `${e.meters}m!`, {
          color: '#7fd4ff', size: '26px', rise: 30, duration: 1100,
        });
      } else if (e.type === 'gameover') {
        this.audio.hurt();
        this.audio.boom(true);
        const best = this.saveHi();
        shake(this, 220, 0.02);
        flash(this, 200, 255, 60, 60);
        burst(this, px, this.feetY(this.sim.player.h) - 20, {
          count: 22, speedMin: 80, speedMax: 340, lifespan: 600,
          colors: [0xff5a5a, 0xffb347, 0xffffff], scale: 1.8,
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
      this.ground.tilePositionX += dx;
      this.hills.tilePositionX += dx * 0.4;
      this.clouds.tilePositionX += dx * 0.12;
    }
    this.syncSprites(time);
    const meters = Math.floor(sim.distancePx / this.cfg.world.pxPerMeter);
    this.hudScore.setText(`DIST ${meters}m   SCORE ${sim.score}   COINS ${sim.coins}`);
    const hi = this.store.get('hiscore', { score: 0 });
    this.hudBest.setText(`BEST ${Math.max(hi.score || 0, sim.score)}`);
    this.debug.update(`speed ${Math.round(sim.speed)} obs ${sim.obstacles.length}`);
  }

  syncSprites(time) {
    const sim = this.sim;
    const p = this.cfg.player;
    const pl = sim.player;
    this.playerImg.setPosition(p.x, this.feetY(pl.h));
    if (sim.phase === 'gameover') {
      this.playerImg.setScale(1, 1).setRotation(-1.35);
    } else {
      this.playerImg.setScale(1, pl.sliding ? p.slideHeight / p.height : 1);
      this.playerImg.setRotation(pl.grounded ? 0
        : Math.max(-0.35, Math.min(0.4, -pl.vy / 2600)));
    }

    const seenObs = new Set();
    for (const o of sim.obstacles) {
      seenObs.add(o.uid);
      let img = this.obstacleImgs.get(o.uid);
      if (!img) {
        const key = this.typeToKey.get(o.type) || 'player';
        img = this.add.image(o.x, this.groundY - o.y, key).setOrigin(0.5, 1);
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
        img = this.add.image(cn.x, this.feetY(cn.y), 'coin');
        this.coinImgs.set(cn.uid, img);
      }
      img.setPosition(cn.x, this.feetY(cn.y));
      img.scaleX = 0.35 + 0.65 * Math.abs(Math.cos(time / 160 + cn.uid));
    }
    for (const [uid, img] of this.coinImgs) {
      if (!seenCoins.has(uid)) {
        img.destroy();
        this.coinImgs.delete(uid);
      }
    }
  }
}
