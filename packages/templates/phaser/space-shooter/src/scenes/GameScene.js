// Game screen: HUD, pause/game-over/stage-clear overlays. Thin view over the
// pure simulation in logic.js: input in, step, sync sprites, play sounds.
// Restart uses scene.restart(): no global listeners, so nothing duplicates.

import { createGame, stepGame, pauseGame, resumeGame } from '../logic.js';
// Runtime imports resolve in the staged/exported layout (js/game/scenes -> js/runtime).
import { readInput } from '../../runtime/input.js';
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
    this.store = createStore('space-shooter');
    this.audio = createAudio();
    this.debug = createDebug(this, debug);
    const W = config.world.width;
    const H = config.world.height;

    this.bg = this.add.tileSprite(0, 0, W, H, 'starfield').setOrigin(0, 0);
    this.typeToKey = new Map(config.enemies.map((e) => [e.id, e.sprite]));

    // Player + pools.
    this.playerImg = this.add.image(config.player.x, config.player.y, 'player');
    this.shotImgs = [];
    for (let i = 0; i < config.weapon.poolSize; i++) {
      this.shotImgs.push(this.add.image(-100, -100, 'shot').setVisible(false));
    }
    this.enemyImgs = new Map();
    this.pickupImgs = [];
    // Kill gains queued by handleEvents, paired with explosion positions when
    // the enemy sprite is destroyed in syncSprites (logic emits no positions).
    this.pendingKills = [];

    // Keys by name (config keys + fallbacks + overlay keys).
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const names = new Set([
      ...Object.values(config.controls), 'UP', 'DOWN', 'LEFT', 'RIGHT',
      'Z', 'ESC', 'R', 'T',
    ]);
    this.keymap = {};
    for (const name of names) {
      if (KC[name]) this.keymap[name] = this.input.keyboard.addKey(KC[name]);
    }

    // HUD.
    const style = { fontFamily: 'monospace', fontSize: '16px', color: '#e8ecf8' };
    this.hudScore = this.add.text(12, 8, '', style).setDepth(10);
    this.hudState = this.add.text(W - 12, 8, '', style).setOrigin(1, 0).setDepth(10);

    // Overlay (shared by pause / game over / stage clear).
    this.overlay = this.add.container(0, 0).setDepth(50).setVisible(false);
    const dim = this.add.rectangle(0, 0, W, H, 0x04060d, 0.78).setOrigin(0, 0);
    this.overlayText = this.add.text(W / 2, H / 2, '', {
      fontFamily: 'monospace', fontSize: '22px', color: '#ffffff', align: 'center',
    }).setOrigin(0.5);
    this.overlay.add([dim, this.overlayText]);
    this.hiSaved = false;
  }

  demoInputFor(time) {
    const b = this.cfg.player.bounds;
    const tx = (b.minX + b.maxX) / 2 + Math.sin(time / 900) * (b.maxX - b.minX) / 3;
    const ty = (b.minY + b.maxY) / 2 + Math.sin(time / 1300) * (b.maxY - b.minY) / 3;
    const p = this.sim.player;
    return {
      up: ty < p.y - 6, down: ty > p.y + 6,
      left: tx < p.x - 6, right: tx > p.x + 6, fire: true,
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
    if (this.hiSaved) return;
    this.hiSaved = true;
    const hi = this.store.get('hiscore', 0);
    if (this.sim.score > hi) this.store.set('hiscore', this.sim.score);
  }

  handleEvents(events) {
    const p = this.sim.player;
    for (const e of events) {
      if (e.type === 'shot') this.audio.shoot(this.sim.player.power);
      else if (e.type === 'kill') {
        this.audio.boom(e.boss);
        this.pendingKills.push({ gain: e.score, boss: e.boss });
      } else if (e.type === 'hurt') {
        this.audio.hurt();
        this.hurtTick = true; // a crasher sprite dies this sync: no popup pairing
        flash(this, 140, 255, 60, 60);
        shake(this, 160, 0.012);
        burst(this, p.x, p.y, {
          count: 14, speedMin: 60, speedMax: 280, lifespan: 450,
          colors: [0xff5a5a, 0xffb347, 0xffffff], scale: 1.5,
        });
        hitFlash(this, this.playerImg, 0xff5a5a, 140);
      } else if (e.type === 'pickup') {
        this.audio.pickup();
        burst(this, p.x, p.y, {
          count: 8, speedMin: 40, speedMax: 150, lifespan: 350,
          colors: e.kind === 'power' ? [0x7dff9f, 0xffffff] : [0xffd479, 0xffffff],
          gravityY: 100, scale: 1.0,
        });
        popup(this, p.x, p.y - 24, `+${this.cfg.pickups?.powerupBonus ?? 50}`, {
          color: '#7dff9f', size: '14px',
        });
      } else if (e.type === 'wave-clear') {
        popup(this, this.cfg.world.width / 2, 120, `WAVE ${e.wave} CLEAR`, {
          color: '#7fd4ff', size: '22px', rise: 26, duration: 1000,
        });
      } else if (e.type === 'victory') {
        this.audio.win();
        this.saveHi();
        flash(this, 180);
        popup(this, this.cfg.world.width / 2, 120, 'SECTOR CLEAR!', {
          color: '#7dff9f', size: '26px', rise: 30, duration: 1200,
        });
        this.showOverlay(`SECTOR CLEAR!\n\nSCORE  ${e.score}\n\nR play again · T title`);
      } else if (e.type === 'gameover') {
        this.audio.boom(true);
        this.saveHi();
        shake(this, 260, 0.022);
        flash(this, 200, 255, 60, 60);
        burst(this, p.x, p.y, {
          count: 26, speedMin: 80, speedMax: 360, lifespan: 650,
          colors: [0xff5a5a, 0xffb347, 0xffffff], scale: 1.8,
        });
        this.showOverlay(`GAME OVER\n\nSCORE  ${e.score}\n\nR restart · T title`);
      }
    }
  }

  justDown(...names) {
    return names.some((n) => {
      const k = this.keymap[n];
      return k && Phaser.Input.Keyboard.JustDown(k);
    });
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
        ? this.demoInputFor(time)
        : readInput(this.keymap, this.cfg.controls);
      this.handleEvents(stepGame(sim, this.cfg, input, delta));
      this.bg.tilePositionX += delta * 0.02;
    }
    this.syncSprites(time);
    this.hudScore.setText(`SCORE ${sim.score}`);
    this.hudState.setText(
      `WAVE ${Math.min(sim.waveIndex + 1, this.cfg.waves.length)}/${this.cfg.waves.length}`
      + `   HP ${Math.max(sim.player.hp, 0)}   LIVES ${sim.player.lives}`);
    this.debug.update(`wave ${sim.waveIndex + 1} foes ${sim.enemies.length}`);
  }

  syncSprites(time) {
    const sim = this.sim;
    this.playerImg.setPosition(sim.player.x, sim.player.y);
    const blink = sim.timeMs < sim.player.invulnUntil && sim.phase === 'playing';
    this.playerImg.setAlpha(blink ? (Math.sin(time / 60) > 0 ? 0.25 : 1) : 1);
    this.playerImg.setVisible(sim.phase !== 'gameover');

    sim.shots.forEach((s, i) => {
      this.shotImgs[i].setVisible(s.active).setPosition(s.x, s.y);
    });

    const seen = new Set();
    for (const e of sim.enemies) {
      seen.add(e.uid);
      let img = this.enemyImgs.get(e.uid);
      if (!img) {
        const key = this.typeToKey.get(e.type) || 'player';
        img = this.add.image(e.x, e.y, key);
        if (e.isBoss) img.setScale(1.8);
        this.enemyImgs.set(e.uid, img);
      }
      img.setPosition(e.x, e.y);
    }
    for (const [uid, img] of this.enemyImgs) {
      if (!seen.has(uid)) {
        // On-screen removals are kills (off-screen exits sit near x <= -20):
        // explode where the sprite died and float its score gain.
        const W = this.cfg.world.width;
        const p = this.sim.player;
        const crashed = this.hurtTick
          && Math.hypot(img.x - p.x, img.y - p.y) < 70;
        if (crashed) this.hurtTick = false;
        if (img.x > -20 && img.x < W + 40 && this.sim.phase !== 'gameover') {
          // Crashers explode without consuming a shot-kill popup.
          const kill = crashed ? null : this.pendingKills.shift();
          burst(this, img.x, img.y, {
            count: kill?.boss ? 22 : 12, speedMin: 60, speedMax: 260,
            lifespan: kill?.boss ? 600 : 450,
            colors: kill?.boss
              ? [0xff5a5a, 0xffb347, 0xffffff]
              : [0xff9f5a, 0xffe08a, 0xffffff],
            scale: kill?.boss ? 1.8 : 1.3,
          });
          if (kill) {
            popup(this, img.x, img.y - 18, `+${kill.gain}`, {
              color: '#ffd479', size: '14px',
            });
          }
        }
        // Off-screen exits (x <= -20) pair with nothing: kills always pair.
        img.destroy();
        this.enemyImgs.delete(uid);
      }
    }
    this.hurtTick = false;

    while (this.pickupImgs.length < sim.pickups.length) {
      this.pickupImgs.push(this.add.image(-100, -100, 'pickup'));
    }
    this.pickupImgs.forEach((img, i) => {
      const k = sim.pickups[i];
      img.setVisible(!!k);
      if (k) {
        img.setPosition(k.x, k.y);
        img.setTint(k.kind === 'power' ? 0xffffff : 0xffd479);
      }
    });
  }
}
