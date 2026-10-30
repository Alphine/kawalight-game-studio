// In-page logic self-check (?autotest=1). Drives logic.js directly (no Phaser)
// and writes a PASS/FAIL marker into the DOM for the headless smoke test.

import {
  createGame, stepGame, pauseGame, resumeGame, suggestInput, summarize,
} from './logic.js';

export async function runAutotest(config, seed) {
  const errors = [];
  const check = (cond, msg) => { if (!cond) errors.push(msg); };
  let summary = null;
  try {
    const play = () => {
      const s = createGame(config, { seed });
      for (let i = 0; i < 2000 && s.phase === 'playing'; i++) {
        stepGame(s, config, suggestInput(s, config), 100);
      }
      return s;
    };
    const a = play();
    const b = play();
    summary = summarize(a);
    check(a.planted > 0, 'autopilot never planted');
    check(a.harvested > 0, `autopilot never harvested (day ${a.day})`);
    check(a.totalEarned > 0, 'no coins earned');
    check(a.day >= 2, `day cycle never advanced (day ${a.day})`);
    check(JSON.stringify(summarize(a)) === JSON.stringify(summarize(b)),
      'nondeterministic simulation');
    // Pause freezes the sim (time, growth, and days).
    const p = createGame(config, { seed });
    stepGame(p, config, suggestInput(p, config), 100);
    pauseGame(p);
    const frozen = summarize(p);
    for (let i = 0; i < 50; i++) stepGame(p, config, suggestInput(p, config), 100);
    check(JSON.stringify(summarize(p)) === JSON.stringify(frozen),
      'paused sim kept changing');
    resumeGame(p);
    stepGame(p, config, {}, 100);
    check(summarize(p).tick === frozen.tick + 1, 'resume did not continue the sim');
    // Restart cleanliness: a fresh sim is independent.
    const fresh = createGame(config, { seed });
    check(fresh.coins === config.scoring.startCoins && fresh.tick === 0
      && fresh.phase === 'playing' && fresh.day === 1,
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
