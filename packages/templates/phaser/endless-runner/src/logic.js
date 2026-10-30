// Pure endless-runner simulation (SDD §3.2). No Phaser/DOM imports, so the whole
// ruleset runs under node for unit tests and in the page for the demo.
// Fixed player x, world scrolls left: jump/slide under-or-over obstacles,
// grab coins, distance + coins feed the score, speed ramps until max.

export function mulberry32(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

function overlap(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1) {
  return ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0;
}

export function createGame(config, opts = {}) {
  const seed = opts.seed ?? config.seed ?? 1;
  return {
    seed,
    rand: mulberry32(seed),
    tick: 0,
    timeMs: 0,
    phase: 'playing',
    speed: config.world.baseSpeed,
    distancePx: 0,
    coins: 0,
    score: 0,
    player: { h: 0, vy: 0, grounded: true, sliding: false, jumps: 0, slides: 0 },
    obstacles: [],
    pickups: [],
    distSinceSpawn: 0,
    nextGap: (config.spawning.gracePx ?? 0) + config.spawning.startGapPx,
    milestonesHit: 0,
    nextUid: 1,
  };
}

export function pauseGame(state) {
  if (state.phase === 'playing') state.phase = 'paused';
}

export function resumeGame(state) {
  if (state.phase === 'paused') state.phase = 'playing';
}

// Distance gap for the next pattern; shrinks from startGapPx to minGapPx as
// speed ramps, with ±10% deterministic jitter.
function sampleGap(state, config) {
  const sp = config.spawning;
  const w = config.world;
  const span = w.maxSpeed - w.baseSpeed;
  const t = span > 0 ? clamp((state.speed - w.baseSpeed) / span, 0, 1) : 0;
  const base = sp.startGapPx + (sp.minGapPx - sp.startGapPx) * t;
  return base * (0.9 + state.rand() * 0.2);
}

function ofKind(config, kind) {
  return config.obstacles.filter((o) => (o.kind || 'ground') === kind);
}

function spawnPattern(state, config) {
  const x = config.world.width + (config.spawning.spawnAheadPx ?? 60);
  const addObstacle = (def, dx = 0) => {
    state.obstacles.push({
      uid: state.nextUid++,
      type: def.id,
      kind: def.kind || 'ground',
      x: x + dx,
      y: def.kind === 'high' ? (def.hoverH ?? 30) : 0,
      w: def.w,
      h: def.h,
    });
  };
  const addCoin = (cx, cy) => {
    state.pickups.push({ uid: state.nextUid++, x: cx, y: cy, r: 10 });
  };
  const grounds = ofKind(config, 'ground');
  const highs = ofKind(config, 'high');
  const ground = () => grounds[Math.floor(state.rand() * grounds.length)];
  const r = state.rand();
  if (r < 0.38) {
    addObstacle(ground());
  } else if (r < 0.52) {
    const d = ground();
    addObstacle(d);
    addObstacle(d, d.w + 6); // tight pair: always cleared as one jump
  } else if (r < 0.66) {
    if (highs.length) addObstacle(highs[Math.floor(state.rand() * highs.length)]);
    else addObstacle(ground());
  } else if (r < 0.84) {
    for (let i = 0; i < 5; i++) addCoin(x + i * 34, 34); // low coin line
  } else {
    const d = ground();
    addObstacle(d);
    for (let i = 0; i < 5; i++) { // coin arc over the obstacle
      const t = i / 4;
      addCoin(x - 100 + t * 200, 30 + Math.sin(t * Math.PI) * 120);
    }
  }
}

// Autopilot used by the demo (?demo-input=1) and the logic autotest:
// jump late over ground obstacles, hold slide under high ones.
export function suggestInput(state, config) {
  const out = { jump: false, slide: false };
  if (state.phase !== 'playing') return out;
  const px = config.player.x;
  const front = px + config.player.width / 2;
  // Obstacle spans in player-front-relative coordinates (s0 = front edge).
  const grounds = [];
  const highs = [];
  for (const o of state.obstacles) {
    const s0 = (o.x - o.w / 2) - front;
    const s1 = (o.x + o.w / 2) - front;
    // Fully passed only once the rear clears the tail (player width).
    if (s1 < -(config.player.width + 4)) continue;
    (o.kind === 'high' ? highs : grounds).push({ s0, s1 });
  }
  grounds.sort((a, b) => a.s0 - b.s0);
  highs.sort((a, b) => a.s0 - b.s0);
  const ground = grounds[0] || null;
  const high = highs[0] || null;

  // 1. High obstacle at the nose: slide, never jump into it.
  if (high && high.s0 < 30 && high.s1 > 0) {
    out.slide = true;
    return out;
  }
  const airtime = (2 * config.player.jumpVelocity) / config.world.gravity;
  const reach = airtime * state.speed; // landing spot if we jump now
  // Last moment with room to rise over the tallest obstacle.
  const dLate = state.speed * 0.075 + 10;
  const dEarly = reach * 0.6;
  const g = ground ? ground.s0 : Infinity;
  // 2. Emergency: clear the ground threat or crash trying.
  if (ground && g < dLate) {
    out.jump = true;
    return out;
  }
  // 3. Timed jump: only when the landing spot clears every obstacle span
  // (before it with re-jump room, or past it). Otherwise wait: spans drift
  // left while the landing spot stays fixed, so waiting resolves the block.
  if (ground && g < dEarly) {
    // Speed-scaled margins: the descent crosses obstacle-top height shortly
    // before touchdown and the tail (full player width) must clear the rear
    // corner (rearM); landing before a span needs rise room for the next
    // jump (frontM).
    const rearM = state.speed * 0.075 + 8 + config.player.width;
    const frontM = state.speed * 0.09 + 20;
    let clear = true;
    for (const t of grounds) {
      if (reach > t.s0 - frontM && reach < t.s1 + rearM) { clear = false; break; }
    }
    if (clear) {
      for (const t of highs) {
        if (t.s0 < 70 && t.s1 > -10) { clear = false; break; } // takeoff lane
      }
    }
    if (clear) {
      out.jump = true;
      return out;
    }
  }
  // 4. Nothing due: hold slide for an approaching high obstacle.
  if (high && high.s0 < Math.max(160, state.speed * 0.4)) {
    out.slide = true;
  }
  return out;
}

export function stepGame(state, config, input, dtMs) {
  const events = [];
  if (state.phase !== 'playing') return events;
  const dt = clamp(dtMs, 0, 50) / 1000;
  state.tick++;
  state.timeMs += dtMs;
  const w = config.world;
  const p = config.player;
  const pl = state.player;

  // Speed ramp.
  state.speed = Math.min(
    w.maxSpeed, w.baseSpeed + w.speedRampPerSec * (state.timeMs / 1000));

  // Jump (level-triggered: holding jump re-jumps on landing).
  if (input.jump && pl.grounded) {
    pl.vy = p.jumpVelocity;
    pl.grounded = false;
    pl.jumps++;
    events.push({ type: 'jump' });
  }
  // Slide (held); extra gravity while sliding airborne (fast-fall).
  const sliding = !!input.slide;
  if (sliding && !pl.sliding) pl.slides++;
  pl.sliding = sliding;
  if (!pl.grounded) {
    pl.vy -= (sliding ? w.gravity * 2 : w.gravity) * dt;
    pl.h += pl.vy * dt;
    if (pl.h <= 0) {
      pl.h = 0;
      pl.vy = 0;
      pl.grounded = true;
      events.push({ type: 'land' });
    }
  }

  // World scroll.
  const dx = state.speed * dt;
  state.distancePx += dx;
  for (const o of state.obstacles) o.x -= dx;
  for (const c of state.pickups) c.x -= dx;
  state.obstacles = state.obstacles.filter((o) => o.x + o.w / 2 > -60);
  state.pickups = state.pickups.filter((c) => c.x > -40);

  // Spawn cadence.
  state.distSinceSpawn += dx;
  let guard = 8;
  while (state.distSinceSpawn >= state.nextGap && guard-- > 0) {
    state.distSinceSpawn -= state.nextGap;
    spawnPattern(state, config);
    state.nextGap = sampleGap(state, config);
  }

  // Score + milestones.
  const meters = Math.floor(state.distancePx / (w.pxPerMeter ?? 50));
  const coinScore = config.scoring?.coinScore ?? 10;
  const refreshScore = () => { state.score = meters + state.coins * coinScore; };
  refreshScore();
  const every = config.scoring?.milestoneEveryM ?? 0;
  if (every > 0) {
    const hit = Math.floor(meters / every);
    if (hit > state.milestonesHit) {
      state.milestonesHit = hit;
      events.push({ type: 'milestone', meters: hit * every, score: state.score });
    }
  }

  // Player box (height above ground: [h, h + ph]).
  const ph = pl.sliding ? p.slideHeight : p.height;
  const px0 = p.x - p.width / 2;
  const px1 = p.x + p.width / 2;
  const py0 = pl.h;
  const py1 = pl.h + ph;

  // Coins.
  for (const c of state.pickups) {
    if (c.taken) continue;
    if (overlap(px0, py0, px1, py1, c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r)) {
      c.taken = true;
      state.coins++;
      refreshScore();
      events.push({
        type: 'coin', x: Math.round(c.x), y: Math.round(c.y),
        coins: state.coins, score: state.score,
      });
    }
  }
  state.pickups = state.pickups.filter((c) => !c.taken);

  // Obstacles: one hit ends the run.
  for (const o of state.obstacles) {
    if (overlap(px0, py0, px1, py1, o.x - o.w / 2, o.y, o.x + o.w / 2, o.y + o.h)) {
      state.phase = 'gameover';
      events.push({
        type: 'gameover', score: state.score, meters, coins: state.coins,
      });
      break;
    }
  }
  return events;
}

// Compact comparable snapshot for determinism checks.
export function summarize(state) {
  const round = (n) => Math.round(n * 1000) / 1000;
  return {
    tick: state.tick,
    timeMs: Math.round(state.timeMs),
    phase: state.phase,
    score: state.score,
    distancePx: round(state.distancePx),
    coins: state.coins,
    speed: round(state.speed),
    player: {
      h: round(state.player.h),
      grounded: state.player.grounded,
      jumps: state.player.jumps,
      slides: state.player.slides,
    },
    obstacles: state.obstacles.map((o) => [o.type, round(o.x), round(o.y)]),
    pickups: state.pickups.length,
  };
}
