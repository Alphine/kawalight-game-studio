// Game screen: arena, HUD, pause/game-over/stage-clear overlays. Thin view over
// the pure simulation in logic.js: input in, step, sync sprites, play sounds.
// Restart uses scene.restart(): no global listeners, so nothing duplicates.

import { createGame, stepGame, pauseGame, resumeGame, suggestInput } from '../logic.js';
// Runtime imports resolve in the staged/exported layout (js/game/scenes -> js/runtime).
import { createStore } from '../../runtime/store.js';
import { createAudio } from '../../runtime/audio.js';
import { createDebug } from '../../runtime/debug.js';
import { burst, shake, flash, hitFlash, popup } from '../../runtime/juice.js';
import { fitImage } from '../art.js';

const INK = 0x05070f;
const AMBER = 0xffb347;
const CRIMSON = 0xd9434f;
const LABEL = { fontFamily: 'monospace', fontSize: '10px', color: '#8b94b3' };
const VALUE = { fontFamily: 'monospace', fontSize: '17px', fontStyle: 'bold', color: '#ffffff' };

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
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;

    this.add.tileSprite(0, 0, W, H, 'arena-floor').setOrigin(0, 0);
    this.add.image(W / 2, H / 2, 'arena-vignette').setOrigin(0.5).setDepth(2);

    // Arena wall: dark outer band, amber inner rule, cobalt hairline.
    const frame = this.add.graphics().setDepth(3);
    frame.lineStyle(8, INK, 0.9).strokeRoundedRect(b.minX - 14, b.minY - 14, bw + 28, bh + 28, 10);
    frame.lineStyle(2, AMBER, 0.55).strokeRoundedRect(b.minX - 8, b.minY - 8, bw + 16, bh + 16, 8);
    frame.lineStyle(1, 0x3d6fd6, 0.45).strokeRoundedRect(b.minX - 3, b.minY - 3, bw + 6, bh + 6, 6);
    this.typeToKey = new Map(config.enemies.map((e) => [e.id, e.sprite]));

    // Player + pools.
    this.playerImg = fitImage(this.add.image(config.player.x, config.player.y, 'player').setDepth(6), 'player');
    this.shotImgs = [];
    for (let i = 0; i < config.ranged.poolSize; i++) {
      this.shotImgs.push(fitImage(this.add.image(-100, -100, 'shot').setDepth(6).setVisible(false), 'shot'));
    }
    this.foeShotImgs = [];
    for (let i = 0; i < config.foeShots.poolSize; i++) {
      this.foeShotImgs.push(fitImage(this.add.image(-100, -100, 'foe-shot').setDepth(6).setVisible(false), 'foe-shot'));
    }
    this.enemyImgs = new Map();
    this.enemyHp = new Map();
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

    this.buildHud(W, config.player.health);

    // Overlay (shared by pause / game over / stage clear): framed panel.
    this.overlay = this.add.container(0, 0).setDepth(50).setVisible(false);
    const dim = this.add.rectangle(0, 0, W, H, INK, 0.7).setOrigin(0, 0);
    this.overlayPanel = this.add.graphics();
    this.overlayText = this.add.text(W / 2, H / 2, '', {
      fontFamily: 'monospace', fontSize: '20px', color: '#ffffff', align: 'center', lineSpacing: 6,
    }).setOrigin(0.5);
    this.overlay.add([dim, this.overlayPanel, this.overlayText]);
    this.hiSaved = false;
  }

  buildHud(W, maxHp) {
    // Top bar: score (left), wave (centre), hearts and lives (right).
    const bar = this.add.graphics().setDepth(9);
    bar.fillStyle(INK, 0.74).fillRect(0, 0, W, 40);
    bar.fillStyle(AMBER, 0.7).fillRect(0, 39, W, 1);

    this.add.text(16, 5, 'SCORE', LABEL).setDepth(10);
    this.hudScore = this.add.text(16, 16, '0', VALUE).setDepth(10);
    this.add.text(W / 2, 5, 'WAVE', LABEL).setOrigin(0.5, 0).setDepth(10);
    this.hudWave = this.add.text(W / 2, 16, '', VALUE).setOrigin(0.5, 0).setDepth(10);

    this.hpLabelX = W - 300;
    this.add.text(this.hpLabelX, 5, 'HEALTH', LABEL).setDepth(10);
    this.hudPips = this.add.graphics().setDepth(10);
    this.maxHp = maxHp;
    this.hudPipX = this.hpLabelX + 2;

    this.add.text(W - 16, 5, 'LIVES', LABEL).setOrigin(1, 0).setDepth(10);
    this.hudLives = this.add.text(W - 16, 16, '', VALUE).setOrigin(1, 0).setDepth(10);
  }

  updateHud(sim) {
    const n = this.cfg.waves.length;
    this.hudScore.setText(`${sim.score}`);
    this.hudWave.setText(`${Math.min(sim.waveIndex + 1, n)} / ${n}`);
    this.hudLives.setText(`${sim.player.lives}`);
    const hp = Math.max(sim.player.hp, 0);
    this.hudPips.clear();
    for (let i = 0; i < this.maxHp; i++) {
      const cx = this.hudPipX + i * 16 + 5;
      const cy = 27;
      if (i < hp) {
        this.hudPips.fillStyle(CRIMSON, 1).fillCircle(cx, cy, 5);
        this.hudPips.fillStyle(0xffffff, 0.35).fillCircle(cx - 1, cy - 1, 2);
      } else {
        this.hudPips.lineStyle(1, 0x3a4670, 1).strokeCircle(cx, cy, 4);
      }
    }
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
    const W = this.cfg.world.width;
    const H = this.cfg.world.height;
    const pw = Math.max(380, this.overlayText.width + 72);
    const ph = this.overlayText.height + 56;
    const x = W / 2 - pw / 2;
    const y = H / 2 - ph / 2;
    this.overlayPanel.clear()
      .fillStyle(0x0b1020, 0.94).fillRoundedRect(x, y, pw, ph, 14)
      .lineStyle(2, AMBER, 0.9).strokeRoundedRect(x, y, pw, ph, 14);
    this.overlay.setVisible(true).setAlpha(0);
    this.tweens.add({ targets: this.overlay, alpha: 1, duration: 220, ease: 'Quad.easeOut' });
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
      targets: ring, alpha: 0, scale: 1.15, duration: 220, ease: 'Cubic.easeOut',
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
          count: 12, speedMin: 40, speedMax: 170, lifespan: 380,
          colors: e.kind === 'heal' ? [0xff7d8a, 0xffffff] : [0xffd479, 0xffffff],
          gravityY: -40, scale: 1.1,
        });
        if (e.kind !== 'heal') {
          popup(this, p.x, p.y - 30, `+${this.cfg.pickups?.bonusScore ?? 50}`, {
            color: '#ffd479', size: '15px',
          });
        } else {
          popup(this, p.x, p.y - 30, '+HP', { color: '#ff7d8a', size: '15px' });
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
    this.updateHud(sim);
    this.debug.update(`wave ${sim.waveIndex + 1} foes ${sim.enemies.length}`);
  }

  popIn(img, scale) {
    img.setScale(0);
    this.tweens.add({ targets: img, scale, duration: 240, ease: 'Back.easeOut' });
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
        img = fitImage(this.add.image(e.x, e.y, key).setDepth(5), key, e.isBoss ? 1.8 : 1);
        this.popIn(img, img.scaleX);
        this.enemyImgs.set(e.uid, img);
        this.enemyHp.set(e.uid, e.hp);
      }
      const prevHp = this.enemyHp.get(e.uid);
      const struck = prevHp !== undefined && e.hp < prevHp;
      this.enemyHp.set(e.uid, e.hp);
      img.setPosition(e.x, e.y);
      img.setRotation(Math.atan2(p.y - e.y, p.x - e.x) + Math.PI / 2);
      if (e.hp < e.maxHp) img.setTint(0xff9a9a);
      else img.clearTint();
      if (struck) {
        // Impact: white flash (after the damage tint, so it is visible) plus sparks.
        hitFlash(this, img, 0xffffff, 70);
        burst(this, e.x, e.y, {
          count: 6, speedMin: 40, speedMax: 160, lifespan: 260,
          colors: [0xffffff, 0xffb347], gravityY: 0, scale: 1.0,
        });
      }
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
        this.enemyHp.delete(uid);
      }
    }

    while (this.pickupImgs.length < sim.pickups.length) {
      const img = fitImage(this.add.image(-100, -100, 'pickup').setDepth(5), 'pickup');
      this.pickupImgs.push(img);
      this.popIn(img, img.scaleX);
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
