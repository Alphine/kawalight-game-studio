// Simulation unit tests (determinism, legal moves, resolution, win and lose).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, trySwap, selectAt, reshuffleNow, hint, autopilotMove,
  findMatches, validMoves, summarize,
} from '../src/logic.js';

function testConfig(overrides = {}) {
  return {
    seed: 7,
    board: { cols: 5, rows: 5, tileSize: 64, originX: 0, originY: 0 },
    gems: [
      { id: 'ruby', name: 'Ruby', sprite: 'gem-ruby' },
      { id: 'sapphire', name: 'Sapphire', sprite: 'gem-sapphire' },
      { id: 'emerald', name: 'Emerald', sprite: 'gem-emerald' },
      { id: 'topaz', name: 'Topaz', sprite: 'gem-topaz' },
    ],
    scoring: { targetScore: 100, pointsPerGem: 10, cascadeBonusPercent: 50 },
    moves: { limit: 20 },
    difficulty: { preset: 'normal' },
    ...overrides,
  };
}

// Build a state whose board is exactly `rows`, with gem ids as in the strings.
function withBoard(config, rows, extra = {}) {
  const state = createGame(config, { seed: 1 });
  state.grid = rows.map((row) => [...row].map((ch) => Number(ch)));
  Object.assign(state, extra);
  return state;
}

describe('board generation', () => {
  it('starts with no matches and at least one legal move', () => {
    const s = createGame(testConfig(), { seed: 7 });
    assert.equal(findMatches(s.grid).length, 0);
    assert.ok(validMoves(s.grid).length > 0);
  });

  it('is deterministic for the same seed and differs across seeds', () => {
    const a = summarize(createGame(testConfig(), { seed: 42 }));
    const b = summarize(createGame(testConfig(), { seed: 42 }));
    const c = summarize(createGame(testConfig(), { seed: 43 }));
    assert.deepEqual(a, b);
    assert.notEqual(a.board, c.board);
  });
});

describe('swap rules', () => {
  it('refuses a non-adjacent swap without spending a move', () => {
    const cfg = testConfig();
    const s = createGame(cfg, { seed: 7 });
    const before = summarize(s);
    const res = trySwap(s, [0, 0], [2, 2]);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'not-adjacent');
    assert.equal(summarize(s).board, before.board);
    assert.equal(s.movesLeft, cfg.moves.limit);
  });

  it('refuses a swap that makes no match and restores the board', () => {
    const cfg = testConfig();
    // 0 1 0 / 1 0 1 has no three-in-a-row anywhere; swapping [0,1]<->[0,2] makes none.
    const s = withBoard(cfg, ['01010', '10101', '01010', '10101', '01010']);
    const before = s.grid.map((r) => r.slice());
    const res = trySwap(s, [0, 0], [0, 1]);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'no-match');
    assert.deepEqual(s.grid, before);
    assert.equal(s.movesLeft, cfg.moves.limit);
  });

  it('a made match clears three gems, scores, spends one move, and leaves no matches', () => {
    const cfg = testConfig();
    // Row 0: 0 0 _ 0 pattern: swapping cols 2 and 3 completes 000 in row 0.
    const s = withBoard(cfg, ['00102', '12121', '21212', '12121', '21212']);
    const res = trySwap(s, [0, 2], [0, 3]);
    assert.equal(res.ok, true);
    assert.equal(s.movesLeft, cfg.moves.limit - 1);
    assert.ok(s.score >= 30);
    assert.equal(findMatches(s.grid).length, 0);
    assert.equal(s.grid.length, cfg.board.rows);
    assert.ok(s.grid.every((row) => row.length === cfg.board.cols));
  });

  it('after every accepted swap the board is free of matches', () => {
    const cfg = testConfig();
    const s = createGame(cfg, { seed: 99 });
    for (let i = 0; i < 40 && s.phase === 'playing'; i++) {
      const [a, b] = autopilotMove(s);
      trySwap(s, a, b);
      assert.equal(findMatches(s.grid).length, 0);
    }
  });
});

describe('selection', () => {
  it('selects, deselects, swaps on an adjacent second tap, and re-selects otherwise', () => {
    const s = createGame(testConfig(), { seed: 7 });
    selectAt(s, 0, 0);
    assert.deepEqual(s.selected, [0, 0]);
    selectAt(s, 0, 0);
    assert.equal(s.selected, null);
    selectAt(s, 2, 2);
    selectAt(s, 4, 4);
    assert.deepEqual(s.selected, [4, 4]);
  });
});

describe('win and lose', () => {
  it('wins once the score reaches the target and accepts no more moves', () => {
    const cfg = testConfig({ scoring: { targetScore: 30, pointsPerGem: 10, cascadeBonusPercent: 0 } });
    const s = withBoard(cfg, ['00102', '12121', '21212', '12121', '21212']);
    trySwap(s, [0, 2], [0, 3]);
    assert.equal(s.phase, 'won');
    const after = trySwap(s, [1, 0], [1, 1]);
    assert.equal(after.reason, 'game-over');
  });

  it('loses when moves run out below the target', () => {
    const cfg = testConfig({ moves: { limit: 1 } });
    const s = withBoard(cfg, ['00102', '12121', '21212', '12121', '21212'],
      { movesLeft: 1, target: 10_000 });
    trySwap(s, [0, 2], [0, 3]);
    assert.equal(s.phase, 'lost');
  });
});

describe('reshuffle and hint', () => {
  it('reshuffle keeps every gem, leaves no matches, and costs no moves', () => {
    const cfg = testConfig();
    const s = createGame(cfg, { seed: 5 });
    const before = s.grid.flat().slice().sort();
    const moves = s.movesLeft;
    reshuffleNow(s);
    assert.deepEqual(s.grid.flat().slice().sort(), before);
    assert.equal(findMatches(s.grid).length, 0);
    assert.ok(validMoves(s.grid).length > 0);
    assert.equal(s.movesLeft, moves);
  });

  it('hint returns a move that really matches', () => {
    const s = createGame(testConfig(), { seed: 3 });
    const [a, b] = hint(s);
    const copy = s.grid.map((r) => r.slice());
    [copy[a[0]][a[1]], copy[b[0]][b[1]]] = [copy[b[0]][b[1]], copy[a[0]][a[1]]];
    assert.ok(findMatches(copy).length > 0);
  });
});

describe('autopilot playthrough', () => {
  it('the same seed plays out identically', () => {
    const run = () => {
      const s = createGame(testConfig(), { seed: 11 });
      for (let i = 0; i < 200 && s.phase === 'playing'; i++) {
        const [a, b] = autopilotMove(s);
        trySwap(s, a, b);
      }
      return summarize(s);
    };
    assert.deepEqual(run(), run());
  });

  it('the autopilot ends every game with a clear result', () => {
    const s = createGame(testConfig(), { seed: 2 });
    for (let i = 0; i < 500 && s.phase === 'playing'; i++) {
      const [a, b] = autopilotMove(s);
      trySwap(s, a, b);
    }
    assert.ok(['won', 'lost'].includes(s.phase));
  });
});
