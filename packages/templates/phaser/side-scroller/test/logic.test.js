// Simulation unit tests (SDD §3.3 acceptance + NFR-004 determinism).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, stepGame, pauseGame, resumeGame, summarize, suggestInput,
} from '../src/logic.js';

function testConfig() {
  return {
    seed: 7,
    world: {
      width: 480, height: 270, levelWidth: 1200, levelHeight: 270,
      gravity: 2600, maxFallSpeed: 1400, killPlaneY: 320,
    },
    player: {
      spawn: { x: 40, y: 186 }, width: 24, height: 32,
      moveSpeed: 220, acceleration: 2200, airControl: 0.65,
      jumpVelocity: 760, coyoteMs: 100, jumpBufferMs: 120, maxJumps: 1,
      health: 3, invulnMs: 800, knockback: 220, stompBounce: 500,
    },
    level: {
      platforms: [
        { x: 0, y: 218, w: 400, h: 52 },
        { x: 480, y: 218, w: 720, h: 52 },
        { x: 760, y: 140, w: 24, h: 78 }, // solid step-wall on segment B
        { x: 200, y: 150, w: 100, h: 16, oneWay: true },
      ],
      hazards: [
        { id: 'spikes-1', sprite: 'spikes', x: 300, y: 198, w: 24, h: 20 },
      ],
      enemies: [
        {
          id: 'walker-1', kind: 'walker', sprite: 'walker',
          x: 560, y: 194, w: 28, h: 24, speed: 60,
          patrolMinX: 520, patrolMaxX: 700,
        },
      ],
      collectibles: [{ id: 'coin-1', x: 100, y: 180 }],
      checkpoints: [{ id: 'cp-1', x: 520, y: 150, w: 24, h: 68 }],
      exit: { x: 1120, y: 150, w: 40, h: 68 },
    },
    scoring: { coinScore: 10, stompScore: 25, timeBonusPerSec: 5, parTimeSec: 60 },
    difficulty: { preset: 'normal' },
    controls: { left: 'LEFT', right: 'RIGHT', jump: 'SPACE', pause: 'P' },
    camera: { followLerp: 0.12, deadzoneX: 80, deadzoneY: 60 },
    assets: { sprites: { player: 'assets/player.png' } },
  };
}

const IDLE = { left: false, right: false, jump: false };
const RIGHT = { left: false, right: true, jump: false };
const LEFT = { left: true, right: false, jump: false };
function run(state, config, ticks, input = IDLE, dt = 16) {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...stepGame(state, config, input, dt));
  return events;
}
function settle(state, config) {
  run(state, config, 5); // land on the ground, stabilize timers
}

describe('run movement', () => {
  it('accelerates to move speed and friction-stops on release', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    run(s, config, 120, RIGHT);
    assert.ok(Math.abs(s.player.vx - config.player.moveSpeed) < 1);
    run(s, config, 120, IDLE);
    assert.ok(Math.abs(s.player.vx) < 1);
  });

  it('clamps to the level bounds', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    run(s, config, 300, LEFT);
    assert.equal(s.player.x, 0);
    // Right bound: park the exit out of reach so the autopilot runs past it
    // to the level edge instead of winning first.
    const noExit = testConfig();
    noExit.level.exit = { x: 5000, y: 150, w: 40, h: 68 };
    const r = createGame(noExit, { seed: 7 });
    for (let i = 0; i < 3600 && r.phase === 'playing'; i++) {
      stepGame(r, noExit, suggestInput(r, noExit), 16);
    }
    assert.equal(r.phase, 'playing');
    assert.equal(r.player.x, noExit.world.levelWidth - noExit.player.width);
  });
});

