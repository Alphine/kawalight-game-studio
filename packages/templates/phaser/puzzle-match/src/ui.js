// Shared look for the Gem Rush screens: palette, per-gem colours, and framed
// panels. Pure Phaser drawing, no asset files, so every screen matches.

export const PALETTE = {
  ink: 0x070b16,
  panel: 0x0d1530,
  panelEdge: 0x2a3d70,
  gold: 0xffd479,
  text: 0xe8ecf8,
  muted: 0x8b94b3,
  sky: 0x7fd4ff,
};

// Tint used by the burst effect for each gem id in config.gems.
const GEM_COLORS = {
  ruby: 0xff4d5e,
  sapphire: 0x4da3ff,
  emerald: 0x4dff8a,
  topaz: 0xffd44d,
  amethyst: 0xb070ff,
};

export function gemColor(id) {
  return GEM_COLORS[id] ?? PALETTE.gold;
}

// Rounded card with a soft drop shadow, a border, and an inner bevel line.
export function framedPanel(scene, x, y, w, h, {
  radius = 14, alpha = 0.94, depth = 0, edge = PALETTE.panelEdge,
} = {}) {
  const g = scene.add.graphics().setDepth(depth);
  g.fillStyle(0x000000, 0.35);
  g.fillRoundedRect(x + 4, y + 6, w, h, radius);
  g.fillStyle(PALETTE.panel, alpha);
  g.fillRoundedRect(x, y, w, h, radius);
  g.lineStyle(2, edge, 1);
  g.strokeRoundedRect(x, y, w, h, radius);
  g.lineStyle(1, 0xffffff, 0.07);
  g.strokeRoundedRect(x + 4, y + 4, w - 8, h - 8, Math.max(2, radius - 3));
  return g;
}
