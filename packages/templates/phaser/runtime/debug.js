// Debug hooks: error capture + on-screen status line (?debug=1).

export function installErrorHook(report) {
  window.addEventListener('error', (e) => report(`window.onerror: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) =>
    report(`unhandledrejection: ${(e.reason && e.reason.message) || e.reason}`));
}

export function createDebug(scene, enabled) {
  if (!enabled) return { update() {}, report() {} };
  const text = scene.add.text(8, 8, '', {
    fontFamily: 'monospace', fontSize: '12px', color: '#7fff9f',
  }).setDepth(1000).setScrollFactor(0);
  const lines = [];
  return {
    report(msg) {
      lines.push(String(msg).slice(0, 160));
      if (lines.length > 6) lines.shift();
    },
    update(extra = '') {
      const fps = Math.round(scene.game.loop.actualFps || 0);
      text.setText([`fps ${fps} ${extra}`, ...lines].join('\n'));
    },
  };
}
