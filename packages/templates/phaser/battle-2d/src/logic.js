// Pure battle-2d simulation (top-down arena battler). No Phaser/DOM imports,
// so the whole ruleset runs under node for unit tests and in the page demo.
// The player kites enemies around a bounded arena: ranged shots auto-aim at
// the nearest foe in range (else fly along the facing), melee is a spin slash
// hitting everything in range, and waves spawn at the arena edges.

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

function defsById(list) {
  const map = new Map();
  for (const item of list) map.set(item.id, item);
  return map;
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function clampTo(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

export function createGame(config, opts = {}) {
  const seed = opts.seed ?? config.seed ?? 1;
  const rand = mulberry32(seed);
  const shots = [];
  for (let i = 0; i < config.ranged.poolSize; i++) {
    shots.push({ active: false, x: 0, y: 0, vx: 0, vy: 0 });
  }
  const foeShots = [];
  for (let i = 0; i < config.foeShots.poolSize; i++) {
    foeShots.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, damage: 1 });
  }
  const state = {
    seed,
    rand,
    tick: 0,
    timeMs: 0,
    phase: 'playing',
    player: {
      x: config.player.x,
      y: config.player.y,
      fx: 1,
      fy: 0,
      hp: config.player.health,
      lives: config.player.lives,
      invulnUntil: 0,
      rangedUntil: 0,
      meleeUntil: 0,
    },
    shots,
    foeShots,
    enemies: [],
    pickups: [],
    waveIndex: 0,
    spawnQueue: [],
    breatherUntil: 0,
    bossSpawned: false,
    score: 0,
    kills: 0,
    shotsFired: 0,
    meleeSwings: 0,
    nextUid: 1,
  };
  queueWave(state, config, 0, config.waves[0].delayAfterPrevMs ?? 0);
  return state;
}

function waveScale(config, waveIndex) {
  const d = config.difficulty || {};
  return {
    hp: 1 + (d.enemyHealthScalePerWave || 0) * waveIndex,
    speed: 1 + (d.enemySpeedScalePerWave || 0) * waveIndex,
  };
}

export function queueWave(state, config, waveIndex, delayMs) {
  const wave = config.waves[waveIndex];
  const base = state.timeMs + delayMs;
  for (const spawn of wave.spawns) {
    for (let i = 0; i < spawn.count; i++) {
      state.spawnQueue.push({ at: base + i * spawn.intervalMs, enemyId: spawn.enemyId });
    }
  }
  state.spawnQueue.sort((a, b) => a.at - b.at);
}

// Random arena-edge point, kept away from the player when possible.
function spawnPosition(state, config) {
  const b = config.player.bounds;
  const minD = config.spawning?.minDistFromPlayer ?? 200;
  const p = state.player;
  let x = b.minX;
  let y = b.minY;
  for (let attempt = 0; attempt < 12; attempt++) {
    const edge = Math.floor(state.rand() * 4);
    if (edge === 0) { // top
      x = b.minX + 24 + state.rand() * (b.maxX - b.minX - 48);
      y = b.minY + 24;
    } else if (edge === 1) { // bottom
      x = b.minX + 24 + state.rand() * (b.maxX - b.minX - 48);
      y = b.maxY - 24;
    } else if (edge === 2) { // left
      x = b.minX + 24;
      y = b.minY + 24 + state.rand() * (b.maxY - b.minY - 48);
    } else { // right
      x = b.maxX - 24;
      y = b.minY + 24 + state.rand() * (b.maxY - b.minY - 48);
    }
    if (dist2(x, y, p.x, p.y) >= minD * minD) break;
  }
  return { x, y };
}

function spawnEnemy(state, config, enemyDefs, enemyId, isBoss) {
  const def = enemyDefs.get(enemyId);
  if (!def) return null;
  const scale = waveScale(config, state.waveIndex);
  const hp = Math.max(1, Math.round(def.health * scale.hp
    * (isBoss ? (config.boss?.healthMultiplier ?? 1) : 1)));
  const pos = spawnPosition(state, config);
  const uid = state.nextUid++;
  const enemy = {
    uid,
    type: enemyId,
    x: pos.x,
    y: pos.y,
    t: state.rand() * 10,
    hp,
    maxHp: hp,
    speed: def.speed * scale.speed,
    damage: def.damage,
    score: def.score * (isBoss ? 5 : 1),
    radius: def.radius * (isBoss ? 1.8 : 1),
    behavior: def.behavior.type,
    amplitude: def.behavior.amplitude ?? 0.8,
    frequencyHz: def.behavior.frequencyHz ?? 2,
    preferredRange: def.behavior.preferredRange ?? 240,
    fireRange: def.behavior.fireRange ?? 420,
    fireIntervalMs: def.behavior.fireIntervalMs ?? 1600,
    projectileSpeed: def.behavior.projectileSpeed ?? 240,
    fireAt: state.timeMs + 800 + state.rand() * 800,
    strafeDir: uid % 2 === 0 ? 1 : -1,
    isBoss: !!isBoss,
  };
  state.enemies.push(enemy);
  return enemy;
}

