// Simulation unit tests (battle-2d acceptance + NFR-004 determinism).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, stepGame, pauseGame, resumeGame, suggestInput, summarize,
} from '../src/logic.js';

function testConfig() {
  return {
    seed: 7,
    world: { width: 480, height: 360 },
    player: {
      x: 240, y: 180, speed: 200, health: 3, lives: 2,
      invulnerableMs: 500, radius: 10,
      bounds: { minX: 20, maxX: 460, minY: 20, maxY: 340 },
    },
    melee: { cooldownMs: 200, damage: 2, range: 60 },
    ranged: { cooldownMs: 100, projectileSpeed: 400, damage: 1, poolSize: 8, aimRange: 400 },
    foeShots: { poolSize: 8 },
    enemies: [
      {
        id: 'mite', sprite: 'enemy-mite', health: 2, speed: 60, damage: 1,
        score: 100, radius: 10, behavior: { type: 'chaser' },
      },
      {
        id: 'skitter', sprite: 'enemy-skitter', health: 1, speed: 90, damage: 1,
        score: 150, radius: 9,
        behavior: { type: 'weaver', amplitude: 0.9, frequencyHz: 2 },
      },
      {
        id: 'spitter', sprite: 'enemy-spitter', health: 2, speed: 50, damage: 1,
        score: 250, radius: 10,
        behavior: {
          type: 'shooter', preferredRange: 160, fireRange: 300,
          fireIntervalMs: 400, projectileSpeed: 200,
        },
      },
    ],
    waves: [{ id: 'wave-1', delayAfterPrevMs: 0, boss: null,
      spawns: [{ enemyId: 'mite', count: 2, intervalMs: 100 }] }],
    boss: null,
    spawning: { minDistFromPlayer: 60 },
    pickups: { dropChance: 0, healAmount: 1, bonusScore: 50, ttlMs: 5000 },
    scoring: { killMultiplier: 1, waveClearBonus: 25 },
    difficulty: { preset: 'normal', enemyHealthScalePerWave: 0, enemySpeedScalePerWave: 0 },
    controls: { up: 'W', down: 'S', left: 'A', right: 'D', fire: 'SPACE', melee: 'J', pause: 'P' },
    victory: { afterWave: 1 },
    assets: { sprites: { player: 'assets/player.png' } },
  };
}

const IDLE = { up: false, down: false, left: false, right: false, fire: false, melee: false };
function run(state, config, ticks, input = IDLE, dt = 16) {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...stepGame(state, config, input, dt));
  return events;
}

function parkedFoe(state, over = {}) {
  const e = {
    uid: 900 + state.tick + state.enemies.length, type: 'mite',
    x: state.player.x + 200, y: state.player.y, t: 0, hp: 2, maxHp: 2,
    speed: 0, damage: 1, score: 100, radius: 10, behavior: 'chaser',
    amplitude: 0, frequencyHz: 0, preferredRange: 160, fireRange: 300,
    fireIntervalMs: 400, projectileSpeed: 200, fireAt: 1e12, strafeDir: 1,
    isBoss: false, ...over,
  };
  state.enemies.push(e);
  return e;
}

describe('movement', () => {
  it('moves and clamps to the arena bounds', () => {
    const config = testConfig();
    const s = createGame(config);
    // Freeze the arena: no chasers crashing the run, no wave-clear victory.
    s.enemies.length = 0;
    s.spawnQueue.length = 0;
    parkedFoe(s, { x: 400, y: 90, speed: 0 });
    run(s, config, 200, { ...IDLE, left: true, up: true });
    assert.equal(s.player.x, 20);
    assert.equal(s.player.y, 20);
    run(s, config, 400, { ...IDLE, right: true, down: true });
    assert.equal(s.player.x, 460);
    assert.equal(s.player.y, 340);
  });

  it('tracks facing along the last move direction', () => {
    const config = testConfig();
    const s = createGame(config);
    assert.deepEqual([s.player.fx, s.player.fy], [1, 0]);
    run(s, config, 5, { ...IDLE, up: true });
    assert.deepEqual([s.player.fx, s.player.fy], [0, -1]);
    run(s, config, 5, { ...IDLE, left: true, down: true });
    const inv = Math.SQRT1_2;
    assert.ok(Math.abs(s.player.fx + inv) < 1e-9);
    assert.ok(Math.abs(s.player.fy - inv) < 1e-9);
  });
});

