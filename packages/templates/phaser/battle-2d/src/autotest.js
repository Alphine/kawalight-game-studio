// In-page logic self-check (?autotest=1). Drives logic.js directly (no Phaser)
// and writes a PASS/FAIL marker into the DOM for the headless smoke test.

import { createGame, stepGame, suggestInput, summarize } from './logic.js';

const IDLE = { up: false, down: false, left: false, right: false, fire: false, melee: false };

// Scripted brawl: walk at the nearest foe with both attacks held.
function brawlInput(s) {
  let best = null;
  let bestD2 = Infinity;
  for (const e of s.enemies) {
    const dx = e.x - s.player.x;
    const dy = e.y - s.player.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = e;
    }
  }
  if (!best) return { ...IDLE, fire: true };
  return {
    up: best.y < s.player.y - 4,
    down: best.y > s.player.y + 4,
    left: best.x < s.player.x - 4,
    right: best.x > s.player.x + 4,
    fire: true,
    melee: true,
  };
}

export async function runAutotest(config, seed) {
  const errors = [];
  const check = (cond, msg) => { if (!cond) errors.push(msg); };
  let summary = null;
  try {
    const play = () => {
      const s = createGame(config, { seed });
      for (let i = 0; i < 1200; i++) { // ~19 simulated seconds at 16ms
        stepGame(s, config, suggestInput(s, config), 16);
        if (s.phase === 'gameover' || s.phase === 'stageclear') break;
      }
      for (let i = 0; i < 400 && s.phase === 'playing'; i++) {
        stepGame(s, config, brawlInput(s), 16);
      }
      return s;
    };
    const a = play();
    const b = play();
    summary = summarize(a);
    check(a.phase === 'playing' || a.phase === 'stageclear' || a.phase === 'gameover',
      `unexpected end phase: ${a.phase}`);
    check(a.shotsFired > 0, 'autotest fired no shots');
    check(a.meleeSwings > 0, 'autotest never swung melee');
    check(a.score >= 0, 'negative score');
    check(a.shots.filter((s) => s.active).length <= config.ranged.poolSize,
      'shot pool overflow');
    check(a.foeShots.filter((s) => s.active).length <= config.foeShots.poolSize,
      'foe-shot pool overflow');
    check(JSON.stringify(summarize(a)) === JSON.stringify(summarize(b)),
      'nondeterministic simulation');
    // Idle brawler must eventually fall: standing still is fatal.
    const idle = createGame(config, { seed });
    for (let i = 0; i < 6000 && idle.phase === 'playing'; i++) {
      stepGame(idle, config, IDLE, 16);
    }
    check(idle.phase === 'gameover', 'idle run never ended in game over');
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
