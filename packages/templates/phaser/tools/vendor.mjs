// Copies the pinned Phaser build into vendor/ for offline preview/export.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'phaser', 'dist', 'phaser.min.js');
const dest = join(root, 'vendor', 'phaser.min.js');

if (!existsSync(src)) {
  console.error('phaser not installed; run `npm install` first');
  process.exit(1);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`vendored ${dest}`);