describe('ranged attack', () => {
  it('respects cooldown and pool size', () => {
    const config = testConfig();
    const s = createGame(config);
    run(s, config, 10, { ...IDLE, fire: true }); // 160ms -> 2 volleys
    assert.equal(s.shotsFired, 2);
    assert.ok(s.shots.filter((x) => x.active).length <= config.ranged.poolSize);
    run(s, config, 500, { ...IDLE, fire: true });
    assert.ok(s.shots.filter((x) => x.active).length <= config.ranged.poolSize);
  });

  it('auto-aims at the nearest foe in range', () => {
    const config = testConfig();
    const s = createGame(config);
    parkedFoe(s, { x: s.player.x - 100, y: s.player.y, speed: 0 });
    parkedFoe(s, { x: s.player.x + 150, y: s.player.y, speed: 0 });
    run(s, config, 1, { ...IDLE, fire: true });
    const shot = s.shots.find((x) => x.active);
    assert.ok(shot);
    assert.ok(shot.vx < 0, 'shot should fly toward the nearer foe on the left');
    assert.equal(shot.vy, 0);
  });

  it('falls back to facing when no foe is in range', () => {
    const config = testConfig();
    config.ranged.aimRange = 10; // nothing to lock onto
    const s = createGame(config);
    // A parked foe keeps the arena non-empty so no victory triggers.
    s.enemies.length = 0;
    s.spawnQueue.length = 0;
    parkedFoe(s, { x: 60, y: 60, speed: 0 });
    run(s, config, 5, { ...IDLE, up: true }); // face up
    run(s, config, 1, { ...IDLE, fire: true });
    const shot = s.shots.find((x) => x.active);
    assert.ok(shot);
    assert.equal(shot.vx, 0);
    assert.ok(shot.vy < 0);
  });

  it('damages and kills foes for score', () => {
    const config = testConfig();
    const s = createGame(config);
    const e = parkedFoe(s, { x: s.player.x + 60, y: s.player.y, speed: 0 });
    run(s, config, 1, { ...IDLE, fire: true });
    const events = run(s, config, 30); // shot covers 60px in ~10 ticks
    assert.ok(e.dead || e.hp < 2, 'shot should have hit the parked foe');
    assert.ok(events.some((x) => x.type === 'hit' || x.type === 'kill'));
  });
});

describe('melee attack', () => {
  it('hits everything in range and respects cooldown', () => {
    const config = testConfig();
    const s = createGame(config);
    const near = parkedFoe(s, { x: s.player.x + 30, y: s.player.y, hp: 5, maxHp: 5 });
    const far = parkedFoe(s, { x: s.player.x + 200, y: s.player.y, hp: 5, maxHp: 5 });
    const events = run(s, config, 1, { ...IDLE, melee: true });
    assert.equal(s.meleeSwings, 1);
    assert.equal(near.hp, 3);
    assert.equal(far.hp, 5);
    assert.ok(events.some((x) => x.type === 'melee' && x.hits === 1));
    run(s, config, 5, { ...IDLE, melee: true }); // 80ms < 200ms cooldown
    assert.equal(s.meleeSwings, 1);
    run(s, config, 10, { ...IDLE, melee: true });
    assert.equal(s.meleeSwings, 2);
  });

  it('kills grant score and melee kill events', () => {
    const config = testConfig();
    const s = createGame(config);
    s.enemies.length = 0;
    s.spawnQueue.length = 0;
    parkedFoe(s, { x: s.player.x + 20, y: s.player.y, hp: 1, maxHp: 1 });
    const events = run(s, config, 1, { ...IDLE, melee: true });
    assert.equal(s.kills, 1);
    assert.ok(events.some((x) => x.type === 'kill'));
  });
});

