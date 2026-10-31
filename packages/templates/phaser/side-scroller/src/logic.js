// Pure side-scroller simulation (SDD §3.3). No Phaser/DOM imports, so the
// whole ruleset runs under node for unit tests and in the page for the demo.
// Run-and-jump across a level: platforms (solid + one-way), patrol enemies,
// static hazards, coins, checkpoints, and an exit door. Damage knocks back
// with brief invulnerability; falls respawn at the last checkpoint; losing
// all health ends the run, reaching the exit wins it.

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

function circleHitsBox(cx, cy, r, bx0, by0, bx1, by1) {
  const nx = clamp(cx, bx0, bx1);
  const ny = clamp(cy, by0, by1);
  return (cx - nx) * (cx - nx) + (cy - ny) * (cy - ny) <= r * r;
}

export function createGame(config, opts = {}) {
  const seed = opts.seed ?? config.seed ?? 1;
  const rand = mulberry32(seed);
  return {
    seed,
    rand,
    tick: 0,
    timeMs: 0,
    phase: 'playing',
    player: {
      x: config.player.spawn.x,
      y: config.player.spawn.y,
      vx: 0,
      vy: 0,
      grounded: false,
      coyote: 0,
      buffer: 0,
      jumpsUsed: 0,
      health: config.player.health,
      invuln: 0,
      facing: 1,
      jumps: 0,
      stomps: 0,
      hurts: 0,
    },
    respawn: { x: config.player.spawn.x, y: config.player.spawn.y },
    checkpointId: null,
    enemies: config.level.enemies.map((e, i) => ({
      uid: i + 1,
      id: e.id,
      kind: e.kind || 'walker',
      x: e.x,
      y: e.y,
      w: e.w,
      h: e.h,
      speed: e.speed,
      // Seed-dependent initial patrol direction (NFR-004 determinism probe).
      dir: rand() < 0.5 ? -1 : 1,
      patrolMinX: e.patrolMinX,
      patrolMaxX: e.patrolMaxX,
      damage: e.damage ?? 1,
      alive: true,
    })),
    collectibles: config.level.collectibles.map((c, i) => ({
      uid: i + 1,
      id: c.id,
      x: c.x,
      y: c.y,
      r: c.r ?? 10,
      score: c.score ?? config.scoring.coinScore,
      taken: false,
    })),
    coins: 0,
    score: 0,
    winBonus: 0,
    winTimeSec: null,
  };
}

export function pauseGame(state) {
  if (state.phase === 'playing') state.phase = 'paused';
}

export function resumeGame(state) {
  if (state.phase === 'paused') state.phase = 'playing';
}

// Damage the player; falls ignore invulnerability and respawn at the last
// checkpoint, hits knock back from the source point.
function hurt(state, config, events, damage, srcX, isFall) {
  const pl = state.player;
  if (!isFall && pl.invuln > 0) return;
  pl.health -= damage;
  pl.hurts++;
  pl.invuln = config.player.invulnMs;
  if (pl.health <= 0) {
    pl.health = 0;
    state.phase = 'gameover';
    events.push({
      type: 'gameover', score: state.score, coins: state.coins,
      timeSec: Math.round((state.timeMs / 1000) * 10) / 10,
    });
    return;
  }
  if (isFall) {
    pl.x = state.respawn.x;
    pl.y = state.respawn.y;
    pl.vx = 0;
    pl.vy = 0;
    pl.buffer = 0;
    pl.coyote = 0;
    events.push({
      type: 'respawn', health: pl.health,
      checkpoint: state.checkpointId,
    });
  } else {
    const pcx = pl.x + config.player.width / 2;
    const dir = pcx < srcX ? -1 : 1;
    pl.vx = dir * config.player.knockback;
    pl.vy = -config.player.knockback * 0.9;
    pl.grounded = false;
    events.push({ type: 'hurt', health: pl.health });
  }
}

