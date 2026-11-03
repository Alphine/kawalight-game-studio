// Game screen: HUD, pause/win/game-over overlays. Thin view over the
// pure simulation in logic.js: input in, step, sync sprites, play sounds.
// Restart uses scene.restart(): no global listeners, so nothing duplicates.

import { createGame, stepGame, pauseGame, resumeGame, suggestInput } from '../logic.js';
// Runtime imports resolve in the staged/exported layout (js/game/scenes -> js/runtime).
import { createStore } from '../../runtime/store.js';
import { createAudio } from '../../runtime/audio.js';
import { createDebug } from '../../runtime/debug.js';
import { burst, shake, flash, hitFlash, popup } from '../../runtime/juice.js';
import { framePanel, textStyle } from '../ui.js';

// Generated art is drawn at the logical hitbox height, feet-anchored, so the
// picture sits exactly on the collision box. Coins use their 20px pickup size.
const COIN_H = 20;
const CHECKPOINT_H = 48;

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  create() {
    const { config, seed, debug, demoInput } = this.game.registry.get('kgsm');
    this.cfg = config;
    this.demoInput = demoInput;
    this.sim = createGame(config, { seed });
    this.store = createStore('side-scroller');
    this.audio = createAudio();
    this.debug = createDebug(this, debug);
    const W = config.world.width;
    const H = config.world.height;

    this.cameras.main.setBackgroundColor('#0d1626');
    this.cameras.main.setBounds(0, 0, config.world.levelWidth, config.world.levelHeight);

    // Parallax backdrop, far to near: haze, ridge, hills.
    this.clouds = this.add.tileSprite(0, 0, W, H, 'clouds')
      .setOrigin(0, 0).setAlpha(0.7).setScrollFactor(0.1);
    this.ridge = this.add.tileSprite(0, H - 250, W, 150, 'ridge')
      .setOrigin(0, 0).setAlpha(0.9).setScrollFactor(0.2);
    this.hills = this.add.tileSprite(0, H - 190, W, 120, 'hills')
      .setOrigin(0, 0).setScrollFactor(0.35);

    // Static level geometry: one tileSprite per platform.
    for (const q of config.level.platforms) {
      this.add.tileSprite(q.x, q.y, q.w, q.h, q.oneWay ? 'oneway' : 'brick')
        .setOrigin(0, 0);
    }
    // Exit door + checkpoints.
    const ex = config.level.exit;
    this.exitImg = this.artImage(ex.sprite || 'exit-door',
      ex.x + ex.w / 2, ex.y + ex.h, ex.h);
    this.checkpointImgs = new Map();
    for (const cp of config.level.checkpoints) {
      const img = this.artImage('checkpoint', cp.x + cp.w / 2, cp.y + cp.h, CHECKPOINT_H)
        .setAlpha(0.45);
      this.checkpointImgs.set(cp.id, img);
    }
    // Static hazards.
    for (const hz of config.level.hazards) {
      this.artImage(hz.sprite, hz.x + hz.w / 2, hz.y + hz.h, hz.h);
    }

    // Player (feet-anchored) + enemy/coin pools.
    const p = config.player;
    this.playerImg = this.artImage('player',
      p.spawn.x + p.width / 2, p.spawn.y + p.height, p.height);
    this.enemyImgs = new Map();
    this.coinImgs = new Map();
    this.enemySprites = new Map(config.level.enemies.map((e) => [e.id, e.sprite]));
    this.enemyHeights = new Map(config.level.enemies.map((e) => [e.id, e.h]));

    // Camera follows the runner with a configured deadzone + lerp.
    const cam = config.camera;
    this.cameras.main.startFollow(this.playerImg, false, cam.followLerp, cam.followLerp);
    this.cameras.main.setDeadzone(cam.deadzoneX, cam.deadzoneY);

    // Keys by name (config keys + fallbacks + overlay keys).
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const names = new Set([
      ...Object.values(config.controls), 'UP', 'DOWN', 'LEFT', 'RIGHT',
      'W', 'A', 'S', 'D', 'SPACE', 'Z', 'ESC', 'R', 'T', 'P',
    ]);
    this.keymap = {};
    for (const name of names) {
      if (KC[name]) this.keymap[name] = this.input.keyboard.addKey(KC[name]);
    }

    // HUD (fixed to the camera): a slim top bar with an amber keyline.
    const bar = this.add.graphics().setDepth(9).setScrollFactor(0);
    bar.fillStyle(0x0d1626, 0.72);
    bar.fillRect(0, 0, W, 36);
    bar.fillStyle(0xffd479, 0.6);
    bar.fillRect(0, 36, W, 2);
    this.hudLeft = this.add.text(16, 9, '', textStyle('body', { fontSize: '17px' }))
      .setDepth(10).setScrollFactor(0);
    this.hudRight = this.add.text(W - 16, 9, '', textStyle('body', { fontSize: '17px' }))
      .setOrigin(1, 0).setDepth(10).setScrollFactor(0);

    // Overlay (shared by pause / win / game over): dim + framed message panel.
    this.overlay = this.add.container(0, 0).setDepth(50).setVisible(false).setScrollFactor(0);
    const dim = this.add.rectangle(0, 0, W, H, 0x04060d, 0.7).setOrigin(0, 0);
    this.overlayPanel = framePanel(this, W / 2, H / 2, 480, 250, { depth: 51 });
    this.overlayText = this.add.text(W / 2, H / 2, '', textStyle('body', {
      fontSize: '20px', align: 'center', lineSpacing: 8,
    })).setOrigin(0.5).setDepth(52);
    this.overlay.add([dim, this.overlayPanel, this.overlayText]);
    this.hiSaved = false;
  }

  // Places a generated sprite with its feet at (x, y), scaled to height h.
  artImage(key, x, y, h) {
    const img = this.add.image(x, y, key).setOrigin(0.5, 1);
    const scale = h / img.height;
    img.setScale(scale);
    img.setData('base', scale);
    return img;
  }

  // Eased squash-and-stretch around the sprite's base scale.
  squash(img, sx, sy, ms) {
    if (!img || !img.active) return;
    const base = img.getData('base') ?? img.scaleX;
    this.tweens.killTweensOf(img);
    img.setScale(base * sx, base * sy);
    this.tweens.add({
      targets: img, scaleX: base, scaleY: base, duration: ms,
      ease: 'Back.easeOut',
    });
  }

  // Removes a sprite with a short eased fade (used for coins and defeated foes).
  vanish(img, { grow = 1.6, squashY = 0.2, ms = 180 } = {}) {
    if (!img || !img.active) return;
    const base = img.getData('base') ?? img.scaleX;
    this.tweens.killTweensOf(img);
    this.tweens.add({
      targets: img,
      scaleX: base * grow,
      scaleY: base * squashY,
      alpha: 0,
      duration: ms,
      ease: 'Cubic.easeOut',
      onComplete: () => img.destroy(),
    });
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

  readSideInput() {
    const c = this.cfg.controls;
    return {
      left: this.down(c.left, 'LEFT', 'A'),
      right: this.down(c.right, 'RIGHT', 'D'),
      jump: this.down(c.jump, 'UP', 'W', 'SPACE', 'Z'),
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
    this.overlayPanel.setAlpha(0);
    this.overlayText.setAlpha(0);
    this.tweens.add({
      targets: [this.overlayPanel, this.overlayText], alpha: 1,
      duration: 240, ease: 'Cubic.easeOut',
    });
  }

  saveHi() {
    if (this.hiSaved) return this.store.get('hiscore', { score: 0 });
    this.hiSaved = true;
    const hi = this.store.get('hiscore', { score: 0, timeSec: 0 });
    const best = {
      score: Math.max(hi.score || 0, this.sim.score),
      timeSec: this.sim.winTimeSec
        ? Math.min(hi.timeSec || Infinity, this.sim.winTimeSec)
        : (hi.timeSec || 0),
    };
    if (best.timeSec === Infinity) best.timeSec = this.sim.winTimeSec || 0;
    this.store.set('hiscore', best);
    return best;
  }

  playerCenter() {
    const p = this.cfg.player;
    const pl = this.sim.player;
    return { x: pl.x + p.width / 2, y: pl.y + p.height / 2 };
  }

  handleEvents(events) {
    for (const e of events) {
      const at = this.playerCenter();
      if (e.type === 'jump') {
        this.squash(this.playerImg, 0.88, 1.14, 160);
        burst(this, at.x, at.y + this.cfg.player.height / 2, {
          count: 6, speedMin: 30, speedMax: 120, lifespan: 300,
          colors: [0x8b94b3, 0xcfd6ea], scale: 1.0,
        });
      } else if (e.type === 'coin') {
        this.audio.pickup();
        burst(this, at.x, at.y, {
          count: 10, speedMin: 40, speedMax: 170, lifespan: 380,
          colors: [0xffd479, 0xfff3c4, 0x5fd08a], gravityY: 200, scale: 1.2,
        });
        popup(this, at.x, at.y - 30, `+${this.cfg.scoring.coinScore}`, {
          color: '#ffd479', size: '15px',
        });
      } else if (e.type === 'checkpoint') {
        this.audio.win();
        const img = this.checkpointImgs.get(e.id);
        if (img) {
          img.setAlpha(1);
          this.squash(img, 1.25, 0.8, 260);
        }
        popup(this, at.x, at.y - 40, 'CHECKPOINT', {
          color: '#7fd4ff', size: '16px', rise: 30, duration: 900,
        });
      } else if (e.type === 'stomp') {
        this.audio.boom(false);
        burst(this, at.x, at.y + 20, {
          count: 12, speedMin: 60, speedMax: 240, lifespan: 400,
          colors: [0xffb347, 0xffffff], scale: 1.4,
        });
        popup(this, at.x, at.y - 30, `+${this.cfg.scoring.stompScore}`, {
          color: '#ffb347', size: '15px',
        });
      } else if (e.type === 'hurt') {
        this.audio.hurt();
        shake(this, 180, 0.012);
        flash(this, 150, 255, 60, 60);
        hitFlash(this, this.playerImg, 0xff5a5a, 200);
      } else if (e.type === 'respawn') {
        this.audio.hurt();
        flash(this, 150, 255, 60, 60);
        popup(this, at.x, at.y - 40, 'OUCH!', {
          color: '#ff8f8f', size: '18px', rise: 30, duration: 800,
        });
      } else if (e.type === 'win') {
        this.audio.win();
        const best = this.saveHi();
        burst(this, at.x, at.y, {
          count: 30, speedMin: 80, speedMax: 360, lifespan: 800,
          colors: [0x5fd08a, 0xffd479, 0xffffff], scale: 1.8,
        });
        this.showOverlay(
          `LEVEL CLEAR!\n\nSCORE  ${e.score}  (+${e.bonus} bonus)`
          + `\nTIME  ${e.timeSec}s   COINS  ${e.coins}`
          + `\nBEST  ${best.score} PTS\n\nR restart · T title`);
      } else if (e.type === 'gameover') {
        this.audio.hurt();
        this.audio.boom(true);
        const best = this.saveHi();
        shake(this, 220, 0.02);
        flash(this, 200, 255, 60, 60);
        burst(this, at.x, at.y, {
          count: 22, speedMin: 80, speedMax: 340, lifespan: 600,
          colors: [0xff5a5a, 0xffb347, 0xffffff], scale: 1.8,
        });
        hitFlash(this, this.playerImg, 0xff5a5a, 200);
        this.showOverlay(
          `GAME OVER\n\nSCORE  ${e.score}   COINS  ${e.coins}`
          + `\nBEST  ${best.score} PTS\n\nR restart · T title`);
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
        : this.readSideInput();
      this.handleEvents(stepGame(sim, this.cfg, input, delta));
    }
    this.syncSprites(time);
    const hearts = '♥'.repeat(Math.max(0, sim.player.health))
      + '♡'.repeat(Math.max(0, this.cfg.player.health - sim.player.health));
    const timeSec = Math.floor(sim.timeMs / 1000);
    this.hudLeft.setText(`${hearts}   COINS ${sim.coins}   SCORE ${sim.score}`);
    const hi = this.store.get('hiscore', { score: 0 });
    this.hudRight.setText(`TIME ${timeSec}s   BEST ${Math.max(hi.score || 0, sim.score)}`);
    this.debug.update(`x ${Math.round(sim.player.x)} hp ${sim.player.health} ${sim.phase}`);
  }

  syncSprites(time) {
    const sim = this.sim;
    const p = this.cfg.player;
    const pl = sim.player;
    this.playerImg.setPosition(pl.x + p.width / 2, pl.y + p.height);
    // Art faces right, so flip when running left.
    this.playerImg.setFlipX(pl.facing < 0);
    if (sim.phase === 'gameover') {
      this.playerImg.setRotation(-1.35);
    } else {
      this.playerImg.setRotation(pl.grounded ? 0
        : Math.max(-0.3, Math.min(0.35, -pl.vy / 2800)));
    }
    // Blink while invulnerable.
    this.playerImg.setAlpha(sim.phase === 'playing' && pl.invuln > 0
      ? (Math.floor(time / 90) % 2 === 0 ? 0.35 : 1)
      : 1);

    // Exit glow pulse, eased around its base scale.
    const exitBase = this.exitImg.getData('base');
    this.exitImg.setScale(exitBase * (1 + 0.03 * Math.sin(time / 300)));

    const seenEnemies = new Set();
    for (const e of sim.enemies) {
      if (!e.alive) continue;
      seenEnemies.add(e.uid);
      let img = this.enemyImgs.get(e.uid);
      if (!img) {
        const key = this.enemySprites.get(e.id) || 'walker';
        img = this.artImage(key, e.x, e.y, this.enemyHeights.get(e.id) || e.h);
        this.enemyImgs.set(e.uid, img);
      }
      img.setPosition(e.x + e.w / 2, e.y + e.h);
      // Art faces right: flip when patrolling left.
      img.setFlipX(e.dir < 0);
    }
    for (const [uid, img] of this.enemyImgs) {
      if (!seenEnemies.has(uid)) {
        this.vanish(img, { grow: 1.3, squashY: 0.15, ms: 160 });
        this.enemyImgs.delete(uid);
      }
    }

    const seenCoins = new Set();
    for (const cn of sim.collectibles) {
      if (cn.taken) continue;
      seenCoins.add(cn.uid);
      let img = this.coinImgs.get(cn.uid);
      if (!img) {
        img = this.add.image(cn.x, cn.y, 'coin');
        img.setScale(COIN_H / img.height);
        img.setData('base', COIN_H / img.height);
        this.coinImgs.set(cn.uid, img);
      }
      img.setPosition(cn.x, cn.y);
      // Coin spin: horizontal shimmer around the base scale.
      const base = img.getData('base');
      img.setScale(base * (0.35 + 0.65 * Math.abs(Math.cos(time / 160 + cn.uid))), base);
    }
    for (const [uid, img] of this.coinImgs) {
      if (!seenCoins.has(uid)) {
        this.vanish(img, { grow: 1.8, squashY: 1.8, ms: 200 });
        this.coinImgs.delete(uid);
      }
    }
  }
}