describe('enemy behaviors', () => {
  it('chasers close in on the player', () => {
    const config = testConfig();
    const s = createGame(config);
    s.enemies.length = 0;
    s.spawnQueue.length = 0;
    const e = parkedFoe(s, { x: 60, y: 60, speed: 60, behavior: 'chaser' });
    const d0 = Math.hypot(e.x - s.player.x, e.y - s.player.y);
    run(s, config, 30);
    const d1 = Math.hypot(e.x - s.player.x, e.y - s.player.y);
    assert.ok(d1 < d0, `chaser did not approach (${d0} -> ${d1})`);
  });

  it('weavers advance with a sideways wobble', () => {
    const config = testConfig();
    const s = createGame(config);
    s.enemies.length = 0;
    s.spawnQueue.length = 0;
    const e = parkedFoe(s, {
      x: 60, y: 180, speed: 60, behavior: 'weaver',
      amplitude: 0.9, frequencyHz: 2,
    });
    run(s, config, 30);
    assert.ok(e.x > 60, 'weaver did not advance toward the player');
    assert.notEqual(e.y, 180);
  });

  it('shooters fire foe shots when the player is in range', () => {
    const config = testConfig();
    const s = createGame(config);
    s.enemies.length = 0;
    s.spawnQueue.length = 0;
    parkedFoe(s, {
      type: 'spitter', x: s.player.x + 120, y: s.player.y, speed: 0,
      behavior: 'shooter', preferredRange: 160, fireRange: 300,
      fireIntervalMs: 200, projectileSpeed: 200, fireAt: 0,
    });
    run(s, config, 5);
    const foe = s.foeShots.find((x) => x.active);
    assert.ok(foe, 'shooter fired no foe shot');
    assert.ok(foe.vx < 0, 'foe shot should fly toward the player');
  });

  it('shooters hold their preferred range', () => {
    const config = testConfig();
    const s = createGame(config);
    s.enemies.length = 0;
    s.spawnQueue.length = 0;
    const e = parkedFoe(s, {
      type: 'spitter', x: s.player.x + 40, y: s.player.y, speed: 60,
      behavior: 'shooter', preferredRange: 160, fireRange: 300,
      fireIntervalMs: 1e9, projectileSpeed: 200, fireAt: 1e12,
    });
    run(s, config, 30); // too close: backs away
    assert.ok(e.x > s.player.x + 40, 'shooter did not back away');
  });

  it('spawns ride the arena edges', () => {
    const config = testConfig();
    const s = createGame(config);
    const b = config.player.bounds;
    const nearEdge = (e, tol) => e.x <= b.minX + tol || e.x >= b.maxX - tol
      || e.y <= b.minY + tol || e.y >= b.maxY - tol;
    run(s, config, 1); // first mite spawns at 0ms
    assert.equal(s.enemies.length, 1);
    assert.ok(nearEdge(s.enemies[0], 30), 'first spawn should be at an edge');
    run(s, config, 30); // second mite spawned at 100ms
    assert.equal(s.enemies.length, 2);
    for (const e of s.enemies) {
      assert.ok(e.x >= b.minX && e.x <= b.maxX);
      assert.ok(e.y >= b.minY && e.y <= b.maxY);
    }
  });
});

