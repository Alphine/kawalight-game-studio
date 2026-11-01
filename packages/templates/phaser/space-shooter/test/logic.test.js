// Simulation unit tests (SDD §3.1 acceptance + NFR-004 determinism).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stepGame, pauseGame, resumeGame, summarize } from '../src/logic.js';

function testConfig() {
  return {
    seed: 7,
    world: { width: 480, height: 270 },
    player: {
      x: 60, y: 135, speed: 200, health: 2, lives: 2,
      invulnerableMs: 500, radius: 8,
      bounds: { minX: 8, maxX: 288, minY: 8, maxY: 262 },
    },
    weapon: { cooldownMs: 100, projectileSpeed: 400, damage: 1, poolSize: 8, powerupLevels: 3 },
    enemies: [{
      id: 'mite', sprite: 'enemy-mite', health: 1, speed: 60, damage: 1,
      score: 100, radius: 10, behavior: { type: 'drift', amplitude: 0, frequencyHz: 0 },
    }],
    waves: [{ id: 'wave-1', delayAfterPrevMs: 0, boss: null,
      spawns: [{ enemyId: 'mite', count: 2, intervalMs: 100 }] }],
    boss: null,
    pickups: { dropChance: 0, powerupBonus: 50 },
    scoring: { killMultiplier: 1, waveClearBonus: 25 },
    difficulty: { preset: 'normal', enemyHealthScalePerWave: 0, enemySpeedScalePerWave: 0 },
    controls: { up: 'W', down: 'S', left: 'A', right: 'D', fire: 'SPACE', pause: 'P' },
    victory: { afterWave: 1 },
    assets: { sprites: { player: 'assets/player.png' } },
  };
}

const IDLE = { up: false, down: false, left: false, right: false, fire: false };
function run(state, config, ticks, input = IDLE, dt = 16) {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...stepGame(state, config, input, dt));
  return events;
}

describe('movement', () => {
  it('moves and clamps to bounds', () => {
    const config = testConfig();
    const s = createGame(config);
    run(s, config, 120, { ...IDLE, left: true, up: true });
    assert.equal(s.player.x, 8);
    assert.equal(s.player.y, 8);
    run(s, config, 300, { ...IDLE, right: true, down: true });
    assert.equal(s.player.x, 288);
    assert.equal(s.player.y, 262);
  });
});

describe('weapon', () => {
  it('respects cooldown and pool size', () => {
    const config = testConfig();
    const s = createGame(config);
    run(s, config, 10, { ...IDLE, fire: true }); // 160ms -> 2 volleys
    assert.equal(s.shotsFired, 2);
    assert.ok(s.shots.filter((x) => x.active).length <= config.weapon.poolSize);
    run(s, config, 500, { ...IDLE, fire: true });
    assert.ok(s.shots.filter((x) => x.active).length <= config.weapon.poolSize);
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
    }
    const events = run(s, config, 5);
    assert.ok(events.some((e) => e.type === 'kill'));
    assert.equal(s.kills, 2);
    assert.equal(s.score, 200 + 25); // kills + wave-clear bonus
  });

  it('reaches stage-clear after the final wave', () => {
    const config = testConfig();
    const s = createGame(config);
    run(s, config, 30);
    for (const e of s.enemies) e.hp = 0;
    // Lethal shots instead of editing hp: force via direct hits.
    for (const e of s.enemies) {
      const shot = s.shots.find((x) => !x.active);
      shot.active = true;
      shot.x = e.x;
      shot.y = e.y;
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
    }
    const events = run(s, config, 10);
    assert.equal(s.phase, 'stageclear');
    assert.ok(events.some((e) => e.type === 'victory'));
  });
});

describe('damage and lives', () => {
  it('hurts, grants invulnerability, loses a life, then game over', () => {
    const config = testConfig();
    const s = createGame(config);
    const crash = () => {
      s.enemies.push({
        uid: 900 + s.tick, type: 'mite', x: s.player.x, y: s.player.y,
        seedY: s.player.y, t: 0, hp: 1, maxHp: 1, speed: 0, damage: 1,
        score: 0, radius: 10, behavior: 'drift', amplitude: 0,
        frequencyHz: 0, targetY: 0, isBoss: false,
      });
      run(s, config, 1);
    };
    crash(); // hp 2 -> 1
    assert.equal(s.player.hp, 1);
    assert.equal(s.phase, 'playing');
    crash(); // invulnerable: no damage
    assert.equal(s.player.hp, 1);
    run(s, config, 60); // 960ms > 500ms invuln
    crash(); // hp 1 -> 0 -> life lost, respawned
    assert.equal(s.player.lives, 1);
    assert.equal(s.player.hp, 2);
    run(s, config, 60);
    crash(); // hp 2 -> 1
    run(s, config, 60);
    crash(); // hp 1 -> 0 -> no lives left
    assert.equal(s.phase, 'gameover');
  });

  it('freezes when paused and resumes', () => {
    const config = testConfig();
    const s = createGame(config);
    pauseGame(s);
    const before = summarize(s);
    run(s, config, 30, { ...IDLE, fire: true, right: true });
    assert.deepEqual(summarize(s), before);
    resumeGame(s);
    run(s, config, 5, { ...IDLE, fire: true });
    assert.ok(s.shotsFired > 0);
  });
});

describe('restart and determinism', () => {
  it('restart returns a clean independent state', () => {
    const config = testConfig();
    const a = createGame(config);
    run(a, config, 60, { ...IDLE, fire: true });
    assert.ok(a.shotsFired > 0);
    const b = createGame(config);
    assert.equal(b.shotsFired, 0);
    assert.equal(b.score, 0);
    assert.equal(b.phase, 'playing');
  });

  it('same seed + same inputs = same summary (NFR-004)', () => {
    const config = testConfig();
    const script = (s) => {
      run(s, config, 40, { ...IDLE, fire: true, right: true });
      run(s, config, 40, { ...IDLE, up: true });
      run(s, config, 40, { ...IDLE, fire: true, left: true, down: true });
      return summarize(s);
    };
    const a = script(createGame(config));
    const b = script(createGame(config));
    assert.deepEqual(a, b);
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