export function pauseGame(state) {
  if (state.phase === 'playing') state.phase = 'paused';
}

export function resumeGame(state) {
  if (state.phase === 'paused') state.phase = 'playing';
}

function hitEnemy(state, config, e, dmg, events) {
  e.hp -= dmg;
  if (e.hp > 0) {
    events.push({ type: 'hit', enemy: e.type });
    return false;
  }
  e.dead = true;
  state.kills++;
  const gain = Math.round(e.score * (config.scoring?.killMultiplier ?? 1));
  state.score += gain;
  events.push({ type: 'kill', enemy: e.type, score: gain, boss: e.isBoss });
  const pickups = config.pickups || { dropChance: 0 };
  if (state.rand() < (pickups.dropChance ?? 0)) {
    const kind = state.player.hp < config.player.health && state.rand() < 0.5
      ? 'heal' : 'bonus';
    state.pickups.push({
      x: e.x,
      y: e.y,
      kind,
      expiresAt: state.timeMs + (pickups.ttlMs ?? 12000),
    });
  }
  return true;
}

function damagePlayer(state, config, dmg, events) {
  const p = state.player;
  const now = state.timeMs;
  p.hp -= dmg;
  events.push({ type: 'hurt', hp: p.hp });
  if (p.hp <= 0) {
    p.lives--;
    if (p.lives <= 0) {
      state.phase = 'gameover';
      events.push({ type: 'gameover', score: state.score });
    } else {
      p.hp = config.player.health;
      p.x = config.player.x;
      p.y = config.player.y;
      p.fx = 1;
      p.fy = 0;
      p.invulnUntil = now + config.player.invulnerableMs;
      events.push({ type: 'life-lost', lives: p.lives });
    }
  } else {
    p.invulnUntil = now + config.player.invulnerableMs;
  }
}

function nearestEnemy(state, maxDist) {
  let best = null;
  let bestD2 = maxDist * maxDist;
  for (const e of state.enemies) {
    if (e.dead) continue;
    const d2 = dist2(state.player.x, state.player.y, e.x, e.y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = e;
    }
  }
  return best;
}

function fireRanged(state, config, events) {
  const p = state.player;
  const shot = state.shots.find((s) => !s.active);
  if (!shot) return; // pool exhausted: stay silent
  let dx = p.fx;
  let dy = p.fy;
  const target = nearestEnemy(state, config.ranged.aimRange);
  if (target) {
    const d = Math.sqrt(dist2(p.x, p.y, target.x, target.y)) || 1;
    dx = (target.x - p.x) / d;
    dy = (target.y - p.y) / d;
  }
  shot.active = true;
  shot.x = p.x + dx * 14;
  shot.y = p.y + dy * 14;
  shot.vx = dx * config.ranged.projectileSpeed;
  shot.vy = dy * config.ranged.projectileSpeed;
  state.shotsFired++;
  p.rangedUntil = state.timeMs + config.ranged.cooldownMs;
  events.push({ type: 'shot' });
}

function swingMelee(state, config, events) {
  const p = state.player;
  p.meleeUntil = state.timeMs + config.melee.cooldownMs;
  state.meleeSwings++;
  let hits = 0;
  for (const e of state.enemies) {
    if (e.dead) continue;
    const rr = config.melee.range + e.radius;
    if (dist2(p.x, p.y, e.x, e.y) > rr * rr) continue;
    hits++;
    hitEnemy(state, config, e, config.melee.damage, events);
  }
  state.enemies = state.enemies.filter((e) => !e.dead);
  events.push({ type: 'melee', hits });
}

