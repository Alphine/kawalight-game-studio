// Shared look for the farming scenes: one four-hue palette (moss green,
// straw gold, earth brown, sky aqua), type scale, framed panels, buttons and
// a procedural landscape backdrop. Pure drawing helpers, no game state.

export const PALETTE = {
  ink: 0x2a1a10, // dark brown outline and shadows
  earth: 0x5a3a22, // wood, frames, deep soil
  soil: 0x9a6a3f, // mid soil
  green: 0x4f8a3c, // moss
  greenLight: 0x7db35a, // leaf highlight
  greenDeep: 0x2f5a2a, // grass border
  gold: 0xe9b44c, // straw gold, coins, accents
  goldLight: 0xfff0b0, // highlights
  sky: 0x7fc8c0, // sky aqua
  skyLight: 0xcdeee6,
  cream: 0xfbf3df, // primary text
  panel: 0x1d2a18, // panel fill (deep green-brown)
};

export const FONT = "'Trebuchet MS', 'Segoe UI', Verdana, sans-serif";

export const TEXT = {
  title: { fontFamily: FONT, fontSize: '60px', fontStyle: 'bold', color: '#fbf3df' },
  h1: { fontFamily: FONT, fontSize: '22px', fontStyle: 'bold', color: '#e9b44c' },
  h2: { fontFamily: FONT, fontSize: '18px', fontStyle: 'bold', color: '#fbf3df' },
  body: { fontFamily: FONT, fontSize: '15px', color: '#fbf3df' },
  small: { fontFamily: FONT, fontSize: '12px', color: '#cdeee6' },
  label: { fontFamily: FONT, fontSize: '14px', fontStyle: 'bold', color: '#fbf3df' },
};

// Rounded panel with a soft drop shadow and a gold rim. Returns the Graphics.
export function panel(scene, x, y, w, h, opts = {}) {
  const r = opts.radius ?? 14;
  const g = scene.add.graphics();
  g.fillStyle(PALETTE.ink, opts.shadowAlpha ?? 0.35);
  g.fillRoundedRect(x + 3, y + 5, w, h, r);
  g.fillStyle(opts.fill ?? PALETTE.panel, opts.alpha ?? 0.9);
  g.fillRoundedRect(x, y, w, h, r);
  g.lineStyle(opts.lineWidth ?? 2, opts.stroke ?? PALETTE.gold, opts.strokeAlpha ?? 0.9);
  g.strokeRoundedRect(x, y, w, h, r);
  if (opts.depth !== undefined) g.setDepth(opts.depth);
  return g;
}

// Bar with a rounded track; set value with setBar(g, fraction).
export function bar(scene, x, y, w, h, color = PALETTE.gold) {
  const track = scene.add.graphics();
  track.fillStyle(PALETTE.ink, 0.6);
  track.fillRoundedRect(x, y, w, h, h / 2);
  const fill = scene.add.graphics();
  return {
    track,
    fill,
    color,
    set(fraction) {
      const f = Math.max(0, Math.min(1, fraction));
      fill.clear();
      if (f <= 0) return;
      fill.fillStyle(color, 1);
      fill.fillRoundedRect(x, y, Math.max(h, w * f), h, h / 2);
    },
  };
}

