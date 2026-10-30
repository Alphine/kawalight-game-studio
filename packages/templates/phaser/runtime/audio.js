// Tiny WebAudio synth SFX. No audio assets needed; safe headless (lazy init).

export function createAudio() {
  let ctx = null;
  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    } catch {
      return null;
    }
    return ctx;
  }
  function blip({ freq = 440, end = null, dur = 0.08, type = 'square', gain = 0.05 }) {
    const ac = ensure();
    if (!ac) return;
    try {
      if (ac.state === 'suspended') void ac.resume();
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      if (end) osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), ac.currentTime + dur);
      g.gain.setValueAtTime(gain, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      osc.connect(g).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + dur + 0.02);
    } catch { /* audio is best-effort */ }
  }
  return {
    unlock() { ensure(); },
    shoot(power = 1) { blip({ freq: 620 + power * 60, end: 180, dur: 0.07 }); },
    boom(big = false) {
      blip(big
        ? { freq: 160, end: 30, dur: 0.4, type: 'sawtooth', gain: 0.08 }
        : { freq: 320, end: 60, dur: 0.18, type: 'sawtooth', gain: 0.06 });
    },
    pickup() { blip({ freq: 880, end: 1320, dur: 0.09, type: 'sine', gain: 0.06 }); },
    hurt() { blip({ freq: 220, end: 70, dur: 0.25, type: 'square', gain: 0.07 }); },
    win() { blip({ freq: 523, end: 1046, dur: 0.35, type: 'sine', gain: 0.06 }); },
  };
}
