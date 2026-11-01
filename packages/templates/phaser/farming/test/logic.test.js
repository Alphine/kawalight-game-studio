// Simulation unit tests (SDD §3.5 acceptance + NFR-004 determinism).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, stepGame, plantAt, waterAt, harvestAt, advanceDay,
  pauseGame, resumeGame, setTool, selectCrop, summarize, suggestInput,
} from '../src/logic.js';

function testConfig() {
  return {
    seed: 7,
    world: { width: 480, height: 270 },
    farm: { cols: 3, rows: 2, plotSize: 96, originX: 0, originY: 0, dayLengthSec: 30 },
    crops: [
      {
        id: 'turnip', name: 'Turnip', sprite: 'crop-turnip',
        seedCost: 5, sellPrice: 12, stages: 2, stageTimeSec: 5,
      },
      {
        id: 'pumpkin', name: 'Pumpkin', sprite: 'crop-pumpkin',
        seedCost: 20, sellPrice: 55, stages: 3, stageTimeSec: 6,
      },
    ],
    scoring: { startCoins: 50, targetCoins: 200 },
    difficulty: { preset: 'normal' },
    controls: {
      toolPlant: 'ONE', toolWater: 'TWO', toolHarvest: 'THREE',
      nextDay: 'N', pause: 'P',
    },
    assets: { sprites: { soil: 'assets/soil.png' } },
  };
}

function run(state, config, ticks, input = {}, dt = 100) {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...stepGame(state, config, input, dt));
  return events;
}

// Plant + water until mature, then return the plot.
function growMature(state, config, col, row, cropIndex = 0) {
  plantAt(state, config, col, row, cropIndex);
  const crop = config.crops[cropIndex];
  for (let s = 0; s < crop.stages; s++) {
    waterAt(state, config, col, row);
    run(state, config, Math.ceil((crop.stageTimeSec * 1000) / 100));
  }
  return state.plots[row * config.farm.cols + col];
}

describe('planting', () => {
  it('plants on empty plots and deducts the seed cost', () => {
    const config = testConfig();
    const s = createGame(config);
    const events = plantAt(s, config, 0, 0, 0);
    assert.ok(events.some((e) => e.type === 'plant'));
    assert.equal(s.coins, 45);
    assert.equal(s.planted, 1);
    assert.deepEqual(s.plots[0], { crop: 0, stage: 0, growthMs: 0, watered: false });
  });

  it('rejects occupied plots, bad crops, and out-of-bounds plots', () => {
    const config = testConfig();
    const s = createGame(config);
    plantAt(s, config, 1, 1, 0);
    assert.deepEqual(plantAt(s, config, 1, 1, 1), []); // occupied
    assert.deepEqual(plantAt(s, config, 0, 1, 99), []); // bad crop
    assert.deepEqual(plantAt(s, config, 9, 9, 0), []); // out of bounds
    assert.deepEqual(plantAt(s, config, -1, 0, 0), []);
    assert.equal(s.coins, 45); // only the first plant charged
  });

  it('denies planting without funds', () => {
    const config = testConfig();
    const s = createGame(config);
    s.coins = 3;
    const events = plantAt(s, config, 0, 0, 0);
    assert.ok(events.some((e) => e.type === 'denied' && e.reason === 'funds'));
    assert.equal(s.plots[0].crop, null);
  });

  it('applies the selected tool through stepGame input', () => {
    const config = testConfig();
    const s = createGame(config);
    run(s, config, 1, { tool: 'plant', col: 2, row: 0, cropIndex: 1 });
    assert.equal(s.plots[2].crop, 1);
    assert.equal(s.coins, 30);
    assert.equal(s.tool, 'plant');
  });
});

