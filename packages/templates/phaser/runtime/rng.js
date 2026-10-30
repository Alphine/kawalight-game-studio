// Shared Phaser runtime services (SDD §1: input, scenes, audio, UI, save, debug).
// ES modules; game-agnostic. Versioned with each genre template.

export const RUNTIME_VERSION = '1.0.0';

// Seeded RNG (mulberry32). State is one serializable number.
export function createRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return {
    get state() { return s >>> 0; },
    set state(v) { s = v >>> 0; },
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(min, max) { return min + this.next() * (max - min); },
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; },
  };
}
