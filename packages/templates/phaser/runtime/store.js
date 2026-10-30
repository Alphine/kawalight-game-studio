// Local save data (per-game key namespace). try/catch: private mode safe.

export function createStore(gameKey) {
  const prefix = `kgsm:${gameKey}:`;
  const mem = new Map();
  const backend = (() => {
    try {
      localStorage.setItem(`${prefix}probe`, '1');
      localStorage.removeItem(`${prefix}probe`);
      return localStorage;
    } catch {
      return null;
    }
  })();
  return {
    get(key, fallback = null) {
      try {
        if (backend) {
          const raw = backend.getItem(prefix + key);
          return raw === null ? fallback : JSON.parse(raw);
        }
        return mem.has(key) ? mem.get(key) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        if (backend) backend.setItem(prefix + key, JSON.stringify(value));
        else mem.set(key, value);
        return true;
      } catch {
        return false;
      }
    },
  };
}
