// Gem Rush simulation: a pure match-3 board (no Phaser). Deterministic for a
// given seed, so the same config and seed always play out the same way (NFR-004).
//
// Moves are turn-based: a swap that makes no match is refused and costs nothing.
// Every accepted swap resolves fully (clear, collapse, refill, cascades) and
// returns the events the scene animates. The scene never decides game rules.

const EMPTY = -1;

// Mulberry32 stored on the state, so the sequence survives copies and restarts.
function nextRandom(state) {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randomGem(state) {
  return Math.floor(nextRandom(state) * state.gemCount);
}

function emptyGrid(rows, cols) {
  return Array.from({ length: rows }, () => Array(cols).fill(EMPTY));
}

function cloneGrid(grid) {
  return grid.map((row) => row.slice());
}

// Cells that sit in a horizontal or vertical run of at least three equal gems.
export function findMatches(grid) {
  const rows = grid.length;
  const cols = rows ? grid[0].length : 0;
  const hit = new Set();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const gem = grid[r][c];
      if (gem === EMPTY) continue;
      if (c + 2 < cols && grid[r][c + 1] === gem && grid[r][c + 2] === gem) {
        hit.add(r * cols + c); hit.add(r * cols + c + 1); hit.add(r * cols + c + 2);
      }
      if (r + 2 < rows && grid[r + 1][c] === gem && grid[r + 2][c] === gem) {
        hit.add(r * cols + c); hit.add((r + 1) * cols + c); hit.add((r + 2) * cols + c);
      }
    }
  }
  return [...hit].sort((a, b) => a - b).map((k) => [Math.floor(k / cols), k % cols]);
}

function swapIn(grid, [r1, c1], [r2, c2]) {
  const t = grid[r1][c1];
  grid[r1][c1] = grid[r2][c2];
  grid[r2][c2] = t;
}

function adjacent([r1, c1], [r2, c2]) {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
}

// Every swap that would make a match, as [a, b] pairs (row-major, stable order).
export function validMoves(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  const moves = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const r2 = r + dr;
        const c2 = c + dc;
        if (r2 >= rows || c2 >= cols) continue;
        const copy = cloneGrid(grid);
        swapIn(copy, [r, c], [r2, c2]);
        if (findMatches(copy).length) moves.push([[r, c], [r2, c2]]);
      }
    }
  }
  return moves;
}

// Random board with no matches already on it and at least one move available.
function freshBoard(state) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const grid = emptyGrid(state.rows, state.cols);
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) grid[r][c] = randomGem(state);
    }
    if (findMatches(grid).length === 0 && validMoves(grid).length > 0) return grid;
  }
  // Deterministic fallback with a guaranteed move: alternate two gems per row.
  const grid = emptyGrid(state.rows, state.cols);
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) grid[r][c] = (r + c) % Math.min(3, state.gemCount);
  }
  return grid;
}

function shuffleBoard(state) {
  const gems = [];
  for (const row of state.grid) for (const g of row) gems.push(g);
  for (let i = gems.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    [gems[i], gems[j]] = [gems[j], gems[i]];
  }
  let k = 0;
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) state.grid[r][c] = gems[k++];
  }
}

// Shuffle until the board is quiet and playable again.
function reshuffle(state) {
  for (let attempt = 0; attempt < 500; attempt++) {
    shuffleBoard(state);
    if (findMatches(state.grid).length === 0 && validMoves(state.grid).length > 0) break;
  }
  state.reshuffles += 1;
  return { type: 'reshuffle', grid: cloneGrid(state.grid) };
}

// Gravity: gems fall into the gaps; new gems enter from the top.
function collapse(state) {
  const falls = [];
  const spawns = [];
  const { grid, rows, cols } = state;
  for (let c = 0; c < cols; c++) {
    let write = rows - 1;
    for (let r = rows - 1; r >= 0; r--) {
      if (grid[r][c] === EMPTY) continue;
      if (r !== write) {
        grid[write][c] = grid[r][c];
        falls.push({ from: [r, c], to: [write, c], gem: grid[write][c] });
        grid[r][c] = EMPTY;
      }
      write -= 1;
    }
    for (let r = write; r >= 0; r--) {
      grid[r][c] = randomGem(state);
      spawns.push({ at: [r, c], gem: grid[r][c] });
    }
  }
  return { falls, spawns };
}

