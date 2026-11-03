// Parallax backdrop: a vertical colour gradient, a seamless nebula and three
// star layers that scroll at different speeds. Shared by the title and game
// scenes so both screens have the same depth.

export const SPARK_KEY = 'kgsm-spark';
export const HALO_KEY = 'kgsm-halo';
export const NEBULA_KEY = 'kgsm-nebula';

export const STAR_LAYERS = [
  { key: 'kgsm-stars-far', size: 256, count: 130, min: 70, max: 120, bigChance: 0.02, speed: 14, depth: -27 },
  { key: 'kgsm-stars-mid', size: 256, count: 72, min: 120, max: 190, bigChance: 0.08, speed: 38, depth: -26 },
  { key: 'kgsm-stars-near', size: 256, count: 26, min: 200, max: 255, bigChance: 0.3, speed: 84, depth: -25 },
];
const NEBULA_SPEED = 6;

export function createBackdrop(scene, W, H) {
  const base = scene.add.graphics().setDepth(-31);
  base.fillGradientStyle(0x0a1030, 0x0a1030, 0x02030a, 0x02030a, 1);
  base.fillRect(0, 0, W, H);

  const layers = [];
  const nebula = scene.add.tileSprite(0, 0, W, H, NEBULA_KEY)
    .setOrigin(0, 0).setDepth(-30).setAlpha(0.9);
  layers.push({ sprite: nebula, speed: NEBULA_SPEED });
  for (const s of STAR_LAYERS) {
    const sprite = scene.add.tileSprite(0, 0, W, H, s.key)
      .setOrigin(0, 0).setDepth(s.depth);
    layers.push({ sprite, speed: s.speed });
  }

  return {
    // scroll: 1 normal, 0 frozen (paused / menus can pass a smaller value).
    update(deltaMs, scroll = 1) {
      const dt = Math.min(Math.max(deltaMs, 0), 50) / 1000;
      for (const layer of layers) {
        // Stars drift left (the ship flies right); decreasing tilePositionX
        // moves the texture left.
        layer.sprite.tilePositionX -= layer.speed * dt * scroll;
      }
    },
  };
}