describe('watering and growth', () => {
  it('grows only while watered, one watering per stage', () => {
    const config = testConfig();
    const s = createGame(config);
    plantAt(s, config, 0, 0, 0);
    run(s, config, 100); // dry: no growth at all
    assert.equal(s.plots[0].stage, 0);
    waterAt(s, config, 0, 0);
    run(s, config, 50); // 5s watered: first stage done
    assert.equal(s.plots[0].stage, 1);
    assert.equal(s.plots[0].watered, false); // stage dried the plot
    run(s, config, 50); // dry again: stalled, never withers
    assert.equal(s.plots[0].stage, 1);
  });

  it('matures after the final stage and emits grow/mature events', () => {
    const config = testConfig();
    const s = createGame(config);
    plantAt(s, config, 0, 0, 0);
    waterAt(s, config, 0, 0);
    const e1 = run(s, config, 50);
    assert.ok(e1.some((e) => e.type === 'grow'));
    waterAt(s, config, 0, 0);
    const e2 = run(s, config, 50);
    assert.ok(e2.some((e) => e.type === 'mature'));
    assert.equal(s.plots[0].stage, 2); // stages == 2
  });

  it('ignores watering empty, wet, or mature plots', () => {
    const config = testConfig();
    const s = createGame(config);
    assert.deepEqual(waterAt(s, config, 0, 0), []); // empty
    plantAt(s, config, 0, 0, 0);
    assert.equal(waterAt(s, config, 0, 0).length, 1);
    assert.deepEqual(waterAt(s, config, 0, 0), []); // already wet
    const m = createGame(config);
    growMature(m, config, 1, 0);
    assert.deepEqual(waterAt(m, config, 1, 0), []); // mature
  });
});

describe('harvest and coins', () => {
  it('pays the sell price and clears the plot', () => {
    const config = testConfig();
    const s = createGame(config);
    growMature(s, config, 0, 0, 1); // pumpkin: -20, +55
    const events = harvestAt(s, config, 0, 0);
    assert.ok(events.some((e) => e.type === 'harvest'));
    assert.equal(s.coins, 50 - 20 + 55);
    assert.equal(s.totalEarned, 55);
    assert.equal(s.harvested, 1);
    assert.equal(s.plots[0].crop, null);
  });

  it('denies harvest on empty or unripe plots', () => {
    const config = testConfig();
    const s = createGame(config);
    assert.deepEqual(harvestAt(s, config, 0, 0), []); // empty
    plantAt(s, config, 0, 0, 0);
    const events = harvestAt(s, config, 0, 0);
    assert.ok(events.some((e) => e.type === 'denied' && e.reason === 'unripe'));
    assert.equal(s.totalEarned, 0);
  });

  it('completes the run at the earnings target and freezes', () => {
    const config = testConfig();
    config.scoring.targetCoins = 12; // one turnip wins
    const s = createGame(config);
    growMature(s, config, 0, 0, 0);
    const events = harvestAt(s, config, 0, 0);
    assert.ok(events.some((e) => e.type === 'complete'));
    assert.equal(s.phase, 'complete');
    const frozen = summarize(s);
    run(s, config, 30, { tool: 'plant', col: 1, row: 1 });
    assert.deepEqual(summarize(s), frozen);
  });

  it('completes via stepGame when the target is already met', () => {
    const config = testConfig();
    const s = createGame(config);
    s.totalEarned = config.scoring.targetCoins; // e.g. restored progress
    const events = stepGame(s, config, {}, 100);
    assert.ok(events.some((e) => e.type === 'complete'));
    assert.equal(s.phase, 'complete');
  });

  it('completes at creation for a trivially-satisfied target', () => {
    const config = testConfig();
    config.scoring.targetCoins = 0; // hand-fed: nothing left to earn
    const s = createGame(config);
    assert.equal(s.phase, 'complete');
  });
});

