// Shared juice helpers (SDD §1: common runtime services). Particle bursts,
// screen shake, hit flash, and floating score popups for genre templates.
// All helpers are defensive: they no-op (null) when the scene lacks the
// needed Phaser service, so they are safe in headless/smoke runs.

export const JUICE_VERSION = '1.0.0';

// Lazily generated 8x8 soft-dot texture so bursts need no asset files.
function ensureDotTexture(scene) {
  try {
    if (!scene || !scene.textures) return null;
    if (scene.textures.exists('kgsm-dot')) return 'kgsm-dot';
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 4);
    g.fillStyle(0xffffff, 0.6);
    g.fillCircle(4, 4, 2);
    g.generateTexture('kgsm-dot', 8, 8);
    g.destroy();
    return 'kgsm-dot';
  } catch {
    return null;
  }
}

function pick(arr, fallback) {
  if (!arr || !arr.length) return fallback;
  return arr[Math.floor(Math.random() * arr.length)];
}

// One-shot particle burst at (x, y). Returns the emitter or null.
export function burst(scene, x, y, opts = {}) {
  try {
    const texture = opts.texture || ensureDotTexture(scene);
    if (!texture || !scene.add || !scene.add.particles) return null;
    const lifespan = opts.lifespan ?? 450;
    const emitter = scene.add.particles(x, y, texture, {
      speed: { min: opts.speedMin ?? 60, max: opts.speedMax ?? 260 },
      lifespan: { min: Math.round(lifespan * 0.6), max: lifespan },
      scale: { start: opts.scale ?? 1.6, end: 0 },
      tint: pick(opts.colors, 0xffffff),
      gravityY: opts.gravityY ?? 500,
      quantity: 0,
      emitting: false,
    });
    if (opts.depth !== undefined) emitter.setDepth(opts.depth);
    else emitter.setDepth(40);
    emitter.explode(opts.count ?? 12, x, y);
    if (scene.time && scene.time.delayedCall) {
      scene.time.delayedCall(lifespan + 200, () => {
        try { emitter.destroy(); } catch { /* already gone */ }
      });
    }
    return emitter;
  } catch {
    return null;
  }
}

// Brief camera shake. intensity ~0.005 (subtle) .. 0.03 (heavy).
export function shake(scene, durationMs = 180, intensity = 0.012) {
  try {
    const cam = scene && scene.cameras && scene.cameras.main;
    if (!cam || !cam.shake) return false;
    cam.shake(durationMs, intensity);
    return true;
  } catch {
    return false;
  }
}

// Full-screen flash. Defaults to a short white blink; pass red for damage.
export function flash(scene, durationMs = 120, r = 255, g = 255, b = 255) {
  try {
    const cam = scene && scene.cameras && scene.cameras.main;
    if (!cam || !cam.flash) return false;
    cam.flash(durationMs, r, g, b);
    return true;
  } catch {
    return false;
  }
}

// Tint a game object briefly (impact feedback), then restore.
export function hitFlash(scene, target, tint = 0xffffff, ms = 90) {
  try {
    if (!target || !target.active || !target.setTint) return false;
    target.setTint(tint);
    if (scene && scene.time && scene.time.delayedCall) {
      scene.time.delayedCall(ms, () => {
        try { if (target.active) target.clearTint(); } catch { /* gone */ }
      });
    }
    return true;
  } catch {
    return false;
  }
}

// Floating score/milestone popup that rises, fades, and destroys itself.
export function popup(scene, x, y, text, opts = {}) {
  try {
    if (!scene || !scene.add || !scene.add.text) return null;
    const label = scene.add.text(x, y, String(text), {
      fontFamily: 'monospace',
      fontSize: opts.size || '16px',
      color: opts.color || '#ffd479',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(opts.depth ?? 60);
    if (scene.tweens && scene.tweens.add) {
      scene.tweens.add({
        targets: label,
        y: y - (opts.rise ?? 44),
        alpha: 0,
        duration: opts.duration ?? 750,
        ease: 'Cubic.easeOut',
        onComplete: () => { try { label.destroy(); } catch { /* gone */ } },
      });
    } else if (scene.time && scene.time.delayedCall) {
      scene.time.delayedCall(opts.duration ?? 750, () => {
        try { label.destroy(); } catch { /* gone */ }
      });
    }
    return label;
  } catch {
    return null;
  }
}
