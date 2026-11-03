// In-page logic self-check (?autotest=1). Drives logic.js directly (no Phaser)
// and writes a PASS/FAIL marker into the DOM for the headless smoke test.

import {
  createGame, trySwap, autopilotMove, findMatches, reshuffleNow, summarize,
} from './logic.js';

function play(config, seed) {
  const s = createGame(config, { seed });
  for (let i = 0; i < 500 && s.phase === 'playing'; i++) {
    const move = autopilotMove(s);
    if (!move) break;
    trySwap(s, move[0], move[1]);
  }
  return s;
}

export async function runAutotest(config, seed) {
  const errors = [];
  const check = (cond, msg) => { if (!cond) errors.push(msg); };
  let summary = null;
  try {
    const first = createGame(config, { seed });
    check(findMatches(first.grid).length === 0, 'board starts with matches');
    const a = play(config, seed);
    const b = play(config, seed);
    summary = summarize(a);
    check(a.phase !== 'playing', 'autopilot did not finish the game');
    check(a.cleared > 0, 'autopilot never cleared a gem');
    check(JSON.stringify(summarize(a)) === JSON.stringify(summarize(b)),
      'nondeterministic simulation');
    // Reshuffle costs no moves and keeps the board legal.
    const r = createGame(config, { seed });
    const moves = r.movesLeft;
    reshuffleNow(r);
    check(r.movesLeft === moves && findMatches(r.grid).length === 0,
      'reshuffle broke the board or cost a move');
  } catch (err) {
    errors.push(`exception: ${err && err.message}`);
  }
  const pass = errors.length === 0;
  const el = document.getElementById('kgsm-autotest');
  el.hidden = false;
  el.textContent = `${pass ? 'KGSM-AUTOTEST-PASS' : 'KGSM-AUTOTEST-FAIL'} `
    + JSON.stringify({ errors: errors.slice(0, 10), summary });
  document.title = `${pass ? 'PASS' : 'FAIL'} - autotest`;
  return pass;
}
