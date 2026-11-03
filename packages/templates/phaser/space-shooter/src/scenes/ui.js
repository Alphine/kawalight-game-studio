// Shared UI kit for the space-shooter screens: one palette, one type scale,
// and a framed panel drawer. Colours follow the art: cyan hero, rose/magenta
// enemies, gold pickups, deep navy space.

export const COLOR = {
  ink: 0x060a1a,
  panel: 0x0b1433,
  edge: 0x2a4a8a,
  cyan: 0x7fd4ff,
  gold: 0xffd479,
  mint: 0x7dff9f,
  rose: 0xff6b8a,
};

export const HEX = {
  text: '#eef2ff',
  dim: '#7f8ab3',
  cyan: '#7fd4ff',
  gold: '#ffd479',
  mint: '#7dff9f',
  rose: '#ff6b8a',
};

export const FONT = {
  ui: '"Segoe UI", system-ui, sans-serif',
  mono: 'Consolas, "Courier New", monospace',
};

export function textStyle(overrides = {}) {
  return {
    fontFamily: FONT.ui,
    fontSize: '16px',
    color: HEX.text,
    ...overrides,
  };
}

// Draws a rounded, two-tone framed panel into an existing Graphics object.
// Coordinates are absolute (top-left origin).
export function drawPanel(g, x, y, w, h, opts = {}) {
  const radius = opts.radius ?? 14;
  const border = opts.border ?? COLOR.cyan;
  g.fillStyle(0x000000, 0.35);
  g.fillRoundedRect(x + 3, y + 5, w, h, radius);
  g.fillStyle(opts.fill ?? COLOR.panel, opts.alpha ?? 0.92);
  g.fillRoundedRect(x, y, w, h, radius);
  g.lineStyle(2, border, opts.borderAlpha ?? 0.8);
  g.strokeRoundedRect(x, y, w, h, radius);
  // Inner hairline gives the frame a machined look.
  g.lineStyle(1, 0xffffff, 0.08);
  g.strokeRoundedRect(x + 5, y + 5, w - 10, h - 10, Math.max(radius - 4, 2));
  return g;
}

// Gold/cyan divider line used under titles.
export function drawRule(g, x, y, w, color = COLOR.cyan, alpha = 0.5) {
  g.lineStyle(1, color, alpha);
  g.lineBetween(x, y, x + w, y);
  return g;
}
