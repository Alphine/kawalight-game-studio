// Game screen: HUD, pause/game-over/stage-clear overlays. Thin view over the
// pure simulation in logic.js: input in, step, sync sprites, play sounds.
// Restart uses scene.restart(): no global listeners, so nothing duplicates.

import { createGame, stepGame, pauseGame, resumeGame } from '../logic.js';
// Runtime imports resolve in the staged/exported layout (js/game/scenes -> js/runtime).
import { readInput } from '../../runtime/input.js';
import { createStore } from '../../runtime/store.js';
import { createAudio } from '../../runtime/audio.js';
import { createDebug } from '../../runtime/debug.js';
import { burst, shake, flash, popup } from '../../runtime/juice.js';
import { createBackdrop, SPARK_KEY, HALO_KEY, IMPACT_KEY } from './backdrop.js';
import { COLOR, HEX, FONT, drawPanel, drawRule } from './ui.js';

// Sprites are generated at 128px; these are the on-screen sizes (px) that
// match the simulation radii (player 12, enemies 14, pickups 12+12).
const PLAYER_PX = 46;
const ENEMY_PX = 42;
const SHOT_PX = 30;
const PICKUP_PX = 30;

function fitScale(img, px) {
  return px / Math.max(img.width, img.height);
}

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
    this.W = W;
    this.H = H;

    this.backdrop = createBackdrop(this, W, H);
    this.cameras.main.fadeIn(250, 5, 7, 15);
    this.typeToKey = new Map(config.enemies.map((e) => [e.id, e.sprite]));

    // Player, engine glow and pools.
    this.playerImg = this.add.image(config.player.x, config.player.y, 'player')
      .setScale(1).setDepth(6);
    this.playerImg.setScale(fitScale(this.playerImg, PLAYER_PX));
    this.prevPlayerY = config.player.y;
    this.thrust = this.add.particles(0, 0, SPARK_KEY, {
      speed: { min: 60, max: 140 },
      angle: { min: 168, max: 192 },
      lifespan: 240,
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: [0x7fd4ff, 0x3da9ff, 0xffffff],
      frequency: 26,
      blendMode: 'ADD',
    }).setDepth(5);
    this.thrust.startFollow(this.playerImg, -20, 0);
    this.thrustOn = true;

    this.shotImgs = [];
    for (let i = 0; i < config.weapon.poolSize; i++) {
      const img = this.add.image(-100, -100, 'shot').setDepth(5).setVisible(false);
      img.setScale(fitScale(img, SHOT_PX));
      this.shotImgs.push(img);
    }
    this.enemyImgs = new Map();
    this.pickupPool = [];
    // Kill gains queued by handleEvents, paired with explosion positions when
    // the enemy sprite is destroyed in syncSprites (logic emits no positions).
    this.pendingKills = [];
    this.lastScore = -1;

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

    this.buildHud(W, H, config);
    this.buildOverlay(W, H);
  }

  buildHud(W, H, config) {
    // Top bar: score (left), wave (centre), shield pips and lives (right).
    const bar = this.add.graphics().setDepth(20);
    bar.fillStyle(COLOR.ink, 0.8);
    bar.fillRect(0, 0, W, 40);
    drawRule(bar, 0, 40, W, COLOR.cyan, 0.45);

    this.add.text(16, 5, 'SCORE', {
      fontFamily: FONT.ui, fontSize: '10px', color: HEX.dim,
    }).setDepth(21).setLetterSpacing(2);
    this.hudScore = this.add.text(16, 16, '0', {
      fontFamily: FONT.mono, fontSize: '19px', fontStyle: 'bold', color: HEX.text,
    }).setDepth(21).setOrigin(0, 0);

    this.hudWave = this.add.text(W / 2, 11, '', {
      fontFamily: FONT.mono, fontSize: '15px', fontStyle: 'bold', color: HEX.cyan,
    }).setDepth(21).setOrigin(0.5, 0);

    // Right cluster, laid out right to left.
    const maxHp = config.player.health;
    const maxLives = config.player.lives;
    let rx = W - 16;
    this.lifeIcons = [];
    for (let i = 0; i < maxLives; i++) {
      const icon = this.add.image(rx - 9, 20, 'player').setDepth(21);
      icon.setScale(fitScale(icon, 18));
      this.lifeIcons.unshift(icon);
      rx -= 24;
    }
    this.add.text(rx - 2, 14, 'LIVES', {
      fontFamily: FONT.ui, fontSize: '10px', color: HEX.dim,
    }).setDepth(21).setOrigin(1, 0).setLetterSpacing(2);
    rx -= 58;
    this.pipGfx = this.add.graphics().setDepth(21);
    this.pipRects = [];
    for (let i = 0; i < maxHp; i++) {
      this.pipRects.unshift({ x: rx - 14, y: 15, w: 14, h: 10 });
      rx -= 19;
    }
    this.add.text(rx - 2, 14, 'SHIELD', {
      fontFamily: FONT.ui, fontSize: '10px', color: HEX.dim,
    }).setDepth(21).setOrigin(1, 0).setLetterSpacing(2);

    // Sector progress along the bottom edge.
    this.progressGfx = this.add.graphics().setDepth(21);
  }

  buildOverlay(W, H) {
    this.overlay = this.add.container(0, 0).setDepth(50).setVisible(false);
    const dim = this.add.rectangle(0, 0, W, H, 0x03050c, 0.72).setOrigin(0, 0);
    this.overlayBox = this.add.container(W / 2, H / 2);

    const pw = 430;
    const ph = 236;
    const box = this.add.graphics();
    drawPanel(box, -pw / 2, -ph / 2, pw, ph, { radius: 18 });
    this.ovTitle = this.add.text(0, -ph / 2 + 44, '', {
      fontFamily: FONT.ui, fontSize: '36px', fontStyle: 'bold', color: HEX.text,
      stroke: '#06142e', strokeThickness: 6,
    }).setOrigin(0.5).setLetterSpacing(2);
    const rule = this.add.graphics();
    drawRule(rule, -120, -ph / 2 + 74, 240, COLOR.gold, 0.6);
    this.ovBody = this.add.text(0, -16, '', {
      fontFamily: FONT.mono, fontSize: '18px', color: HEX.text, align: 'center',
      lineSpacing: 8,
    }).setOrigin(0.5);
    this.ovHint = this.add.text(0, ph / 2 - 34, '', {
      fontFamily: FONT.mono, fontSize: '12px', color: HEX.dim, align: 'center',
    }).setOrigin(0.5);

    this.overlayBox.add([box, this.ovTitle, rule, this.ovBody, this.ovHint]);
    this.overlay.add([dim, this.overlayBox]);
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
      this.showOverlay({
        title: 'PAUSED',
        titleColor: HEX.cyan,
        body: 'MOVE  WASD / ARROWS\nFIRE  SPACE / Z',
        hint: 'P resume    R restart    T title',
      });
    } else if (this.sim.phase === 'paused') {
      resumeGame(this.sim);
      this.overlay.setVisible(false);
    }
  }

  showOverlay({ title, titleColor = HEX.text, body = '', hint = '' }) {
    this.ovTitle.setText(title).setColor(titleColor);
    this.ovBody.setText(body);
    this.ovHint.setText(hint);
    this.overlay.setVisible(true);
    this.overlayBox.setScale(0.9).setAlpha(0);
    this.tweens.add({
      targets: this.overlayBox, scale: 1, alpha: 1, duration: 280, ease: 'Back.easeOut',
    });
  }

  saveHi() {
    if (this.hiSaved) return;
    this.hiSaved = true;
    const hi = this.store.get('hiscore', 0);
    if (this.sim.score > hi) this.store.set('hiscore', this.sim.score);
  }

  sparks(x, y, opts = {}) {
    return burst(this, x, y, { texture: SPARK_KEY, ...opts });
  }

  // Solid-colour flash (tint multiplies, so white and light tints would do nothing).
  silhouette(img, color, ms) {
    if (!img || !img.active) return;
    img.setTintFill(color);
    this.time.delayedCall(ms, () => {
      if (img.active) img.clearTint();
    });
  }

  // Expanding ring at a kill site (eased, self-destroying).
  ring(x, y, color = COLOR.gold, radius = 14) {
    const g = this.add.graphics().setDepth(38).setPosition(x, y);
    g.lineStyle(3, color, 0.9);
    g.strokeCircle(0, 0, radius);
    this.tweens.add({
      targets: g, scale: 2.6, alpha: 0, duration: 340, ease: 'Cubic.easeOut',
      onComplete: () => g.destroy(),
    });
  }

  handleEvents(events) {
    const p = this.sim.player;
    // Hurt/respawn events arrive after the ship was reset in logic, so the
    // on-screen sprite (still at the pre-hit position) is the impact point.
    const hitX = this.playerImg.x;
    const hitY = this.playerImg.y;
    for (const e of events) {
      if (e.type === 'shot') {
        this.audio.shoot(p.power);
        this.sparks(this.playerImg.x + 20, this.playerImg.y, {
          count: 3, speedMin: 30, speedMax: 110, lifespan: 160, scale: 0.9,
          colors: [0x7fd4ff, 0xffffff], gravityY: 0,
        });
      } else if (e.type === 'kill') {
        this.audio.boom(e.boss);
        this.pendingKills.push({ gain: e.score, boss: e.boss });
      } else if (e.type === 'hurt') {
        this.audio.hurt();
        this.hurtTick = true; // a crasher sprite dies this sync: no popup pairing
        flash(this, 140, 255, 60, 60);
        shake(this, 160, 0.012);
        this.sparks(hitX, hitY, {
          count: 16, speedMin: 60, speedMax: 280, lifespan: 450,
          colors: [0xff6b8a, 0xffb347, 0xffffff], scale: 1.5,
        });
        this.silhouette(this.playerImg, 0xff6b8a, 140);
      } else if (e.type === 'life-lost') {
        popup(this, this.W / 2, this.H / 2 - 40, `-1 LIFE  (${e.lives} left)`, {
          color: HEX.rose, size: '22px', rise: 40, duration: 1200,
        });
      } else if (e.type === 'pickup') {
        this.audio.pickup();
        const power = e.kind === 'power';
        this.sparks(this.playerImg.x, this.playerImg.y, {
          count: 10, speedMin: 40, speedMax: 170, lifespan: 380,
          colors: power ? [0x7fd4ff, 0xffffff] : [0xffd479, 0xffffff],
          gravityY: 60, scale: 1.1,
        });
        popup(this, this.playerImg.x, this.playerImg.y - 26,
          power ? 'POWER UP' : `+${this.cfg.pickups?.powerupBonus ?? 50}`, {
            color: power ? HEX.cyan : HEX.gold, size: '14px',
          });
      } else if (e.type === 'wave-clear') {
        popup(this, this.W / 2, 120, `WAVE ${e.wave} CLEAR`, {
          color: HEX.cyan, size: '22px', rise: 26, duration: 1000,
        });
      } else if (e.type === 'victory') {
        this.audio.win();
        this.saveHi();
        flash(this, 180);
        this.showOverlay({
          title: 'SECTOR CLEAR',
          titleColor: HEX.gold,
          body: `SCORE  ${e.score}\nBEST   ${this.store.get('hiscore', 0)}`,
          hint: 'R play again    T title',
        });
      } else if (e.type === 'gameover') {
        this.audio.boom(true);
        this.saveHi();
        shake(this, 260, 0.022);
        flash(this, 200, 255, 60, 60);
        this.sparks(hitX, hitY, {
          count: 26, speedMin: 80, speedMax: 360, lifespan: 650,
          colors: [0xff6b8a, 0xffb347, 0xffffff], scale: 1.8,
        });
        this.showOverlay({
          title: 'GAME OVER',
          titleColor: HEX.rose,
          body: `SCORE  ${e.score}\nBEST   ${this.store.get('hiscore', 0)}`,
          hint: 'R restart    T title',
        });
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
    }
    this.backdrop.update(delta, sim.phase === 'playing' ? 1 : 0);
    this.syncSprites(time);
    this.syncHud();
    this.debug.update(`wave ${sim.waveIndex + 1} foes ${sim.enemies.length}`);
  }

  syncHud() {
    const sim = this.sim;
    const cfg = this.cfg;
    const n = cfg.waves.length;

    if (sim.score !== this.lastScore) {
      if (this.lastScore >= 0) {
        this.tweens.add({
          targets: this.hudScore, scale: { from: 1.22, to: 1 }, duration: 220,
          ease: 'Back.easeOut',
        });
      }
      this.lastScore = sim.score;
      this.hudScore.setText(String(sim.score));
    }

    this.hudWave.setText(`WAVE ${Math.min(sim.waveIndex + 1, n)} / ${n}`);

    const hp = Math.max(sim.player.hp, 0);
    this.pipGfx.clear();
    this.pipRects.forEach((r, i) => {
      const on = i < hp;
      this.pipGfx.fillStyle(on ? COLOR.cyan : 0x1d2a52, on ? 0.95 : 0.9);
      this.pipGfx.fillRoundedRect(r.x, r.y, r.w, r.h, 2);
    });
    this.lifeIcons.forEach((icon, i) => {
      icon.setVisible(i < sim.player.lives);
    });

    this.progressGfx.clear();
    const frac = Math.min(sim.waveIndex, n) / n;
    this.progressGfx.fillStyle(0x1d2a52, 0.9);
    this.progressGfx.fillRect(0, this.H - 4, this.W, 4);
    this.progressGfx.fillStyle(COLOR.gold, 0.95);
    this.progressGfx.fillRect(0, this.H - 4, this.W * frac, 4);
  }

  syncSprites(time) {
    const sim = this.sim;
    const p = sim.player;
    // Ship: follows the sim, banks with vertical motion, blinks while invulnerable.
    this.playerImg.setPosition(p.x, p.y);
    const vy = p.y - this.prevPlayerY;
    this.prevPlayerY = p.y;
    const bank = Math.max(-14, Math.min(14, vy * 3));
    this.playerImg.setAngle(this.playerImg.angle + (bank - this.playerImg.angle) * 0.2);
    const blink = sim.timeMs < p.invulnUntil && sim.phase === 'playing';
    this.playerImg.setAlpha(blink ? (Math.sin(time / 60) > 0 ? 0.25 : 1) : 1);
    this.playerImg.setVisible(sim.phase !== 'gameover');
    if (this.thrustOn !== (sim.phase === 'playing')) {
      this.thrustOn = sim.phase === 'playing';
      if (this.thrustOn) this.thrust.start();
      else this.thrust.stop();
    }

    sim.shots.forEach((s, i) => {
      this.shotImgs[i].setVisible(s.active).setPosition(s.x, s.y);
    });

    const seen = new Set();
    for (const e of sim.enemies) {
      seen.add(e.uid);
      let img = this.enemyImgs.get(e.uid);
      if (!img) {
        const key = this.typeToKey.get(e.type) || 'player';
        img = this.add.image(e.x, e.y, key).setDepth(4);
        img.setScale(fitScale(img, ENEMY_PX) * (e.isBoss ? 1.8 : 1));
        img.kgsmHp = e.hp;
        this.enemyImgs.set(e.uid, img);
      }
      if (img.kgsmHp > e.hp) {
        // Non-lethal hit: white flash and a small spark puff.
        this.silhouette(img, 0xffffff, 70);
        this.sparks(img.x, img.y, {
          count: 5, speedMin: 40, speedMax: 140, lifespan: 220, scale: 1.0,
          colors: [0xffffff, 0x7fd4ff], gravityY: 0,
        });
        img.kgsmHp = e.hp;
      }
      img.setPosition(e.x, e.y);
      img.setAngle(Math.sin(time / 180 + e.uid) * 6);
    }
    for (const [uid, img] of this.enemyImgs) {
      if (!seen.has(uid)) {
        // On-screen removals are kills (off-screen exits sit near x <= -20):
        // explode where the sprite died and float its score gain.
        const W = this.cfg.world.width;
        const p2 = this.sim.player;
        const crashed = this.hurtTick
          && Math.hypot(img.x - p2.x, img.y - p2.y) < 70;
        if (crashed) this.hurtTick = false;
        if (img.x > -20 && img.x < W + 40 && this.sim.phase !== 'gameover') {
          // Crashers explode without consuming a shot-kill popup.
          const kill = crashed ? null : this.pendingKills.shift();
          const boss = !!kill?.boss;
          burst(this, img.x, img.y, {
            texture: SPARK_KEY,
            count: boss ? 24 : 14, speedMin: 60, speedMax: 260,
            lifespan: boss ? 600 : 450,
            colors: boss
              ? [0xff6b8a, 0xffb347, 0xffffff]
              : [0xff9f5a, 0xffe08a, 0xffffff],
            scale: boss ? 1.9 : 1.4,
          });
          this.ring(img.x, img.y, boss ? COLOR.rose : COLOR.gold, boss ? 30 : 16);
          if (this.textures.exists(IMPACT_KEY)) {
            const base = boss ? 1.6 : 0.9;
            const flashImg = this.add.image(img.x, img.y, IMPACT_KEY)
              .setDepth(7).setScale(base);
            this.tweens.add({
              targets: flashImg,
              scale: base * 1.8,
              alpha: 0,
              duration: boss ? 420 : 260,
              onComplete: () => flashImg.destroy(),
            });
          }
          if (kill) {
            popup(this, img.x, img.y - 18, `+${kill.gain}`, {
              color: HEX.gold, size: '14px',
            });
          }
        }
        // Off-screen exits (x <= -20) pair with nothing: kills always pair.
        img.destroy();
        this.enemyImgs.delete(uid);
      }
    }
    this.hurtTick = false;

    // Pickups: each pool entry is a glowing halo behind the orb. Power-ups
    // glow cyan, bonus orbs glow gold; a live entry scales in with Back.easeOut.
    while (this.pickupPool.length < sim.pickups.length) {
      const halo = this.add.image(-100, -100, HALO_KEY).setDepth(3).setVisible(false);
      const img = this.add.image(-100, -100, 'pickup').setDepth(4).setVisible(false);
      img.setScale(fitScale(img, PICKUP_PX));
      halo.setScale(fitScale(img, PICKUP_PX * 2.4));
      this.tweens.add({
        targets: halo, alpha: 0.55, duration: 520, yoyo: true, repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.pickupPool.push({ img, halo, live: false });
    }
    this.pickupPool.forEach((entry, i) => {
      const k = sim.pickups[i];
      entry.img.setVisible(!!k);
      entry.halo.setVisible(!!k);
      if (!k) {
        entry.live = false;
        return;
      }
      entry.img.setPosition(k.x, k.y);
      entry.halo.setPosition(k.x, k.y);
      entry.halo.setTint(k.kind === 'power' ? COLOR.cyan : COLOR.gold);
      if (!entry.live) {
        entry.live = true;
        const base = fitScale(entry.img, PICKUP_PX);
        entry.img.setScale(0);
        this.tweens.add({
          targets: entry.img, scale: base, duration: 260, ease: 'Back.easeOut',
        });
      }
    });
  }
}
