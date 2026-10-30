// Simulation unit tests (SDD §3.2 acceptance + NFR-004 determinism).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, stepGame, pauseGame, resumeGame, summarize, suggestInput,
} from '../src/logic.js';

function testConfig() {
  return {
    seed: 7,
    world: {
      width: 480, height: 270, groundY: 230, gravity: 2600,
      baseSpeed: 200, maxSpeed: 400, speedRampPerSec: 20, pxPerMeter: 50,
    },
    player: { x: 100, width: 24, height: 32, slideHeight: 16, jumpVelocity: 780 },
    // Fairness invariant: max jump reach (240px) + rise room < min gap.
    spawning: { gracePx: 600, startGapPx: 420, minGapPx: 360, spawnAheadPx: 40 },
    obstacles: [
      { id: 'spike', sprite: 'obstacle-spike', w: 20, h: 28, kind: 'ground' },
      { id: 'drone', sprite: 'obstacle-drone', w: 26, h: 18, kind: 'high', hoverH: 20 },
    ],
    scoring: { coinScore: 10, milestoneEveryM: 100 },
    difficulty: { preset: 'normal' },
    controls: { jump: 'SPACE', slide: 'S', pause: 'P' },
    assets: { sprites: { player: 'assets/player.png' } },
  };
}

const IDLE = { jump: false, slide: false };
function run(state, config, ticks, input = IDLE, dt = 16) {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...stepGame(state, config, input, dt));
  return events;
}

function crashInto(state, config, def, y = 0) {
  state.obstacles.push({
    uid: 900 + state.tick, type: def.id, kind: def.kind || 'ground',
    x: config.player.x, y, w: def.w, h: def.h,
  });
  return run(state, config, 1);
}

describe('jump physics', () => {
  it('rises and lands back on the ground', () => {
    const config = testConfig();
    const s = createGame(config);
    const events = run(s, config, 1, { jump: true });
    assert.ok(events.some((e) => e.type === 'jump'));
    assert.equal(s.player.grounded, false);
    assert.ok(s.player.h > 0);
    let peak = s.player.h;
    for (let i = 0; i < 60; i++) {
      run(s, config, 1, IDLE);
      peak = Math.max(peak, s.player.h);
    }
    assert.equal(s.player.grounded, true);
    assert.equal(s.player.h, 0);
    assert.ok(peak > 20, `jump peak too low: ${peak}`);
  });

  it('does not double-jump mid-air', () => {
    const config = testConfig();
    const s = createGame(config);
    run(s, config, 1, { jump: true });
    assert.equal(s.player.jumps, 1);
    run(s, config, 10, { jump: true });
    assert.equal(s.player.jumps, 1);
    assert.equal(s.player.grounded, false);
  });

  it('clears a ground obstacle when airborne', () => {
    const config = testConfig();
    const s = createGame(config);
    run(s, config, 1, { jump: true });
    run(s, config, 8, IDLE); // near apex (~100px up)
    crashInto(s, config, config.obstacles[0]);
    assert.equal(s.phase, 'playing');
  });
});

describe('slide', () => {
  it('shrinks the hitbox and passes under a high obstacle', () => {
    const config = testConfig();
    const drone = config.obstacles[1];
    // Standing into the drone: crash (spans 20..38, player 0..32).
    const a = createGame(config);
    crashInto(a, config, drone, drone.hoverH);
    assert.equal(a.phase, 'gameover');
    // Sliding under it: survives (slide box 0..16 clears hoverH 20).
    const c = createGame(config);
    c.obstacles.push({
      uid: 901, type: drone.id, kind: 'high',
      x: config.player.x, y: drone.hoverH, w: drone.w, h: drone.h,
    });
    run(c, config, 1, { jump: false, slide: true });
    assert.equal(c.phase, 'playing');
    assert.equal(c.player.sliding, true);
  });
});

