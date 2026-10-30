// Game screen: HUD, pause/game-over/stage-clear overlays. Thin view over the
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
    this.store = createStore('battle-2d');
    this.audio = createAudio();
    this.debug = createDebug(this, debug);
    const W = config.world.width;
    const H = config.world.height;
    const b = config.player.bounds;

    this.add.tileSprite(0, 0, W, H, 'arena-floor').setOrigin(0, 0);
    // Arena edge.
    const edge = this.add.graphics().setDepth(1);
    edge.lineStyle(3, 0x2b3763, 1);
    edge.strokeRect(b.minX - 8, b.minY - 8,
      b.maxX - b.minX + 16, b.maxY - b.minY + 16);
    this.typeToKey = new Map(config.enemies.map((e) => [e.id, e.sprite]));

    // Player + pools.
    this.playerImg = this.add.image(config.player.x, config.player.y, 'player');
    this.shotImgs = [];
    for (let i = 0; i < config.ranged.poolSize; i++) {
      this.shotImgs.push(this.add.image(-100, -100, 'shot').setVisible(false));
    }
    this.foeShotImgs = [];
    for (let i = 0; i < config.foeShots.poolSize; i++) {
      this.foeShotImgs.push(this.add.image(-100, -100, 'foe-shot').setVisible(false));
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
      'W', 'A', 'S', 'D', 'SPACE', 'Z', 'X', 'J', 'ESC', 'R', 'T', 'P',
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

  readBattleInput() {
    const c = this.cfg.controls;
    return {
      up: this.down(c.up, 'UP', 'W'),
      down: this.down(c.down, 'DOWN', 'S'),
      left: this.down(c.left, 'LEFT', 'A'),
      right: this.down(c.right, 'RIGHT', 'D'),
      fire: this.down(c.fire, 'SPACE', 'Z'),
      melee: this.down(c.melee, 'J', 'X'),
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

  meleeFx(x, y, range) {
    const ring = this.add.graphics().setDepth(30);
    ring.lineStyle(5, 0x9fe8ff, 0.95);
    ring.strokeCircle(x, y, range);
    ring.lineStyle(2, 0xffffff, 0.9);
    ring.strokeCircle(x, y, range * 0.8);
    this.tweens.add({
      targets: ring, alpha: 0, scale: 1.15, duration: 220,
      onComplete: () => ring.destroy(),
    });
    burst(this, x, y, {
      count: 10, speedMin: 80, speedMax: 260, lifespan: 300,
      colors: [0x9fe8ff, 0xffffff], gravityY: 0, scale: 1.2,
    });
  }

  handleEvents(events) {
    const p = this.sim.player;
    for (const e of events) {
      if (e.type === 'shot') this.audio.shoot(1);
      else if (e.type === 'melee') {
        this.audio.shoot(2);
        this.meleeFx(p.x, p.y, this.cfg.melee.range);
      } else if (e.type === 'kill') {
        this.audio.boom(e.boss);
        this.pendingKills.push({ gain: e.score, boss: e.boss });
      } else if (e.type === 'hurt') {
        this.audio.hurt();
        flash(this, 140, 255, 60, 60);
        shake(this, 160, 0.012);
        burst(this, p.x, p.y, {
          count: 14, speedMin: 60, speedMax: 280, lifespan: 450,
          colors: [0xff5a5a, 0xffb347, 0xffffff], gravityY: 0, scale: 1.5,
        });
        hitFlash(this, this.playerImg, 0xff5a5a, 140);
      } else if (e.type === 'pickup') {
        this.audio.pickup();
        burst(this, p.x, p.y, {
          count: 8, speedMin: 40, speedMax: 150, lifespan: 350,
          colors: e.kind === 'heal' ? [0xff7d8a, 0xffffff] : [0xffd479, 0xffffff],
          gravityY: 0, scale: 1.0,
        });
        if (e.kind !== 'heal') {
          popup(this, p.x, p.y - 24, `+${this.cfg.pickups?.bonusScore ?? 50}`, {
            color: '#ffd479', size: '14px',
          });
        } else {
          popup(this, p.x, p.y - 24, '+HP', { color: '#ff7d8a', size: '14px' });
        }
      } else if (e.type === 'wave-clear') {
        popup(this, this.cfg.world.width / 2, 120, `WAVE ${e.wave} CLEAR`, {
          color: '#7fd4ff', size: '22px', rise: 26, duration: 1000,
        });
      } else if (e.type === 'victory') {
        this.audio.win();
        this.saveHi();
        flash(this, 180);
        popup(this, this.cfg.world.width / 2, 120, 'ARENA CLEAR!', {
          color: '#7dff9f', size: '26px', rise: 30, duration: 1200,
        });
        this.showOverlay(`ARENA CLEAR!\n\nSCORE  ${e.score}\n\nR play again · T title`);
      } else if (e.type === 'gameover') {
        this.audio.boom(true);
        this.saveHi();
        shake(this, 260, 0.022);
        flash(this, 200, 255, 60, 60);
        burst(this, p.x, p.y, {
          count: 26, speedMin: 80, speedMax: 360, lifespan: 650,
          colors: [0xff5a5a, 0xffb347, 0xffffff], gravityY: 0, scale: 1.8,
        });
        this.showOverlay(`GAME OVER\n\nSCORE  ${e.score}\n\nR restart · T title`);
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
        : this.readBattleInput();
      this.handleEvents(stepGame(sim, this.cfg, input, delta));
    }
    this.syncSprites(time);
    this.hudScore.setText(`SCORE ${sim.score}`);
    const hp = Math.max(sim.player.hp, 0);
    this.hudState.setText(
      `WAVE ${Math.min(sim.waveIndex + 1, this.cfg.waves.length)}/${this.cfg.waves.length}`
      + `   HP ${hp}   LIVES ${sim.player.lives}`);
    this.debug.update(`wave ${sim.waveIndex + 1} foes ${sim.enemies.length}`);
  }

  syncSprites(time) {
    const sim = this.sim;
    const p = sim.player;
    this.playerImg.setPosition(p.x, p.y);
    this.playerImg.setRotation(Math.atan2(p.fy, p.fx) + Math.PI / 2);
    const blink = sim.timeMs < p.invulnUntil && sim.phase === 'playing';
    this.playerImg.setAlpha(blink ? (Math.sin(time / 60) > 0 ? 0.25 : 1) : 1);
    this.playerImg.setVisible(sim.phase !== 'gameover');

    sim.shots.forEach((s, i) => {
      this.shotImgs[i].setVisible(s.active).setPosition(s.x, s.y);
    });
    sim.foeShots.forEach((s, i) => {
      this.foeShotImgs[i].setVisible(s.active).setPosition(s.x, s.y);
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
      img.setRotation(Math.atan2(p.y - e.y, p.x - e.x) + Math.PI / 2);
      if (e.hp < e.maxHp) img.setTint(0xff9a9a);
      else img.clearTint();
    }
    for (const [uid, img] of this.enemyImgs) {
      if (!seen.has(uid)) {
        // Removals are always kills (foes never leave the arena): explode
        // where the sprite died and float its score gain.
        const kill = sim.phase === 'gameover' ? null : this.pendingKills.shift();
        burst(this, img.x, img.y, {
          count: kill?.boss ? 22 : 12, speedMin: 60, speedMax: 260,
          lifespan: kill?.boss ? 600 : 450,
          colors: kill?.boss
            ? [0xff5a5a, 0xffb347, 0xffffff]
            : [0xff9f5a, 0xffe08a, 0xffffff],
          gravityY: 0, scale: kill?.boss ? 1.8 : 1.3,
        });
        if (kill) {
          popup(this, img.x, img.y - 18, `+${kill.gain}`, {
            color: '#ffd479', size: '14px',
          });
        }
        img.destroy();
        this.enemyImgs.delete(uid);
      }
    }

    while (this.pickupImgs.length < sim.pickups.length) {
      this.pickupImgs.push(this.add.image(-100, -100, 'pickup'));
    }
    this.pickupImgs.forEach((img, i) => {
      const k = sim.pickups[i];
      img.setVisible(!!k);
      if (k) {
        img.setPosition(k.x, k.y + Math.sin(time / 240 + i) * 3);
        img.setTint(k.kind === 'heal' ? 0xffffff : 0xffd479);
      }
    });
  }
}
