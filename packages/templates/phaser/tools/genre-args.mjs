// Shared genre CLI prologue for the phaser tools (stage-demo, smoke).
// Genre-generic: any sibling dir with a config.demo.json is a known genre,
// so new genre modules need no per-genre tool edit. The static KNOWN list
// keeps bare genre names that lost their config.demo.json loudly rejected
// (unknown genre) instead of silently treated as an output path.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const KNOWN_GENRES = [
  'space-shooter',
  'endless-runner',
  'side-scroller',
  'battle-2d',
  'farming',
];

export function listGenres(root) {
  const found = new Set(KNOWN_GENRES);
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (d.isDirectory() && existsSync(join(root, d.name, 'config.demo.json'))) {
      found.add(d.name);
    }
  }
  return [...found].sort();
}

export function parseGenreArgv(argv, { root, defaultGenre = 'space-shooter' } = {}) {
  const genres = listGenres(root);
  const isGenre = (g) => genres.includes(g);
  let genre = defaultGenre;
  let positional = null;
  for (const a of argv) {
    if (a.startsWith('--genre=')) genre = a.slice('--genre='.length);
    else if (isGenre(a)) genre = a;
    else if (!positional) positional = a;
  }
  if (!isGenre(genre)) {
    console.error(`unknown genre: ${genre} (known: ${genres.join(', ')})`);
    process.exit(2);
  }
  return { genre, genres, positional };
}
