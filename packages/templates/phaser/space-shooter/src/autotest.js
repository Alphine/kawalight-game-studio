// In-page logic self-check (?autotest=1). Drives logic.js directly (no Phaser)
// and writes a PASS/FAIL marker into the DOM for the headless smoke test.

import { createGame, stepGame, summarize } from './logic.js';

const IDLE = { up: false, down: false, left: false, right: false, fire: false };

export async function runAutotest(config, seed) {
  const errors = [];
  const check = (cond, msg) => { if (!cond) errors.push(msg); };
  let summary = null;
  try {
    const play = () => {
      const s = createGame(config, { seed });
      const phases = ['right', 'up', 'left', 'down'];
      for (let i = 0; i < 1200; i++) { // ~19 simulated seconds at 16ms
        const dir = phases[Math.floor(i / 300) % 4];
        stepGame(s, config, { ...IDLE, fire: i % 3 !== 2, [dir]: true }, 16);
        if (s.phase === 'gameover' || s.phase === 'stageclear') break;
      }
      return s;
    };
    const a = play();
    const b = play();
    summary = summarize(a);
    check(a.phase === 'playing' || a.phase === 'stageclear' || a.phase === 'gameover',
      `unexpected end phase: ${a.phase}`);
    check(a.shotsFired > 0, 'autotest fired no shots');
    check(a.score >= 0, 'negative score');
    check(a.shots.filter((s) => s.active).length <= config.weapon.poolSize,
      'shot pool overflow');
    check(JSON.stringify(summarize(a)) === JSON.stringify(summarize(b)),
      'nondeterministic simulation');
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
