// Keyboard input from template config + arrow-key fallback.

const FALLBACK = { up: 'W', down: 'S', left: 'A', right: 'D', fire: 'SPACE', pause: 'P' };

export function readInput(keys, controls) {
  const c = { ...FALLBACK, ...(controls || {}) };
  const down = (name, alt) => {
    const k = keys[name] || (alt && keys[alt]);
    return !!(k && k.isDown);
  };
  return {
    up: down(c.up, 'UP') || down('UP'),
    down: down(c.down, 'DOWN') || down('DOWN'),
    left: down(c.left, 'LEFT') || down('LEFT'),
    right: down(c.right, 'RIGHT') || down('RIGHT'),
    fire: down(c.fire, 'Z') || down('Z'),
  };
}

// Phaser key-name -> keycode helper for scene wiring.
export function keyCodes(Phaser, controls) {
  const c = { ...FALLBACK, ...(controls || {}) };
  const KC = Phaser.Input.Keyboard.KeyCodes;
  const code = (name) => KC[name] ?? KC[name?.toUpperCase()] ?? null;
  return {
    up: [code(c.up), KC.UP].filter(Boolean),
    down: [code(c.down), KC.DOWN].filter(Boolean),
    left: [code(c.left), KC.LEFT].filter(Boolean),
    right: [code(c.right), KC.RIGHT].filter(Boolean),
    fire: [code(c.fire), KC.Z].filter(Boolean),
    pause: [code(c.pause), KC.ESC].filter(Boolean),
  };
}
