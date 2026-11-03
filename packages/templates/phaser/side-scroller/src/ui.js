// Shared UI helpers for the title, HUD and overlays: a framed panel (dark fill,
// amber keyline, inner shadow edge) and a type scale used everywhere, so every
// screen reads with the same hierarchy.

export const TYPE = {
  family: 'monospace',
  title: { fontSize: '56px', color: '#5fd08a', stroke: '#0d1626', strokeThickness: 8 },
  subtitle: { fontSize: '14px', color: '#b9c2dc' },
  heading: { fontSize: '22px', color: '#ffffff' },
  body: { fontSize: '16px', color: '#e8ecf8' },
  label: { fontSize: '14px', color: '#8b94b3' },
  accent: { fontSize: '18px', color: '#ffd479' },
};

export function textStyle(role, extra = {}) {
  return { fontFamily: TYPE.family, ...TYPE[role], ...extra };
}

// Draws a framed panel centred on (cx, cy). Returns the Graphics object.
export function framePanel(scene, cx, cy, w, h, opts = {}) {
  const g = scene.add.graphics().setDepth(opts.depth ?? 20);
  if (opts.scrollFactor !== undefined) g.setScrollFactor(opts.scrollFactor);
  const x = cx - w / 2;
  const y = cy - h / 2;
  const radius = opts.radius ?? 10;
  g.fillStyle(0x000000, 0.35);
  g.fillRoundedRect(x + 4, y + 6, w, h, radius);
  g.fillStyle(opts.fill ?? 0x0d1626, opts.alpha ?? 0.82);
  g.fillRoundedRect(x, y, w, h, radius);
  g.lineStyle(2, opts.line ?? 0xffd479, opts.lineAlpha ?? 0.75);
  g.strokeRoundedRect(x, y, w, h, radius);
  g.lineStyle(1, 0x4a3b5c, 0.9);
  g.strokeRoundedRect(x + 5, y + 5, w - 10, h - 10, Math.max(2, radius - 4));
  return g;
}
