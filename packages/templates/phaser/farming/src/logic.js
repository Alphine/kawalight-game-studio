// Pure farming simulation (SDD §3.5). No Phaser/DOM imports, so the whole
// ruleset runs under node for unit tests and in the page for the demo.
// Grid farm: plant seeds (costs coins), water each growth stage, harvest
// mature crops for coins. Day cycle auto-advances; morning rain may water
// thirsty plots (deterministic per seed). Banking targetCoins completes the run.

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

export const TOOLS = ['plant', 'water', 'harvest'];

function plotIndex(config, col, row) {
  const { cols, rows } = config.farm;
  if (!Number.isInteger(col) || !Number.isInteger(row)) return -1;
  if (col < 0 || row < 0 || col >= cols || row >= rows) return -1;
  return row * cols + col;
}

function isMature(crop, plot) {
  return plot.crop !== null && plot.stage >= crop.stages;
}

export function createGame(config, opts = {}) {
  const seed = opts.seed ?? config.seed ?? 1;
  const { cols, rows } = config.farm;
  const plots = [];
  for (let i = 0; i < cols * rows; i++) {
    plots.push({ crop: null, stage: 0, growthMs: 0, watered: false });
  }
  return {
    seed,
    rand: mulberry32(seed),
    tick: 0,
    timeMs: 0,
    day: 1,
    dayTimeMs: 0,
    phase: 'playing',
    tool: 'plant',
    cropIndex: 0,
    coins: config.scoring.startCoins,
    totalEarned: 0,
    planted: 0,
    harvested: 0,
    plots,
  };
}

export function pauseGame(state) {
  if (state.phase === 'playing') state.phase = 'paused';
}

export function resumeGame(state) {
  if (state.phase === 'paused') state.phase = 'playing';
}

export function setTool(state, tool) {
  if (!TOOLS.includes(tool)) return false;
  state.tool = tool;
  return true;
}

export function selectCrop(state, config, index) {
  if (!Number.isInteger(index) || index < 0 || index >= config.crops.length) {
    return false;
  }
  state.cropIndex = index;
  return true;
}

// Morning rain: each growing-but-thirsty plot has a 25% deterministic chance
// to start the day watered. Runs on every day advance (auto or manual).
function applyRain(state, config, events) {
  let watered = 0;
  for (const plot of state.plots) {
    if (plot.crop === null || plot.watered) continue;
    const crop = config.crops[plot.crop];
    if (isMature(crop, plot)) continue;
    if (state.rand() < 0.25) {
      plot.watered = true;
      watered++;
    }
  }
  if (watered > 0) events.push({ type: 'rain', plots: watered, day: state.day });
}

export function advanceDay(state, config) {
  const events = [];
  if (state.phase !== 'playing') return events;
  state.day++;
  state.dayTimeMs = 0;
  events.push({ type: 'newday', day: state.day });
  applyRain(state, config, events);
  return events;
}

function checkComplete(state, config, events) {
  if (state.phase === 'playing'
    && state.totalEarned >= (config.scoring.targetCoins ?? Infinity)) {
    state.phase = 'complete';
    events.push({
      type: 'complete', coins: state.coins, earned: state.totalEarned, day: state.day,
    });
  }
}

export function plantAt(state, config, col, row, cropIndex = state.cropIndex) {
  const events = [];
  if (state.phase !== 'playing') return events;
  const i = plotIndex(config, col, row);
  if (i < 0) return events;
  if (!Number.isInteger(cropIndex) || cropIndex < 0
    || cropIndex >= config.crops.length) {
    return events;
  }
  const plot = state.plots[i];
  if (plot.crop !== null) return events; // occupied
  const crop = config.crops[cropIndex];
  if (state.coins < crop.seedCost) {
    events.push({ type: 'denied', reason: 'funds', col, row });
    return events;
  }
  state.coins -= crop.seedCost;
  state.planted++;
  state.plots[i] = { crop: cropIndex, stage: 0, growthMs: 0, watered: false };
  events.push({ type: 'plant', col, row, crop: crop.id, coins: state.coins });
  return events;
}

export function waterAt(state, config, col, row) {
  const events = [];
  if (state.phase !== 'playing') return events;
  const i = plotIndex(config, col, row);
  if (i < 0) return events;
  const plot = state.plots[i];
  if (plot.crop === null || plot.watered) return events;
  if (isMature(config.crops[plot.crop], plot)) return events; // mature needs no water
  plot.watered = true;
  events.push({ type: 'water', col, row });
  return events;
}