describe('waves and scoring', () => {
  it('spawns per config and scores kills', () => {
    const config = testConfig();
    const s = createGame(config);
    run(s, config, 30); // both mites spawned (0ms + 100ms)
    assert.equal(s.enemies.length, 2);
    // Park a shot on each enemy to force kills.
    for (const e of s.enemies) {
      const shot = s.shots.find((x) => !x.active);
      shot.active = true;
      shot.x = e.x - 1;
      shot.y = e.y;
      shot.vx = 0;
      shot.vy = 0;
    }
    // Mites have 2 hp; melee (damage 2) finishes them in one swing.
    for (const e of s.enemies) {
      e.x = s.player.x + 20;
      e.y = s.player.y;
    }
    const events = run(s, config, 1, { ...IDLE, melee: true });
    assert.ok(events.some((e) => e.type === 'kill'));
    assert.equal(s.kills, 2);
    assert.equal(s.score, 200 + 25); // kills + wave-clear bonus
  });

  it('reaches stage-clear after the final wave', () => {
    const config = testConfig();
    const s = createGame(config);
    run(s, config, 30);
    for (const e of s.enemies) {
      const shot = s.shots.find((x) => !x.active);
      shot.active = true;
      shot.x = e.x;
      shot.y = e.y;
      shot.vx = 0;
      shot.vy = 0;
      e.hp = 1;
    }
    const events = run(s, config, 10);
    assert.equal(s.phase, 'stageclear');
    assert.ok(events.some((e) => e.type === 'victory'));
  });

  it('clamps afterWave past the wave list to victory instead of crashing', () => {
    const config = testConfig();
    config.victory.afterWave = 5; // schema-legal (minimum 1, no max)
    const s = createGame(config);
    run(s, config, 30);
    for (const e of s.enemies) {
      const shot = s.shots.find((x) => !x.active);
      shot.active = true;
      shot.x = e.x;
      shot.y = e.y;
      shot.vx = 0;
      shot.vy = 0;
      e.hp = 1;
    }
    const events = run(s, config, 10);
    assert.equal(s.phase, 'stageclear');
    assert.ok(events.some((e) => e.type === 'victory'));
  });

  it('spawns the boss with its wave', () => {
    const config = testConfig();
    config.boss = { enemyId: 'mite', waveId: 'wave-1', healthMultiplier: 4 };
    const s = createGame(config);
    run(s, config, 30);
    const boss = s.enemies.find((e) => e.isBoss);
    assert.ok(boss, 'boss never spawned');
    assert.equal(boss.maxHp, 8);
    assert.ok(boss.radius > 10);
  });
});

describe('damage and lives', () => {
  it('contact hurts, knocks the foe back, then costs a life', () => {
    const config = testConfig();
    const s = createGame(config);
    s.enemies.length = 0;
    s.spawnQueue.length = 0;
    const crash = () => {
      const before = s.enemies.length;
      parkedFoe(s, { x: s.player.x + 5, y: s.player.y, uid: 2000 + before + s.tick });
      run(s, config, 1);
    };
    crash(); // hp 3 -> 2, foe survives with knockback
    assert.equal(s.player.hp, 2);
    assert.equal(s.enemies.length, 1);
    assert.equal(s.phase, 'playing');
    crash(); // invulnerable: no damage
    assert.equal(s.player.hp, 2);
    run(s, config, 60); // 960ms > 500ms invuln
    // Walk the crowded-in foes away so only one crash lands per step.
    for (const e of s.enemies) {
      e.x = s.player.x + 200;
      e.y = s.player.y;
    }
    crash(); // hp 2 -> 1
    assert.equal(s.player.hp, 1);
    for (const e of s.enemies) {
      e.x = s.player.x + 200;
      e.y = s.player.y;
    }
    run(s, config, 60);
    crash(); // hp 1 -> 0 -> life lost, respawned
    assert.equal(s.player.lives, 1);
    assert.equal(s.player.hp, 3);
    assert.equal(s.phase, 'playing');
  });

  it('foe shots hurt the player', () => {
    const config = testConfig();
    const s = createGame(config);
    s.enemies.length = 0;
    s.spawnQueue.length = 0;
    const foe = s.foeShots.find((x) => !x.active);
    foe.active = true;
    foe.x = s.player.x;
    foe.y = s.player.y;
    foe.vx = 0;
    foe.vy = 0;
    foe.damage = 1;
    run(s, config, 1);
    assert.equal(s.player.hp, 2);
    assert.equal(foe.active, false);
  });

  it('losing the last life ends the run', () => {
    const config = testConfig();
    config.player.lives = 1;
    config.player.health = 1;
    const s = createGame(config);
    s.enemies.length = 0;
    s.spawnQueue.length = 0;
    parkedFoe(s, { x: s.player.x + 5, y: s.player.y });
    const events = run(s, config, 1);
    assert.equal(s.phase, 'gameover');
    assert.ok(events.some((e) => e.type === 'gameover'));
  });

  it('freezes when paused and resumes', () => {
    const config = testConfig();
    const s = createGame(config);
    pauseGame(s);
    const before = summarize(s);
    run(s, config, 30, { ...IDLE, fire: true, melee: true, right: true });
    assert.deepEqual(summarize(s), before);
    resumeGame(s);
    run(s, config, 5, { ...IDLE, fire: true });
    assert.ok(s.shotsFired > 0);
  });
});

