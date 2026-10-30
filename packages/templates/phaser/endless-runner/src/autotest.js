// In-page logic self-check (?autotest=1). Drives logic.js directly (no Phaser)
// and writes a PASS/FAIL marker into the DOM for the headless smoke test.

import { createGame, stepGame, suggestInput, summarize } from './logic.js';

const IDLE = { jump: false, slide: false };

export async function runAutotest(config, seed) {
  const errors = [];
  const check = (cond, msg) => { if (!cond) errors.push(msg); };
  let summary = null;
  try {
    const play = () => {
      const s = createGame(config, { seed });
      for (let i = 0; i < 1500; i++) { // ~24 simulated seconds at 16ms
        stepGame(s, config, suggestInput(s, config), 16);
        if (s.phase === 'gameover') break;
      }
      return s;
    };
    const a = play();
    const b = play();
    summary = summarize(a);
    check(a.phase === 'playing',
      `autopilot died early (tick ${a.tick}, dist ${Math.round(a.distancePx)})`);
    check(a.player.jumps > 0, 'autotest never jumped');
    check(a.score > 0, 'no score accumulated');
    check(a.distancePx > (config.spawning.gracePx ?? 0), 'never left the grace zone');
    check(JSON.stringify(summarize(a)) === JSON.stringify(summarize(b)),
      'nondeterministic simulation');
    // Idle runner must eventually crash: one hit ends the run.
    const idle = createGame(config, { seed });
    for (let i = 0; i < 6000 && idle.phase === 'playing'; i++) {
      stepGame(idle, config, IDLE, 16);
    }
    check(idle.phase === 'gameover', 'idle run never crashed');
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