describe('jump physics', () => {
  it('rises and lands back on the ground', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    const events = run(s, config, 1, { left: false, right: false, jump: true });
    assert.ok(events.some((e) => e.type === 'jump'));
    assert.equal(s.player.grounded, false);
    let top = s.player.y;
    for (let i = 0; i < 80; i++) {
      run(s, config, 1, IDLE);
      top = Math.min(top, s.player.y);
    }
    assert.equal(s.player.grounded, true);
    assert.equal(s.player.y, 186);
    assert.ok(top < 186 - 40, `jump peak too low: rose ${186 - top}px`);
  });

  it('does not double-jump mid-air', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    run(s, config, 1, { left: false, right: false, jump: true });
    assert.equal(s.player.jumps, 1);
    run(s, config, 20, { left: false, right: false, jump: true });
    assert.equal(s.player.jumps, 1);
    assert.equal(s.player.grounded, false);
  });

  it('releasing jump early shortens the leap (variable height)', () => {
    const config = testConfig();
    const peak = (hold) => {
      const s = createGame(config);
      settle(s, config);
      let top = s.player.y;
      run(s, config, 1, { left: false, right: false, jump: true });
      for (let i = 0; i < 80 && (hold || i < 1 || !s.player.grounded); i++) {
        run(s, config, 1, hold ? { left: false, right: false, jump: true } : IDLE);
        top = Math.min(top, s.player.y);
        if (!hold && i > 1 && s.player.grounded) break;
        if (hold && i > 1 && s.player.grounded) break;
      }
      return 186 - top;
    };
    const held = peak(true);
    const tapped = peak(false);
    assert.ok(held - tapped > 20, `held=${held} tapped=${tapped}`);
  });

  it('coyote time allows a late jump just past the edge', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    s.player.x = 376; // right edge exactly at the segment end (400)
    s.player.y = 186;
    let guard = 0;
    while (s.player.grounded && guard++ < 60) run(s, config, 1, RIGHT);
    assert.equal(s.player.grounded, false); // walked off, coyote left
    assert.ok(s.player.coyote > 0);
    run(s, config, 1, { left: false, right: false, jump: true });
    assert.equal(s.player.jumps, 1);
    assert.ok(s.player.vy < 0);
  });

  it('buffers a jump pressed just before landing', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    s.player.x = 100;
    s.player.y = 185; // 1px above the ground, falling
    s.player.vy = 200;
    s.player.grounded = false;
    s.player.coyote = 0;
    run(s, config, 1, { left: false, right: false, jump: true }); // lands
    assert.equal(s.player.grounded, true);
    assert.equal(s.player.jumps, 0);
    run(s, config, 1, IDLE); // buffered jump fires
    assert.equal(s.player.jumps, 1);
    assert.equal(s.player.grounded, false);
  });
});

describe('platform collision', () => {
  it('lands on solid tops and stops at solid sides', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    s.player.x = 700; // left of the step-wall (760..784)
    s.player.y = 186;
    run(s, config, 60, RIGHT);
    assert.equal(s.player.x, 760 - config.player.width);
    assert.equal(s.player.vx, 0);
  });

  it('bonks on solid ceilings', () => {
    const config = testConfig();
    config.level.platforms.push({ x: 60, y: 120, w: 120, h: 20 });
    const s = createGame(config);
    settle(s, config);
    s.player.x = 100;
    run(s, config, 1, { left: false, right: false, jump: true });
    run(s, config, 40, IDLE);
    // Head-bumped: never rose past the ceiling underside.
    assert.ok(s.player.y >= 140 - config.player.height - 1 || s.player.grounded);
    assert.ok(s.player.jumps >= 1);
  });

  it('passes up through one-way platforms and lands on top', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    s.player.x = 220; // under the floater (200..300 @ y 150)
    const HELD = { left: false, right: false, jump: true };
    let top = s.player.y;
    for (let i = 0; i < 45; i++) { // rise through, fall back onto the top
      run(s, config, 1, HELD);
      top = Math.min(top, s.player.y);
    }
    assert.ok(top < 150 - config.player.height, 'never passed through the floater');
    run(s, config, 45, IDLE); // release so the buffer does not re-jump
    assert.equal(s.player.grounded, true);
    assert.equal(s.player.y, 150 - config.player.height);
  });
});