describe('pickups', () => {
  it('heal restores hp up to the max', () => {
    const config = testConfig();
    const s = createGame(config);
    s.enemies.length = 0;
    s.spawnQueue.length = 0;
    // A parked foe keeps the arena non-empty so no victory triggers.
    parkedFoe(s, { x: 60, y: 60, speed: 0 });
    s.player.hp = 1;
    s.pickups.push({ x: s.player.x, y: s.player.y, kind: 'heal', expiresAt: 1e12 });
    const events = run(s, config, 1);
    assert.equal(s.player.hp, 2);
    assert.ok(events.some((e) => e.type === 'pickup' && e.kind === 'heal'));
    s.pickups.push({ x: s.player.x, y: s.player.y, kind: 'heal', expiresAt: 1e12 });
    run(s, config, 1);
    assert.equal(s.player.hp, 3);
  });

  it('bonus pickups add score and pickups expire', () => {
    const config = testConfig();
    const s = createGame(config);
    s.enemies.length = 0;
    s.spawnQueue.length = 0;
    // Victory would trigger on an empty arena; keep a foe parked far away.
    parkedFoe(s, { x: 60, y: 60, speed: 0 });
    s.pickups.push({ x: s.player.x, y: s.player.y, kind: 'bonus', expiresAt: 1e12 });
    s.pickups.push({ x: 60, y: 320, kind: 'bonus', expiresAt: 10 });
    const events = run(s, config, 5);
    assert.equal(s.score, 50);
    assert.ok(events.some((e) => e.type === 'pickup' && e.kind === 'bonus'));
    assert.equal(s.pickups.length, 0, 'stale pickup should have expired');
  });
});

describe('autopilot', () => {
  it('kites away from foes and slashes up close', () => {
    const config = testConfig();
    const s = createGame(config);
    s.enemies.length = 0;
    s.spawnQueue.length = 0;
    parkedFoe(s, { x: s.player.x + 100, y: s.player.y, speed: 0 });
    const away = suggestInput(s, config);
    assert.equal(away.left, true);
    assert.equal(away.right, false);
    assert.equal(away.fire, true);
    assert.equal(away.melee, false);
    s.enemies[0].x = s.player.x + 20;
    const close = suggestInput(s, config);
    assert.equal(close.melee, true);
  });
});

describe('restart and determinism', () => {
  it('restart returns a clean independent state', () => {
    const config = testConfig();
    const a = createGame(config);
    run(a, config, 60, { ...IDLE, fire: true, melee: true });
    assert.ok(a.shotsFired > 0);
    assert.ok(a.meleeSwings > 0);
    const b = createGame(config);
    assert.equal(b.shotsFired, 0);
    assert.equal(b.meleeSwings, 0);
    assert.equal(b.score, 0);
    assert.equal(b.phase, 'playing');
  });

  it('same seed + same inputs = same summary (NFR-004)', () => {
    const config = testConfig();
    const script = (s) => {
      run(s, config, 40, { ...IDLE, fire: true, right: true });
      run(s, config, 40, { ...IDLE, melee: true, up: true });
      run(s, config, 40, { ...IDLE, fire: true, left: true, down: true });
      return summarize(s);
    };
    const a = script(createGame(config));
    const b = script(createGame(config));
    assert.deepEqual(a, b);
  });

  it('autopilot runs are deterministic', () => {
    const config = testConfig();
    const script = (s) => {
      for (let i = 0; i < 200; i++) {
        stepGame(s, config, suggestInput(s, config), 16);
        if (s.phase !== 'playing') break;
      }
      return summarize(s);
    };
    assert.deepEqual(script(createGame(config)), script(createGame(config)));
  });
});

describe('time advance', () => {
  it('clamps dt for timeMs (no rewind, no leap)', () => {
    const config = testConfig();
    const s = createGame(config);
    stepGame(s, config, IDLE, -100);
    assert.equal(s.timeMs, 0);
    stepGame(s, config, IDLE, 1000);
    assert.equal(s.timeMs, 50);
    stepGame(s, config, IDLE, 16);
    assert.equal(s.timeMs, 66);
  });
});
