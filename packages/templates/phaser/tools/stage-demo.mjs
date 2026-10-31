// Stages a genre demo into dist-<genre>/ using the same layout
// the worker exporter produces (index.html + config.json + js/ + assets/).
// Usage: node tools/stage-demo.mjs [genre] [outdir] [--genre=X]
// Back-compat: bare `node tools/stage-demo.mjs [outdir]` still stages space-shooter.
// Dev preview only; the worker stage_export is canonical for real exports.
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGenreArgv } from './genre-args.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { genre, positional: outArg } = parseGenreArgv(process.argv.slice(2), { root });

const game = join(root, genre);
const out = outArg ? resolve(root, outArg) : join(root, `dist-${genre}`);

if (!existsSync(join(game, 'config.demo.json'))) {
  console.error(`no staged template at ${game} (missing config.demo.json)`);
  process.exit(2);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'js', 'runtime'), { recursive: true });
mkdirSync(join(out, 'js', 'game'), { recursive: true });

for (const f of ['index.html', 'style.css']) {
  copyFileSync(join(game, 'demo', f), join(out, f));
}
copyFileSync(join(game, 'config.demo.json'), join(out, 'config.json'));
cpSync(join(root, 'runtime'), join(out, 'js', 'runtime'), { recursive: true });
cpSync(join(game, 'src'), join(out, 'js', 'game'), { recursive: true });
if (existsSync(join(game, 'assets'))) {
  cpSync(join(game, 'assets'), join(out, 'assets'), { recursive: true });
}
const vendor = join(root, 'vendor', 'phaser.min.js');
if (existsSync(vendor)) {
  mkdirSync(join(out, 'js', 'vendor'), { recursive: true });
  copyFileSync(vendor, join(out, 'js', 'vendor', 'phaser.min.js'));
  console.log('staged with vendored phaser');
} else {
  console.log('staged WITHOUT vendored phaser (page will use CDN fallback)');
}
console.log(`staged ${genre} -> ${out}`);