// Autopilot used by the demo (?demo-input=1) and the logic autotest:
// kites away from foes and foe shots, always fires (auto-aim), and slashes
// when a foe closes in.
export function suggestInput(state, config) {
  const out = { up: false, down: false, left: false, right: false, fire: true, melee: false };
  if (state.phase !== 'playing') return { ...out, fire: false };
  const p = state.player;
  const b = config.player.bounds;
  let vx = 0;
  let vy = 0;
  const flee = (x, y, weight) => {
    const dx = p.x - x;
    const dy = p.y - y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    if (d > 280) return;
    const w = weight * (1 - d / 280);
    vx += (dx / d) * w;
    vy += (dy / d) * w;
  };
  for (const e of state.enemies) flee(e.x, e.y, 1);
  for (const s of state.foeShots) {
    if (s.active) flee(s.x, s.y, 1.4);
  }
  // Wall margin: steer back toward the middle near the bounds.
  const margin = 70;
  if (p.x - b.minX < margin) vx += 1.2;
  if (b.maxX - p.x < margin) vx -= 1.2;
  if (p.y - b.minY < margin) vy += 1.2;
  if (b.maxY - p.y < margin) vy -= 1.2;
  // No threats: drift to the arena center for room to maneuver.
  if (vx === 0 && vy === 0) {
    vx = (b.minX + b.maxX) / 2 - p.x;
    vy = (b.minY + b.maxY) / 2 - p.y;
  }
  const len = Math.sqrt(vx * vx + vy * vy) || 1;
  const nx = vx / len;
  const ny = vy / len;
  out.up = ny < -0.25;
  out.down = ny > 0.25;
  out.left = nx < -0.25;
  out.right = nx > 0.25;
  const reach = config.melee.range * 0.9;
  out.melee = state.enemies.some(
    (e) => !e.dead && dist2(p.x, p.y, e.x, e.y) <= reach * reach);
  return out;
}