function settle(state, events) {
  if (state.phase !== 'playing') return;
  if (state.score >= state.target) {
    state.phase = 'won';
  } else if (state.movesLeft <= 0) {
    state.phase = 'lost';
  } else if (validMoves(state.grid).length === 0) {
    events.push(reshuffle(state));
  }
}

export function createGame(config, { seed } = {}) {
  const rows = config.board.rows;
  const cols = config.board.cols;
  const startSeed = Number.isInteger(seed) ? seed : (config.seed ?? 1);
  const state = {
    rows,
    cols,
    gemCount: config.gems.length,
    rng: (startSeed >>> 0) || 1,
    grid: emptyGrid(rows, cols),
    score: 0,
    target: config.scoring.targetScore,
    pointsPerGem: config.scoring.pointsPerGem,
    cascadeBonus: config.scoring.cascadeBonusPercent,
    movesLeft: config.moves.limit,
    phase: 'playing',
    selected: null,
    tick: 0,
    cleared: 0,
    cascadeMax: 0,
    reshuffles: 0,
  };
  state.grid = freshBoard(state);
  return state;
}

// One accepted swap: returns { ok, events, reason? }. Refused swaps change nothing.
export function trySwap(state, a, b) {
  if (state.phase !== 'playing') return { ok: false, reason: 'game-over', events: [] };
  if (!adjacent(a, b)) return { ok: false, reason: 'not-adjacent', events: [] };
  swapIn(state.grid, a, b);
  if (findMatches(state.grid).length === 0) {
    swapIn(state.grid, a, b);
    return { ok: false, reason: 'no-match', events: [] };
  }
  state.tick += 1;
  state.movesLeft -= 1;
  state.selected = null;
  const events = [{ type: 'swap', a, b }];
  let cascade = 0;
  for (;;) {
    const matches = findMatches(state.grid);
    if (matches.length === 0) break;
    for (const [r, c] of matches) state.grid[r][c] = EMPTY;
    const points = Math.round(
      state.pointsPerGem * matches.length * (1 + (cascade * state.cascadeBonus) / 100));
    state.score += points;
    state.cleared += matches.length;
    state.cascadeMax = Math.max(state.cascadeMax, cascade);
    events.push({ type: 'clear', cells: matches, points, cascade });
    const { falls, spawns } = collapse(state);
    events.push({ type: 'fall', falls, spawns });
    cascade += 1;
  }
  settle(state, events);
  return { ok: true, events };
}

// Tap-to-select: first tap selects, an adjacent second tap swaps, anything else re-selects.
export function selectAt(state, r, c) {
  if (state.phase !== 'playing') return { ok: false, reason: 'game-over', events: [] };
  const cell = [r, c];
  if (!state.selected) {
    state.selected = cell;
    return { ok: true, events: [{ type: 'select', cell }] };
  }
  const [sr, sc] = state.selected;
  if (sr === r && sc === c) {
    state.selected = null;
    return { ok: true, events: [{ type: 'deselect', cell }] };
  }
  if (adjacent(state.selected, cell)) {
    return trySwap(state, state.selected, cell);
  }
  state.selected = cell;
  return { ok: true, events: [{ type: 'select', cell }] };
}

// Manual reshuffle (costs no moves). Refused once the game is over.
export function reshuffleNow(state) {
  if (state.phase !== 'playing') return { ok: false, reason: 'game-over', events: [] };
  state.tick += 1;
  const event = reshuffle(state);
  state.selected = null;
  return { ok: true, events: [event] };
}

// A valid swap to highlight for the player, or null when none exists.
export function hint(state) {
  const moves = validMoves(state.grid);
  return moves.length ? moves[0] : null;
}

// Greedy autopilot for the self-check: the swap that clears the most gems.
export function autopilotMove(state) {
  let best = null;
  let bestScore = -1;
  for (const [a, b] of validMoves(state.grid)) {
    const copy = cloneGrid(state.grid);
    swapIn(copy, a, b);
    const score = findMatches(copy).length;
    if (score > bestScore) { bestScore = score; best = [a, b]; }
  }
  return best;
}

export function summarize(state) {
  return {
    score: state.score,
    target: state.target,
    movesLeft: state.movesLeft,
    phase: state.phase,
    cleared: state.cleared,
    cascadeMax: state.cascadeMax,
    reshuffles: state.reshuffles,
    tick: state.tick,
    board: state.grid.map((row) => row.join('')).join('/'),
  };
}