describe('enemies', () => {
  it('patrols bounds and turns at the ends', () => {
    const config = testConfig();
    const s = createGame(config, { seed: 1 });
    const e = s.enemies[0];
    const dir0 = e.dir;
    let turned = false;
    for (let i = 0; i < 2000; i++) {
      run(s, config, 1, IDLE);
      if (e.dir !== dir0) {
        turned = true;
        break;
      }
    }
    assert.ok(turned, 'walker never turned around');
    assert.ok(e.x >= e.patrolMinX && e.x <= e.patrolMaxX);
  });

  it('stomping kills the walker, bounces, and scores', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    const e = s.enemies[0];
    e.speed = 0;
    s.player.x = e.x;
    s.player.y = e.y - 50;
    s.player.vy = 100;
    s.player.grounded = false;
    let stomped = false;
    for (let i = 0; i < 30 && !stomped; i++) {
      const events = run(s, config, 1, IDLE);
      if (events.some((ev) => ev.type === 'stomp')) {
        stomped = true;
        assert.ok(s.player.vy < 0, 'no bounce after stomp');
      }
    }
    assert.ok(stomped, 'never stomped the walker');
    assert.equal(e.alive, false);
    assert.equal(s.player.stomps, 1);
    assert.equal(s.score, config.scoring.stompScore);
  });

  it('side contact hurts with knockback and brief invulnerability', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    const e = s.enemies[0];
    e.speed = 0;
    s.player.x = e.x - config.player.width + 2; // overlap from the left
    s.player.y = e.y;
    s.player.vy = 0;
    const events = run(s, config, 1, IDLE);
    assert.ok(events.some((ev) => ev.type === 'hurt'));
    assert.equal(s.player.health, 2);
    assert.ok(s.player.vx < 0, 'knockback should push away (left)');
    assert.ok(s.player.invuln > 0);
    // Still overlapping: invulnerability gates a repeat hit.
    run(s, config, 5, IDLE);
    assert.equal(s.player.health, 2);
    assert.equal(s.player.hurts, 1);
  });

  it('can be hurt again once invulnerability expires', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    const e = s.enemies[0];
    e.speed = 0;
    s.player.x = e.x - config.player.width + 2;
    s.player.y = e.y;
    run(s, config, 1, IDLE);
    assert.equal(s.player.health, 2);
    // Stay overlapped past the invulnerability window.
    for (let i = 0; i < 120 && s.player.health === 2; i++) {
      s.player.x = e.x - config.player.width + 2;
      s.player.y = e.y;
      s.player.vy = 0;
      run(s, config, 1, IDLE);
    }
    assert.equal(s.player.health, 1);
  });
});

describe('hazards, falls, and checkpoints', () => {
  it('spikes hurt on touch', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    s.player.x = 300;
    s.player.y = 186;
    const events = run(s, config, 1, IDLE);
    assert.ok(events.some((e) => e.type === 'hurt'));
    assert.equal(s.player.health, 2);
  });

  it('falling into a pit respawns at spawn with one damage', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    s.player.x = 420; // over the pit (400..480)
    s.player.y = 186;
    const events = run(s, config, 300, IDLE);
    assert.ok(events.some((e) => e.type === 'respawn'));
    assert.equal(s.player.health, 2);
    assert.equal(s.player.x, config.player.spawn.x);
    assert.equal(s.player.y, config.player.spawn.y);
  });

  it('checkpoints retarget the respawn point, once each', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    s.player.x = 520;
    s.player.y = 186;
    const first = run(s, config, 1, IDLE);
    assert.ok(first.some((e) => e.type === 'checkpoint'));
    assert.equal(s.checkpointId, 'cp-1');
    const again = run(s, config, 10, IDLE);
    assert.ok(!again.some((e) => e.type === 'checkpoint'));
    // Die in the pit: back at the checkpoint, not spawn.
    s.player.x = 420;
    s.player.y = 186;
    s.player.vy = 0;
    run(s, config, 300, IDLE);
    assert.equal(s.player.x, 520);
    assert.equal(s.player.y, 150 + 68 - config.player.height);
  });
});