export function stepGame(state, config, input, dtMs) {
  const events = [];
  if (state.phase !== 'playing') return events;
  const dt = Math.min(Math.max(dtMs, 0), 50) / 1000;
  state.tick++;
  state.timeMs += dtMs;
  const now = state.timeMs;
  const enemyDefs = defsById(config.enemies);
  const p = state.player;
  const b = config.player.bounds;

  // Player movement within the arena; facing tracks the last move dir.
  let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (mx !== 0 || my !== 0) {
    const len = Math.sqrt(mx * mx + my * my);
    mx /= len;
    my /= len;
    p.fx = mx;
    p.fy = my;
    p.x += mx * config.player.speed * dt;
    p.y += my * config.player.speed * dt;
  }
  p.x = clampTo(p.x, b.minX, b.maxX);
  p.y = clampTo(p.y, b.minY, b.maxY);

  // Attacks.
  if (input.fire && now >= p.rangedUntil) fireRanged(state, config, events);
  if (input.melee && now >= p.meleeUntil) swingMelee(state, config, events);

  // Player shots.
  for (const s of state.shots) {
    if (!s.active) continue;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (s.x < b.minX - 20 || s.x > b.maxX + 20
        || s.y < b.minY - 20 || s.y > b.maxY + 20) s.active = false;
  }

  // Due spawns.
  while (state.spawnQueue.length && state.spawnQueue[0].at <= now) {
    const due = state.spawnQueue.shift();
    spawnEnemy(state, config, enemyDefs, due.enemyId, false);
  }
  // Optional boss rides with its wave.
  const wave = config.waves[state.waveIndex];
  if (config.boss && !state.bossSpawned && wave && wave.id === config.boss.waveId
      && !state.spawnQueue.length) {
    state.bossSpawned = true;
    spawnEnemy(state, config, enemyDefs, config.boss.enemyId, true);
    events.push({ type: 'boss' });
  }

  // Enemies.
  for (const e of state.enemies) {
    e.t += dt;
    let dx = p.x - e.x;
    let dy = p.y - e.y;
    let d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.001) {
      dx = 1;
      dy = 0;
      d = 1;
    }
    const nx = dx / d;
    const ny = dy / d;
    if (e.behavior === 'shooter') {
      const want = e.preferredRange;
      let adv = 0;
      if (d > want + 40) adv = 1;
      else if (d < want - 40) adv = -1;
      const px = -ny * e.strafeDir;
      const py = nx * e.strafeDir;
      e.x += (nx * adv * e.speed + px * e.speed * 0.5) * dt;
      e.y += (ny * adv * e.speed + py * e.speed * 0.5) * dt;
      if (now >= e.fireAt && d <= e.fireRange) {
        const shot = state.foeShots.find((s) => !s.active);
        if (shot) {
          shot.active = true;
          shot.x = e.x + nx * (e.radius + 4);
          shot.y = e.y + ny * (e.radius + 4);
          shot.vx = nx * e.projectileSpeed;
          shot.vy = ny * e.projectileSpeed;
          shot.damage = e.damage;
        }
        e.fireAt = now + e.fireIntervalMs;
      }
    } else if (e.behavior === 'weaver') {
      const wob = Math.sin(e.t * e.frequencyHz * Math.PI * 2) * e.amplitude;
      e.x += (nx * e.speed - ny * wob * e.speed) * dt;
      e.y += (ny * e.speed + nx * wob * e.speed) * dt;
    } else { // chaser + unknown fall back to a straight seek
      e.x += nx * e.speed * dt;
      e.y += ny * e.speed * dt;
    }
    e.x = clampTo(e.x, b.minX, b.maxX);
    e.y = clampTo(e.y, b.minY, b.maxY);
  }

  // Cheap separation so packs do not stack on one pixel (deterministic order).
  const foes = state.enemies;
  for (let i = 0; i < foes.length; i++) {
    for (let j = i + 1; j < foes.length; j++) {
      const a = foes[i];
      const c = foes[j];
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const min = a.radius + c.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0.0001 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        a.x = clampTo(a.x - ux * push, b.minX, b.maxX);
        a.y = clampTo(a.y - uy * push, b.minY, b.maxY);
        c.x = clampTo(c.x + ux * push, b.minX, b.maxX);
        c.y = clampTo(c.y + uy * push, b.minY, b.maxY);
      }
    }
  }

  // Foe shots.
  for (const s of state.foeShots) {
    if (!s.active) continue;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (s.x < b.minX - 20 || s.x > b.maxX + 20
        || s.y < b.minY - 20 || s.y > b.maxY + 20) s.active = false;
  }

  // Expired pickups.
  state.pickups = state.pickups.filter((k) => k.expiresAt > now);

  // Shots vs enemies.
  for (const s of state.shots) {
    if (!s.active) continue;
    for (const e of state.enemies) {
      if (e.dead) continue;
      const rr = 6 + e.radius;
      if (dist2(s.x, s.y, e.x, e.y) > rr * rr) continue;
      s.active = false;
      hitEnemy(state, config, e, config.ranged.damage, events);
      break;
    }
  }
  state.enemies = state.enemies.filter((e) => !e.dead);

  // Foes vs player (only when vulnerable). Contact knocks the foe back;
  // it survives, the invulnerability window gates repeat damage.
  if (now >= p.invulnUntil) {
    for (const e of state.enemies) {
      const rr = config.player.radius + e.radius;
      if (dist2(p.x, p.y, e.x, e.y) > rr * rr) continue;
      let dx = e.x - p.x;
      let dy = e.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= d;
      dy /= d;
      e.x = clampTo(e.x + dx * 28, b.minX, b.maxX);
      e.y = clampTo(e.y + dy * 28, b.minY, b.maxY);
      damagePlayer(state, config, e.damage, events);
      break;
    }
  }
  if (now >= p.invulnUntil) {
    for (const s of state.foeShots) {
      if (!s.active) continue;
      const rr = config.player.radius + 6;
      if (dist2(p.x, p.y, s.x, s.y) > rr * rr) continue;
      s.active = false;
      damagePlayer(state, config, s.damage, events);
      break;
    }
  }

  // Pickups vs player.
  const pickups = config.pickups || {};
  for (const k of state.pickups) {
    if (dist2(p.x, p.y, k.x, k.y) > (config.player.radius + 12) ** 2) continue;
    k.taken = true;
    if (k.kind === 'heal') {
      p.hp = Math.min(config.player.health, p.hp + (pickups.healAmount ?? 1));
    } else {
      state.score += pickups.bonusScore ?? 50;
    }
    events.push({ type: 'pickup', kind: k.kind });
  }
  state.pickups = state.pickups.filter((k) => !k.taken);

  // Wave clear / victory.
  if (state.phase === 'playing' && !state.enemies.length && !state.spawnQueue.length
      && now >= state.breatherUntil) {
    const cleared = state.waveIndex + 1;
    state.score += config.scoring?.waveClearBonus ?? 0;
    if (cleared >= (config.victory?.afterWave ?? config.waves.length)) {
      state.phase = 'stageclear';
      events.push({ type: 'victory', score: state.score });
    } else {
      events.push({ type: 'wave-clear', wave: cleared, score: state.score });
      state.waveIndex++;
      state.bossSpawned = false;
      const delay = config.waves[state.waveIndex].delayAfterPrevMs ?? 1500;
      state.breatherUntil = now + delay;
      queueWave(state, config, state.waveIndex, delay);
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
    kills: state.kills,
    shotsFired: state.shotsFired,
    meleeSwings: state.meleeSwings,
    waveIndex: state.waveIndex,
    player: {
      x: round(state.player.x), y: round(state.player.y),
      fx: round(state.player.fx), fy: round(state.player.fy),
      hp: state.player.hp, lives: state.player.lives,
    },
    enemies: state.enemies.map((e) => [e.type, round(e.x), round(e.y), e.hp]),
    shots: state.shots.filter((s) => s.active).length,
    foeShots: state.foeShots.filter((s) => s.active).length,
    pickups: state.pickups.length,
  };
}