// Painted landscape: sky gradient, sun, layered hills and round trees. All
// positions are derived from W/H so it fits any world size. Depth is set so
// the whole backdrop sits behind gameplay (-20).
export function drawBackdrop(scene, W, H) {
  const g = scene.add.graphics().setDepth(-20);
  g.fillGradientStyle(PALETTE.sky, PALETTE.sky, PALETTE.skyLight, PALETTE.skyLight, 1);
  g.fillRect(0, 0, W, H);

  // Sun with two soft halos.
  const sx = W * 0.82;
  const sy = H * 0.2;
  g.fillStyle(PALETTE.goldLight, 0.18);
  g.fillCircle(sx, sy, 120);
  g.fillStyle(PALETTE.goldLight, 0.28);
  g.fillCircle(sx, sy, 80);
  g.fillStyle(PALETTE.gold, 1);
  g.fillCircle(sx, sy, 44);
  g.fillStyle(PALETTE.goldLight, 1);
  g.fillCircle(sx - 10, sy - 10, 14);

  // Soft clouds.
  g.fillStyle(0xffffff, 0.55);
  for (const [cx, cy, s] of [[W * 0.12, H * 0.14, 1], [W * 0.5, H * 0.08, 0.7]]) {
    g.fillCircle(cx, cy, 22 * s);
    g.fillCircle(cx + 26 * s, cy - 8 * s, 28 * s);
    g.fillCircle(cx + 56 * s, cy, 20 * s);
  }

  // Layered hills, far to near. Each ridge is a sum of sines (deterministic).
  const ridge = (color, base, amp, freq, phase, amp2 = 0) => {
    g.fillStyle(color, 1);
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const y = base + amp * Math.sin(x * freq + phase)
        + amp2 * Math.sin(x * freq * 2.7 + phase * 1.3);
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fillPath();
  };
  ridge(0xa6d1bd, H * 0.56, 18, 0.011, 0.4, 6); // far, aqua-tinted
  ridge(0x7db35a, H * 0.64, 16, 0.009, 2.1, 5); // mid, light moss
  ridge(PALETTE.green, H * 0.76, 12, 0.013, 4.0, 4); // near, moss
  ridge(PALETTE.greenDeep, H * 0.9, 8, 0.02, 1.0, 0); // foreground grass

  // Round trees on the near ridge, left and right of the field.
  const tree = (tx, ty, s) => {
    g.fillStyle(PALETTE.ink, 0.35);
    g.fillEllipse(tx + 4 * s, ty + 4 * s, 46 * s, 14 * s);
    g.fillStyle(PALETTE.earth, 1);
    g.fillRect(tx - 4 * s, ty - 20 * s, 8 * s, 26 * s);
    g.fillStyle(PALETTE.green, 1);
    g.fillCircle(tx, ty - 46 * s, 30 * s);
    g.fillStyle(PALETTE.greenLight, 1);
    g.fillCircle(tx - 8 * s, ty - 54 * s, 14 * s);
  };
  tree(W * 0.07, H * 0.8, 1.1);
  tree(W * 0.2, H * 0.84, 0.8);
  tree(W * 0.92, H * 0.8, 1.05);
  tree(W * 0.8, H * 0.86, 0.75);
  return g;
}

// Clickable toolbar button: rounded body, gold rim when active, subtle hover.
export class Button extends Phaser.GameObjects.Container {
  constructor(scene, x, y, label, onClick) {
    super(scene, x, y);
    this.onClick = onClick;
    this.isActive = false;
    this.isHover = false;
    this.bg = scene.add.graphics();
    this.text = scene.add.text(0, 0, '', TEXT.label).setOrigin(0.5);
    this.add([this.bg, this.text]);
    scene.add.existing(this);
    this.boxW = 80;
    this.boxH = 36;
    this.setInteractive(new Phaser.Geom.Rectangle(0, 0, this.boxW, this.boxH),
      Phaser.Geom.Rectangle.Contains);
    this.input.cursor = 'pointer';
    this.on('pointerover', () => { this.isHover = true; this.draw(); });
    this.on('pointerout', () => { this.isHover = false; this.draw(); });
    this.on('pointerdown', (ptr) => {
      if (ptr && ptr.event && ptr.event.stopPropagation) ptr.event.stopPropagation();
      scene.tweens.add({
        targets: this, scaleX: 0.96, scaleY: 0.96, duration: 70, yoyo: true,
        ease: 'Quad.easeOut',
      });
      this.onClick();
    });
    this.setLabel(label);
  }

  setLabel(label) {
    this.text.setText(label);
    this.boxW = Math.ceil(this.text.width + 28);
    this.text.setPosition(this.boxW / 2, this.boxH / 2);
    this.input.hitArea.setTo(0, 0, this.boxW, this.boxH);
    this.draw();
    return this;
  }

  setActive(on) {
    this.isActive = on;
    this.draw();
    return this;
  }

  draw() {
    const { boxW: w, boxH: h } = this;
    this.bg.clear();
    this.bg.fillStyle(PALETTE.ink, 0.45);
    this.bg.fillRoundedRect(0, 3, w, h, 10);
    const body = this.isActive ? 0x4a3614 : (this.isHover ? 0x2f4029 : 0x243322);
    this.bg.fillStyle(body, 0.97);
    this.bg.fillRoundedRect(0, 0, w, h, 10);
    this.bg.lineStyle(2, this.isActive ? PALETTE.gold : 0x6f8a5a, 1);
    this.bg.strokeRoundedRect(0, 0, w, h, 10);
    this.text.setColor(this.isActive ? '#fff0b0' : '#fbf3df');
  }
}