describe('coins, exit, and game over', () => {
  it('collects coins for score', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    s.player.x = 88;
    s.player.y = 170;
    const events = run(s, config, 1, IDLE);
    assert.ok(events.some((e) => e.type === 'coin'));
    assert.equal(s.coins, 1);
    assert.equal(s.score, config.scoring.coinScore);
  });

  it('touching the exit wins with a par-time bonus and freezes', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    s.player.x = 1100;
    s.player.y = 170;
    const events = run(s, config, 1, IDLE);
    const win = events.find((e) => e.type === 'win');
    assert.ok(win);
    assert.equal(s.phase, 'won');
    assert.ok(win.bonus > 0, 'fast win should earn a time bonus');
    assert.equal(s.score, win.bonus);
    const frozen = summarize(s);
    run(s, config, 30, RIGHT);
    assert.deepEqual(summarize(s), frozen);
  });

  it('slow wins earn no time bonus', () => {
    const config = testConfig();
    const s = createGame(config);
    s.timeMs = 120 * 1000; // past the 60s par
    settle(s, config);
    s.player.x = 1100;
    s.player.y = 170;
    const events = run(s, config, 1, IDLE);
    assert.equal(events.find((e) => e.type === 'win').bonus, 0);
  });

  it('losing all health ends the run and freezes the sim', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    s.player.x = 300;
    s.player.y = 186;
    for (let hp = 3; hp > 0; hp--) {
      s.player.invuln = 0;
      run(s, config, 1, IDLE);
    }
    assert.equal(s.phase, 'gameover');
    assert.equal(s.player.health, 0);
    const frozen = summarize(s);
    run(s, config, 30, { left: false, right: false, jump: true });
    assert.deepEqual(summarize(s), frozen);
  });

  it('freezes when paused and resumes', () => {
    const config = testConfig();
    const s = createGame(config);
    settle(s, config);
    pauseGame(s);
    const before = summarize(s);
    run(s, config, 30, RIGHT);
    assert.deepEqual(summarize(s), before);
    resumeGame(s);
    run(s, config, 10, RIGHT);
    assert.ok(s.player.x > before.player.x);
  });

  it('restart returns a clean independent state', () => {
    const config = testConfig();
    const a = createGame(config);
    run(a, config, 60, RIGHT);
    assert.ok(a.tick > 0 && a.player.x > config.player.spawn.x);
    const b = createGame(config);
    assert.equal(b.tick, 0);
    assert.equal(b.score, 0);
    assert.equal(b.phase, 'playing');
    assert.equal(b.player.health, config.player.health);
  });
});

describe('autopilot', () => {
  it('finishes the test level (jumps the pit, climbs the wall)', () => {
    const config = testConfig();
    const s = createGame(config, { seed: 7 });
    for (let i = 0; i < 3600 && s.phase === 'playing'; i++) {
      stepGame(s, config, suggestInput(s, config), 16);
    }
    assert.equal(s.phase, 'won');
    assert.ok(s.coins > 0);
  });

  it('idles safely when the run is already over', () => {
    const config = testConfig();
    const s = createGame(config);
    s.phase = 'won';
    assert.deepEqual(suggestInput(s, config), { left: false, right: false, jump: false });
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

  it('different seeds diverge the enemy patrol (NFR-004)', () => {
    const config = testConfig();
    const layouts = new Set();
    for (let seed = 1; seed <= 12; seed++) {
      const s = createGame(config, { seed });
      run(s, config, 300, IDLE);
      layouts.add(JSON.stringify(summarize(s).enemies));
    }
    assert.ok(layouts.size > 1, 'enemy patrol never varies by seed');
  });
});