export function harvestAt(state, config, col, row) {
  const events = [];
  if (state.phase !== 'playing') return events;
  const i = plotIndex(config, col, row);
  if (i < 0) return events;
  const plot = state.plots[i];
  if (plot.crop === null) return events;
  const crop = config.crops[plot.crop];
  if (!isMature(crop, plot)) {
    events.push({ type: 'denied', reason: 'unripe', col, row });
    return events;
  }
  state.coins += crop.sellPrice;
  state.totalEarned += crop.sellPrice;
  state.harvested++;
  state.plots[i] = { crop: null, stage: 0, growthMs: 0, watered: false };
  events.push({
    type: 'harvest', col, row, crop: crop.id,
    coins: state.coins, earned: state.totalEarned,
  });
  checkComplete(state, config, events);
  return events;
}

// One plot action per tick, then time advance. Input:
// { tool?, cropIndex?, col?, row?, nextDay? } — all optional.
export function stepGame(state, config, input = {}, dtMs = 16) {
  const events = [];
  if (state.phase !== 'playing') return events;
  const dt = clamp(dtMs, 0, 1000);
  state.tick++;
  state.timeMs += dt;

  if (input.tool !== undefined) setTool(state, input.tool);
  if (input.cropIndex !== undefined) selectCrop(state, config, input.cropIndex);
  if (input.col !== undefined && input.row !== undefined) {
    const tool = input.tool ?? state.tool;
    if (tool === 'plant') {
      events.push(...plantAt(state, config, input.col, input.row,
        input.cropIndex ?? state.cropIndex));
    } else if (tool === 'water') {
      events.push(...waterAt(state, config, input.col, input.row));
    } else if (tool === 'harvest') {
      events.push(...harvestAt(state, config, input.col, input.row));
    }
    if (state.phase !== 'playing') return events; // completed by this harvest
  }
  if (input.nextDay) events.push(...advanceDay(state, config));

  // Growth: watered crops accumulate stage time; each finished stage dries
  // the plot so the next stage needs watering again.
  for (let i = 0; i < state.plots.length; i++) {
    const plot = state.plots[i];
    if (plot.crop === null || !plot.watered) continue;
    const crop = config.crops[plot.crop];
    if (isMature(crop, plot)) continue;
    plot.growthMs += dt;
    const need = crop.stageTimeSec * 1000;
    if (plot.growthMs >= need) {
      plot.growthMs = 0;
      plot.stage++;
      plot.watered = false;
      const col = i % config.farm.cols;
      const row = Math.floor(i / config.farm.cols);
      if (isMature(crop, plot)) {
        events.push({ type: 'mature', col, row, crop: crop.id });
      } else {
        events.push({ type: 'grow', col, row, crop: crop.id, stage: plot.stage });
      }
    }
  }

  // Day cycle.
  state.dayTimeMs += dt;
  const dayLen = config.farm.dayLengthSec * 1000;
  let guard = 8;
  while (state.dayTimeMs >= dayLen && guard-- > 0) {
    state.dayTimeMs -= dayLen;
    state.day++;
    events.push({ type: 'newday', day: state.day });
    applyRain(state, config, events);
  }
  return events;
}

// Autopilot used by the demo (?demo-input=1) and the logic autotest:
// harvest ripe crops, water thirsty ones, plant the dearest affordable seed
// in empty plots, otherwise wait for time to pass.
export function suggestInput(state, config) {
  if (state.phase !== 'playing') return {};
  const { cols } = config.farm;
  let thirsty = null;
  let empty = null;
  for (let i = 0; i < state.plots.length; i++) {
    const plot = state.plots[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    if (plot.crop === null) {
      if (!empty) empty = { col, row };
      continue;
    }
    const crop = config.crops[plot.crop];
    if (isMature(crop, plot)) return { tool: 'harvest', col, row };
    if (!plot.watered && !thirsty) thirsty = { col, row };
  }
  if (thirsty) return { tool: 'water', ...thirsty };
  if (empty) {
    let best = -1;
    for (let i = 0; i < config.crops.length; i++) {
      if (config.crops[i].seedCost <= state.coins) best = i; // crops ascend in value
    }
    if (best >= 0) return { tool: 'plant', ...empty, cropIndex: best };
  }
  return {};
}

// Compact comparable snapshot for determinism checks.
export function summarize(state) {
  return {
    tick: state.tick,
    timeMs: Math.round(state.timeMs),
    day: state.day,
    phase: state.phase,
    coins: state.coins,
    totalEarned: state.totalEarned,
    planted: state.planted,
    harvested: state.harvested,
    plots: state.plots.map((p) => [p.crop, p.stage, p.watered ? 1 : 0]),
  };
}
