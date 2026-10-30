// In-page logic self-check (?autotest=1). Drives logic.js directly (no Phaser)
// and writes a PASS/FAIL marker into the DOM for the headless smoke test.

import { createGame, stepGame, suggestInput, summarize } from './logic.js';

const RIGHT = { left: false, right: true, jump: false };

export async function runAutotest(config, seed) {
  const errors = [];
  const check = (cond, msg) => { if (!cond) errors.push(msg); };
  let summary = null;
  try {
    const play = () => {
      const s = createGame(config, { seed });
      for (let i = 0; i < 3600 && s.phase === 'playing'; i++) {
        stepGame(s, config, suggestInput(s, config), 16);
      }
      return s;
    };
    const a = play();
    const b = play();
    summary = summarize(a);
    check(a.phase === 'won',
      `autopilot did not finish (phase ${a.phase}, tick ${a.tick}, x ${Math.round(a.player.x)})`);
    check(a.coins > 0, 'autotest collected no coins');
    check(a.score > 0, 'no score accumulated');
    check(a.checkpointId !== null, 'autotest never reached a checkpoint');
    check(JSON.stringify(summarize(a)) === JSON.stringify(summarize(b)),
      'nondeterministic simulation');
    // A blind run (hold right, never jump) must lose: pits drain all health.
    const blind = createGame(config, { seed });
    for (let i = 0; i < 6000 && blind.phase === 'playing'; i++) {
      stepGame(blind, config, RIGHT, 16);
    }
    check(blind.phase === 'gameover', 'blind run never lost');
    // Restart cleanliness: a fresh sim is independent.
    const fresh = createGame(config, { seed });
    check(fresh.score === 0 && fresh.tick === 0 && fresh.phase === 'playing',
      'fresh sim is not clean');
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