describe('day cycle and rain', () => {
  it('auto-advances the day on the timer and on sleep', () => {
    const config = testConfig();
    const s = createGame(config);
    const events = run(s, config, 300); // 30s day
    assert.ok(events.some((e) => e.type === 'newday' && e.day === 2));
    assert.equal(s.day, 2);
    const slept = stepGame(s, config, { nextDay: true }, 100);
    assert.ok(slept.some((e) => e.type === 'newday' && e.day === 3));
  });

  it('rains deterministically: same seed, same watered plots', () => {
    const config = testConfig();
    const morning = (seed) => {
      const s = createGame(config, { seed });
      for (let c = 0; c < 3; c++) plantAt(s, config, c, 0, 0);
      advanceDay(s, config);
      return summarize(s).plots;
    };
    assert.deepEqual(morning(7), morning(7));
  });

  it('different seeds diverge the rain pattern', () => {
    const config = testConfig();
    const morning = (seed) => {
      const s = createGame(config, { seed });
      for (let c = 0; c < 3; c++) {
        plantAt(s, config, c, 0, 0);
        plantAt(s, config, c, 1, 1);
      }
      const rain = [];
      for (let d = 0; d < 4; d++) rain.push(...advanceDay(s, config));
      return JSON.stringify({ rain, plots: summarize(s).plots });
    };
    assert.notEqual(morning(1), morning(2));
  });
});

describe('tools and selection', () => {
  it('selects tools and crops, rejecting invalid ones', () => {
    const config = testConfig();
    const s = createGame(config);
    assert.equal(setTool(s, 'water'), true);
    assert.equal(setTool(s, 'plow'), false);
    assert.equal(s.tool, 'water');
    assert.equal(selectCrop(s, config, 1), true);
    assert.equal(selectCrop(s, config, 5), false);
    assert.equal(s.cropIndex, 1);
  });
});

describe('autopilot', () => {
  it('plants, waters, and harvests its way to the goal', () => {
    const config = testConfig();
    const s = createGame(config);
    for (let i = 0; i < 3000 && s.phase === 'playing'; i++) {
      stepGame(s, config, suggestInput(s, config), 100);
    }
    assert.ok(s.planted > 0, 'never planted');
    assert.ok(s.harvested > 0, 'never harvested');
    assert.equal(s.phase, 'complete');
  });

  it('idles safely with no affordable seed', () => {
    const config = testConfig();
    const s = createGame(config);
    s.coins = 0;
    assert.deepEqual(suggestInput(s, config), {});
    run(s, config, 10, suggestInput(s, config));
    assert.equal(s.phase, 'playing');
  });
});

describe('pause, restart, determinism', () => {
  it('freezes when paused and resumes', () => {
    const config = testConfig();
    const s = createGame(config);
    plantAt(s, config, 0, 0, 0);
    pauseGame(s);
    const before = summarize(s);
    run(s, config, 30, { tool: 'water', col: 0, row: 0 });
    assert.deepEqual(summarize(s), before);
    assert.deepEqual(plantAt(s, config, 1, 1, 0), []);
    resumeGame(s);
    run(s, config, 1, { tool: 'water', col: 0, row: 0 });
    assert.equal(s.plots[0].watered, true);
  });

  it('restart returns a clean independent state', () => {
    const config = testConfig();
    const a = createGame(config);
    run(a, config, 60, { tool: 'plant', col: 0, row: 0 });
    assert.ok(a.tick > 0);
    const b = createGame(config);
    assert.equal(b.tick, 0);
    assert.equal(b.coins, config.scoring.startCoins);
    assert.equal(b.phase, 'playing');
    assert.equal(b.day, 1);
  });

  it('same seed + same inputs = same summary (NFR-004)', () => {
    const config = testConfig();
    const script = (s) => {
      for (let i = 0; i < 500 && s.phase === 'playing'; i++) {
        stepGame(s, config, suggestInput(s, config), 100);
      }
      return summarize(s);
    };
    const a = script(createGame(config));
    const b = script(createGame(config));
    assert.deepEqual(a, b);
  });
});

describe('growth overflow', () => {
  it('carries leftover growth into the next stage', () => {
    const config = testConfig();
    const s = createGame(config);
    plantAt(s, config, 0, 0, 0); // turnip: stageTimeSec 5
    waterAt(s, config, 0, 0);
    s.plots[0].growthMs = 4900;
    stepGame(s, config, {}, 1000);
    assert.equal(s.plots[0].stage, 1);
    assert.equal(s.plots[0].growthMs, 900);
  });
});