export function stepGame(state, config, input, dtMs) {
  const events = [];
  if (state.phase !== 'playing') return events;
  const dtMsSafe = clamp(dtMs, 0, 50);
  const dt = dtMsSafe / 1000;
  state.tick++;
  state.timeMs += dtMsSafe;
  const w = config.world;
  const p = config.player;
  const lvl = config.level;
  const pl = state.player;
  pl.invuln = Math.max(0, pl.invuln - dtMsSafe);

  // Horizontal drive: accelerate toward the held direction, friction to a
  // stop with no input; air control scales the response mid-air.
  const want = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (want !== 0) pl.facing = want;
  const acc = p.acceleration * (pl.grounded ? 1 : p.airControl);
  const target = want * p.moveSpeed;
  if (pl.vx < target) pl.vx = Math.min(target, pl.vx + acc * dt);
  else pl.vx = Math.max(target, pl.vx - acc * dt);

  // Jump with coyote time + input buffer (level-triggered like the runner:
  // holding jump re-jumps on landing).
  if (input.jump) pl.buffer = p.jumpBufferMs;
  else pl.buffer -= dtMsSafe;
  if (pl.grounded) {
    pl.coyote = p.coyoteMs;
    pl.jumpsUsed = 0;
  } else {
    pl.coyote -= dtMsSafe;
  }
  if (pl.buffer > 0 && (pl.grounded || pl.coyote > 0)
      && pl.jumpsUsed < p.maxJumps) {
    pl.vy = -p.jumpVelocity;
    pl.grounded = false;
    pl.coyote = 0;
    pl.buffer = 0;
    pl.jumpsUsed++;
    pl.jumps++;
    events.push({ type: 'jump' });
  }

  // Gravity; releasing jump while rising doubles it (variable jump height).
  const g = (!input.jump && pl.vy < 0) ? w.gravity * 2 : w.gravity;
  pl.vy = Math.min(w.maxFallSpeed, pl.vy + g * dt);

  // Move X, resolve against solid platforms (one-way has no sides).
  const prevLeft = pl.x;
  const prevRight = pl.x + p.width;
  pl.x += pl.vx * dt;
  for (const q of lvl.platforms) {
    if (q.oneWay) continue;
    if (!overlap(pl.x, pl.y, pl.x + p.width, pl.y + p.height,
        q.x, q.y, q.x + q.w, q.y + q.h)) continue;
    if (prevRight <= q.x + 0.5) pl.x = q.x - p.width;
    else if (prevLeft >= q.x + q.w - 0.5) pl.x = q.x + q.w;
    else if (pl.vx > 0) pl.x = q.x - p.width;
    else if (pl.vx < 0) pl.x = q.x + q.w;
    pl.vx = 0;
  }
  pl.x = clamp(pl.x, 0, w.levelWidth - p.width);

  // Move Y, swept resolve so thin platforms never tunnel at fall speed.
  const prevTop = pl.y;
  const prevBottom = pl.y + p.height;
  pl.y += pl.vy * dt;
  const wasGrounded = pl.grounded;
  pl.grounded = false;
  for (const q of lvl.platforms) {
    const spansX = pl.x < q.x + q.w && pl.x + p.width > q.x;
    if (!spansX) continue;
    if (q.oneWay) {
      // Land only when falling onto the top surface.
      if (pl.vy >= 0 && prevBottom <= q.y + 1 && pl.y + p.height >= q.y) {
        pl.y = q.y - p.height;
        pl.vy = 0;
        pl.grounded = true;
      }
      continue;
    }
    if (!overlap(pl.x, pl.y, pl.x + p.width, pl.y + p.height,
        q.x, q.y, q.x + q.w, q.y + q.h)) {
      // Swept landing: crossed the top plane this step without ending
      // overlapped (thin platform, fast fall).
      if (pl.vy >= 0 && prevBottom <= q.y + 1 && pl.y + p.height >= q.y) {
        pl.y = q.y - p.height;
        pl.vy = 0;
        pl.grounded = true;
      }
      continue;
    }
    if (pl.vy >= 0 && prevBottom <= q.y + 1) {
      pl.y = q.y - p.height;
      pl.vy = 0;
      pl.grounded = true;
    } else if (pl.vy < 0 && prevTop >= q.y + q.h - 1) {
      pl.y = q.y + q.h;
      pl.vy = 0;
    }
  }
  if (pl.grounded && !wasGrounded) events.push({ type: 'land' });

  // Kill plane: damage + checkpoint respawn (or game over).
  if (pl.y > w.killPlaneY) {
    hurt(state, config, events, 1, pl.x + p.width / 2, true);
    if (state.phase !== 'playing') return events;
  }

  // Patrol enemies march their bounds and turn at the ends.
  for (const e of state.enemies) {
    if (!e.alive) continue;
    e.x += e.dir * e.speed * dt;
    if (e.x < e.patrolMinX) {
      e.x = e.patrolMinX;
      e.dir = 1;
    } else if (e.x > e.patrolMaxX) {
      e.x = e.patrolMaxX;
      e.dir = -1;
    }
  }

  const px0 = pl.x;
  const py0 = pl.y;
  const px1 = pl.x + p.width;
  const py1 = pl.y + p.height;

  // Coins.
  for (const c of state.collectibles) {
    if (c.taken) continue;
    if (circleHitsBox(c.x, c.y, c.r, px0, py0, px1, py1)) {
      c.taken = true;
      state.coins++;
      state.score += c.score;
      events.push({
        type: 'coin', id: c.id, coins: state.coins, score: state.score,
      });
    }
  }

  // Checkpoints.
  for (const cp of lvl.checkpoints) {
    if (state.checkpointId !== cp.id
        && overlap(px0, py0, px1, py1, cp.x, cp.y, cp.x + cp.w, cp.y + cp.h)) {
      state.checkpointId = cp.id;
      state.respawn = { x: cp.x, y: cp.y + cp.h - p.height };
      events.push({ type: 'checkpoint', id: cp.id });
    }
  }

  // Exit door wins the run with a par-time bonus.
  const ex = lvl.exit;
  if (overlap(px0, py0, px1, py1, ex.x, ex.y, ex.x + ex.w, ex.y + ex.h)) {
    state.phase = 'won';
    const timeSec = state.timeMs / 1000;
    state.winTimeSec = Math.round(timeSec * 10) / 10;
    state.winBonus = Math.max(0,
      Math.round((config.scoring.parTimeSec - timeSec)
        * config.scoring.timeBonusPerSec));
    state.score += state.winBonus;
    events.push({
      type: 'win', score: state.score, coins: state.coins,
      timeSec: state.winTimeSec, bonus: state.winBonus,
    });
    return events;
  }

  // Enemies: falling onto one stomps it (bounce + score), otherwise it hurts.
  for (const e of state.enemies) {
    if (!e.alive) continue;
    if (!overlap(px0, py0, px1, py1, e.x, e.y, e.x + e.w, e.y + e.h)) continue;
    const stomping = pl.vy > 0 && prevBottom <= e.y + e.h * 0.5;
    if (stomping) {
      e.alive = false;
      pl.stomps++;
      state.score += config.scoring.stompScore;
      pl.vy = -p.stompBounce;
      pl.grounded = false;
      events.push({ type: 'stomp', id: e.id, score: state.score });
    } else {
      hurt(state, config, events, e.damage, e.x + e.w / 2, false);
      if (state.phase !== 'playing') return events;
    }
  }

  // Static hazards hurt on touch (invulnerability gates repeats).
  for (const h of lvl.hazards) {
    if (overlap(px0, py0, px1, py1, h.x, h.y, h.x + h.w, h.y + h.h)) {
      hurt(state, config, events, h.damage ?? 1, h.x + h.w / 2, false);
      if (state.phase !== 'playing') return events;
    }
  }

  return events;
}

