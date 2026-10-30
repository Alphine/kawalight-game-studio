// Pure space-shooter simulation (SDD §3.1). No Phaser/DOM imports, so the whole
// ruleset runs under node for unit tests and in the page for the demo.
// Classic horizontal feel: player on the left, enemies enter from the right.

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

export function createGame(config, opts = {}) {
  const seed = opts.seed ?? config.seed ?? 1;
  const rand = mulberry32(seed);
  const shots = [];
  for (let i = 0; i < config.weapon.poolSize; i++) {
    shots.push({ active: false, x: 0, y: 0 });
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
      hp: config.player.health,
      lives: config.player.lives,
      invulnUntil: 0,
      power: 1,
      cooldownUntil: 0,
    },
    shots,
    enemies: [],
    pickups: [],
    waveIndex: 0,
    spawnQueue: [],
    breatherUntil: 0,
    bossSpawned: false,
    score: 0,
    kills: 0,
    shotsFired: 0,
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

function spawnEnemy(state, config, enemyDefs, enemyId, isBoss) {
  const def = enemyDefs.get(enemyId);
  if (!def) return null;
  const scale = waveScale(config, state.waveIndex);
  const hp = Math.max(1, Math.round(def.health * scale.hp
    * (isBoss ? (config.boss?.healthMultiplier ?? 1) : 1)));
  const y = 40 + state.rand() * (config.world.height - 80);
  const enemy = {
    uid: state.nextUid++,
    type: enemyId,
    x: config.world.width + 30,
    y,
    seedY: y,
    t: 0,
    hp,
    maxHp: hp,
    speed: def.speed * scale.speed,
    damage: def.damage,
    score: def.score * (isBoss ? 5 : 1),
    radius: def.radius * (isBoss ? 1.8 : 1),
    behavior: def.behavior.type,
    amplitude: def.behavior.amplitude || 0,
    frequencyHz: def.behavior.frequencyHz || 0,
    targetY: state.player?.y ?? y,
    isBoss: !!isBoss,
  };
  state.enemies.push(enemy);
  return enemy;
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function pauseGame(state) {
  if (state.phase === 'playing') state.phase = 'paused';
}

export function resumeGame(state) {
  if (state.phase === 'paused') state.phase = 'playing';
}

function fireShots(state, config, events) {
  const w = config.weapon;
  const power = Math.min(state.player.power, w.powerupLevels);
  const offsets = power === 1 ? [0] : power === 2 ? [-8, 8] : [-10, 0, 10];
  let fired = 0;
  for (const dy of offsets) {
    const shot = state.shots.find((s) => !s.active);
    if (!shot) break; // pool exhausted: extra barrels stay silent
    shot.active = true;
    shot.x = state.player.x + 14;
    shot.y = state.player.y + dy;
    fired++;
  }
  if (fired > 0) {
    state.shotsFired++;
    state.player.cooldownUntil = state.timeMs + w.cooldownMs;
    events.push({ type: 'shot', power });
  }
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

  // Player movement within bounds.
  const speed = config.player.speed * dt;
  if (input.up) p.y -= speed;
  if (input.down) p.y += speed;
  if (input.left) p.x -= speed;
  if (input.right) p.x += speed;
  const b = config.player.bounds;
  p.x = Math.min(Math.max(p.x, b.minX), b.maxX);
  p.y = Math.min(Math.max(p.y, b.minY), b.maxY);

  // Weapon.
  if (input.fire && now >= p.cooldownUntil) fireShots(state, config, events);

  // Shots.
  for (const s of state.shots) {
    if (!s.active) continue;
    s.x += config.weapon.projectileSpeed * dt;
    if (s.x > config.world.width + 20) s.active = false;
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
    if (e.behavior === 'sine') {
      e.x -= e.speed * dt;
      e.y = e.seedY + Math.sin(e.t * e.frequencyHz * Math.PI * 2) * e.amplitude;
      e.y = Math.min(Math.max(e.y, 20), config.world.height - 20);
    } else if (e.behavior === 'dive') {
      e.x -= e.speed * 1.3 * dt;
      const dy = e.targetY - e.y;
      e.y += Math.sign(dy) * Math.min(Math.abs(dy), e.speed * dt);
    } else {
      e.x -= e.speed * dt;
    }
  }
  state.enemies = state.enemies.filter((e) => e.x > -50);

  // Pickups drift left.
  for (const k of state.pickups) k.x -= 60 * dt;
  state.pickups = state.pickups.filter((k) => k.x > -20);

  const scoring = config.scoring || { killMultiplier: 1, waveClearBonus: 0 };
  const pickups = config.pickups || { dropChance: 0, powerupBonus: 0 };

  // Shots vs enemies.
  for (const s of state.shots) {
    if (!s.active) continue;
    for (const e of state.enemies) {
      if (e.dead) continue;
      const rr = (6 + e.radius) ** 2;
      if (dist2(s.x, s.y, e.x, e.y) > rr) continue;
      s.active = false;
      e.hp -= config.weapon.damage;
      if (e.hp <= 0) {
        e.dead = true;
        state.kills++;
        const gain = Math.round(e.score * (scoring.killMultiplier ?? 1));
        state.score += gain;
        events.push({ type: 'kill', enemy: e.type, score: gain, boss: e.isBoss });
        if (state.rand() < (pickups.dropChance ?? 0)) {
          const kind = p.power < config.weapon.powerupLevels && state.rand() < 0.5
            ? 'power' : 'bonus';
          state.pickups.push({ x: e.x, y: e.y, kind });
        }
      } else {
        events.push({ type: 'hit', enemy: e.type });
      }
      break;
    }
  }
  state.enemies = state.enemies.filter((e) => !e.dead);

  // Enemies vs player (only when vulnerable).
  if (now >= p.invulnUntil) {
    for (const e of state.enemies) {
      const rr = (config.player.radius + e.radius) ** 2;
      if (dist2(p.x, p.y, e.x, e.y) > rr) continue;
      e.dead = true;
      p.hp -= e.damage;
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
          p.power = 1;
          p.invulnUntil = now + config.player.invulnerableMs;
          events.push({ type: 'life-lost', lives: p.lives });
        }
      } else {
        p.invulnUntil = now + config.player.invulnerableMs;
      }
      break;
    }
    state.enemies = state.enemies.filter((e) => !e.dead);
  }

  // Pickups vs player.
  for (const k of state.pickups) {
    if (dist2(p.x, p.y, k.x, k.y) > (config.player.radius + 12) ** 2) continue;
    k.taken = true;
    if (k.kind === 'power') p.power = Math.min(p.power + 1, config.weapon.powerupLevels);
    state.score += pickups.powerupBonus ?? 0;
    events.push({ type: 'pickup', kind: k.kind });
  }
  state.pickups = state.pickups.filter((k) => !k.taken);

  // Wave clear / victory.
  if (state.phase === 'playing' && !state.enemies.length && !state.spawnQueue.length
      && now >= state.breatherUntil) {
    const cleared = state.waveIndex + 1;
    state.score += scoring.waveClearBonus ?? 0;
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
    waveIndex: state.waveIndex,
    player: {
      x: round(state.player.x), y: round(state.player.y),
      hp: state.player.hp, lives: state.player.lives, power: state.player.power,
    },
    enemies: state.enemies.map((e) => [e.type, round(e.x), round(e.y), e.hp]),
    shots: state.shots.filter((s) => s.active).length,
    pickups: state.pickups.length,
  };
}
