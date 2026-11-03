// Phaser boot: loads config, then starts scenes (or the logic autotest).

import { loadConfig } from './config.js';
import { BootScene } from './scenes/BootScene.js';
import { TitleScene } from './scenes/TitleScene.js';
import { GameScene } from './scenes/GameScene.js';

async function fail(message) {
  const el = document.getElementById('kgsm-errors');
  el.hidden = false;
  el.textContent = `boot failed: ${message}`;
  document.title = 'FAIL - boot';
}

try {
  const { config, seed, debug, autotest } = await loadConfig();
  const params = new URLSearchParams(location.search);

  if (autotest) {
    const { runAutotest } = await import('./autotest.js');
    await runAutotest(config, seed ?? config.seed ?? 1);
  } else {
    if (!window.Phaser) throw new Error('Phaser failed to load (no vendor, no CDN)');
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      width: config.world.width,
      height: config.world.height,
      // Generated art is illustrated (not pixel-art): smooth filtering keeps
      // the downscaled sprites clean. Pixel positions still snap.
      pixelArt: false,
      roundPixels: true,
      backgroundColor: '#05070f',
      fps: { target: 60 },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [BootScene, TitleScene, GameScene],
    });
    game.registry.set('kgsm', {
      config,
      seed: seed ?? config.seed ?? 1,
      debug,
      startScene: params.get('scene') === 'game' ? 'game' : 'title',
      demoInput: params.has('demo-input'),
    });
  }
} catch (err) {
  await fail(err.message);
}