describe('spawning and speed ramp', () => {
  it('spawns nothing before the grace distance, then cadence runs', () => {
    const config = testConfig();
    const s = createGame(config);
    run(s, config, 60); // ~200px/s * 0.96s = 192px < 600 grace
    assert.equal(s.obstacles.length + s.pickups.length, 0);
    run(s, config, 600);
    assert.ok(s.obstacles.length + s.pickups.length > 0);
  });

  it('ramps speed toward max and tightens gaps', () => {
    const config = testConfig();
    const early = createGame(config);
    run(early, config, 120);
    assert.ok(early.speed > config.world.baseSpeed);
    assert.ok(early.speed <= config.world.maxSpeed);
    // Same distance, same seed: the max-speed run packs more patterns.
    // Slow config holds base speed (ramp 0); fast config pins max speed.
    // Identical rand streams make every fast gap termwise smaller, so the
    // count comparison is exact, not statistical.
    const countSpawns = (cfg, timeMs) => {
      const s = createGame(cfg);
      s.timeMs = timeMs;
      s.distSinceSpawn = 0;
      s.nextGap = 1; // force immediate cadence sampling
      const before = s.nextUid;
      let guard = 0;
      while (s.distancePx < 3000 && guard++ < 5000) {
        run(s, cfg, 1);
        s.obstacles.length = 0; // cadence only: never crash
      }
      return s.nextUid - before;
    };
    const slowCfg = { ...config, world: { ...config.world, speedRampPerSec: 0 } };
    const slow = countSpawns(slowCfg, 0);
    const fast = countSpawns(config, 3600 * 1000); // speed pinned at max
    assert.ok(fast > slow, `expected denser spawns at speed (slow=${slow} fast=${fast})`);
  });
});

describe('coins and scoring', () => {
  it('collects coins and adds distance + coin score', () => {
    const config = testConfig();
    const s = createGame(config);
    s.pickups.push({ uid: 501, x: config.player.x, y: 10, r: 10 });
    const events = run(s, config, 1);
    assert.ok(events.some((e) => e.type === 'coin'));
    assert.equal(s.coins, 1);
    const meters = Math.floor(s.distancePx / config.world.pxPerMeter);
    assert.equal(s.score, meters + config.scoring.coinScore);
  });

  it('emits milestones as distance grows', () => {
    const config = testConfig();
    const s = createGame(config, { seed: 1 });
    const events = [];
    let guard = 0;
    while (s.phase === 'playing' && s.distancePx < 100 * 50 + 500 && guard++ < 20000) {
      events.push(...stepGame(s, config, suggestInput(s, config), 16));
    }
    assert.ok(events.some((e) => e.type === 'milestone'),
      'autopilot run should reach the first milestone');
  });
});

describe('collision and game over', () => {
  it('one ground hit ends the run and freezes the sim', () => {
    const config = testConfig();
    const s = createGame(config);
    const events = crashInto(s, config, config.obstacles[0]);
    assert.equal(s.phase, 'gameover');
    assert.ok(events.some((e) => e.type === 'gameover'));
    const frozen = summarize(s);
    run(s, config, 30, { jump: true });
    assert.deepEqual(summarize(s), frozen);
  });

  it('freezes when paused and resumes', () => {
    const config = testConfig();
    const s = createGame(config);
    pauseGame(s);
    const before = summarize(s);
    run(s, config, 30, { jump: true });
    assert.deepEqual(summarize(s), before);
    resumeGame(s);
    run(s, config, 1, { jump: true });
    assert.equal(s.player.jumps, 1);
  });

  it('restart returns a clean independent state', () => {
    const config = testConfig();
    const a = createGame(config);
    run(a, config, 60, { jump: true });
    assert.ok(a.tick > 0 && a.distancePx > 0);
    const b = createGame(config);
    assert.equal(b.tick, 0);
    assert.equal(b.score, 0);
    assert.equal(b.phase, 'playing');
  });
});

describe('determinism', () => {
  it('same seed + same inputs = same summary (NFR-004)', () => {
    const config = testConfig();
    const script = (s) => {
      for (let i = 0; i < 400 && s.phase === 'playing'; i++) {
        stepGame(s, config, suggestInput(s, config), 16);
      }
      return summarize(s);
    };
    const a = script(createGame(config));
    const b = script(createGame(config));
    assert.deepEqual(a, b);
  });

  it('different seeds diverge the obstacle layout', () => {
    const config = testConfig();
    const layout = (seed) => {
      const s = createGame(config, { seed });
      run(s, config, 300);
      return summarize(s).obstacles;
    };
    assert.notDeepEqual(layout(1), layout(2));
  });
});