// Landing support at a probe point: a platform top near or below the feet.
function supportedAt(platforms, px, feet) {
  for (const q of platforms) {
    if (px >= q.x - 1 && px <= q.x + q.w + 1
        && q.y >= feet - 8 && q.y <= feet + 200) {
      return true;
    }
  }
  return false;
}

// Autopilot used by the demo (?demo-input=1) and the logic autotest: run at
// the exit, take off for gaps at the last physics-safe moment, hop threats.
export function suggestInput(state, config) {
  const out = { left: false, right: false, jump: false };
  if (state.phase !== 'playing') return out;
  const pl = state.player;
  const p = config.player;
  const lvl = config.level;
  const cx = pl.x + p.width / 2;
  const feet = pl.y + p.height;
  const dir = (lvl.exit.x + lvl.exit.w / 2) >= cx ? 1 : -1;
  if (dir > 0) out.right = true;
  else out.left = true;
  const front = dir > 0 ? pl.x + p.width : pl.x;

  // Airborne: hold jump while rising for full-height leaps, then release.
  if (!pl.grounded) {
    out.jump = pl.vy < -60;
    return out;
  }

  // Full-jump reach at current speed. The rise uses full gravity but the
  // descent (jump released past the apex) uses double gravity, so reach is
  // rise + shortened fall: speed * v/g * (1 + 1/sqrt(2)). Every takeoff
  // below is vetted against it so a hop never lands in a pit.
  const speed = Math.max(Math.abs(pl.vx), p.moveSpeed * 0.6);
  const reach = (speed * p.jumpVelocity) / config.world.gravity
    * (1 + 1 / Math.SQRT2);
  const landingSafe = () => supportedAt(
    lvl.platforms, front + dir * reach * 0.95, feet);

  // Gap scan: near edge and far landing ahead (Infinity when none found).
  let edgeDx = Infinity;
  let landDx = Infinity;
  for (let dx = 10; dx <= 280; dx += 10) {
    const supported = supportedAt(lvl.platforms, front + dir * dx, feet);
    if (!supported && edgeDx === Infinity) edgeDx = dx;
    if (supported && edgeDx !== Infinity) {
      landDx = dx;
      break;
    }
  }
  // Take off so a full jump clears the far edge with margin.
  const gapTakeoff = edgeDx !== Infinity && (landDx === Infinity
    ? edgeDx <= 60
    : edgeDx <= Math.max(20, reach - (landDx - edgeDx) - 15));

  // 1. Threat in the lane: anything overlapping a 100px lookahead strip.
  // The hop must land somewhere safe (or double as the gap takeoff).
  const lane = 100;
  const x0 = Math.min(front, front + dir * lane);
  const x1 = Math.max(front, front + dir * lane);
  const inLane = (ox0, oy0, ox1, oy1) => ox0 < x1 && ox1 > x0
    && (pl.y + 4) < oy1 && (pl.y + p.height - 2) > oy0;
  let threat = false;
  for (const e of state.enemies) {
    if (e.alive && inLane(e.x, e.y, e.x + e.w, e.y + e.h)) threat = true;
  }
  for (const h of lvl.hazards) {
    if (inLane(h.x, h.y, h.x + h.w, h.y + h.h)) threat = true;
  }
  if (threat && (gapTakeoff || landingSafe())) {
    out.jump = true;
    return out;
  }

  // 2. Gap takeoff.
  if (gapTakeoff) {
    out.jump = true;
    return out;
  }

  // 3. Wall or step-up: solid face overlapping the body near the nose.
  for (const q of lvl.platforms) {
    if (q.oneWay) continue;
    const near = dir > 0
      ? (q.x < front + 26 && q.x + q.w > front)
      : (q.x + q.w > front - 26 && q.x < front);
    if (near && q.y < feet - 6 && q.y + q.h > pl.y + 8) {
      out.jump = true;
      return out;
    }
  }

  // 4. Coin overhead: hop for it, but never into a pit.
  if (landingSafe()) {
    for (const c of state.collectibles) {
      if (!c.taken && Math.abs(c.x - cx) < 50
          && c.y < pl.y - 10 && c.y > pl.y - 160) {
        out.jump = true;
        return out;
      }
    }
  }
  return out;
}

// Compact comparable snapshot for determinism checks.
export function summarize(state) {
  const round = (n) => Math.round(n * 1000) / 1000;
  return {
    tick: state.tick,
    timeMs: Math.round(state.timeMs),
    phase: state.phase,
    score: state.score,
    coins: state.coins,
    health: state.player.health,
    checkpoint: state.checkpointId,
    player: {
      x: round(state.player.x),
      y: round(state.player.y),
      grounded: state.player.grounded,
      jumps: state.player.jumps,
      stomps: state.player.stomps,
      hurts: state.player.hurts,
    },
    enemies: state.enemies.map((e) => [e.id, round(e.x), e.alive]),
    pickups: state.collectibles.filter((c) => c.taken).length,
  };
}
