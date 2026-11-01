// Builds dist-web/: static hosting bundle for Kawalight Game Studio Maker.
// Usage: node packages/web/tools/make-web-bundle.mjs [outdir] [--force]
// Output: landing + studio UI + 5 staged games + server refs + deploy README.
// Stdlib only (node:fs/path/url/child_process).
// --force is required when outdir is outside the repo; the repo root itself
// is never wiped.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..');
const repo = join(webDir, '..', '..');
const cliArgs = process.argv.slice(2);
const force = cliArgs.includes('--force');
const out = resolve(cliArgs.find((a) => a !== '--force') || join(repo, 'dist-web'));

function assertSafeOutdir() {
  if (out === repo) {
    console.error(`refusing to wipe the repo root: ${out}`);
    process.exit(2);
  }
  const rel = relative(repo, out);
  if ((rel.startsWith('..') || isAbsolute(rel)) && !force) {
    console.error(`refusing to wipe outside the repo without --force: ${out}`);
    process.exit(2);
  }
}

const GENRES = [
  { id: 'space-shooter', title: 'Space Shooter', tag: 'ARCADE', glyph: '▲', desc: 'Enemy waves, powerups, bosses.' },
  { id: 'endless-runner', title: 'Endless Runner', tag: 'CASUAL', glyph: '●', desc: 'Jump, slide, chase distance.' },
  { id: 'side-scroller', title: 'Side-Scroller', tag: 'PLATFORMER', glyph: '◆', desc: 'Run, stomp, reach the exit.' },
  { id: 'battle-2d', title: 'Battle 2D', tag: '2D ACTION', glyph: '✦', desc: 'Arena waves, melee + bolts.' },
  { id: 'farming', title: 'Farming Sim', tag: 'SIMULATION', glyph: '★', desc: 'Plant, water, harvest, bank.' },
];

function version() {
  try {
    return JSON.parse(readFileSync(join(repo, 'apps/desktop/package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function landing(ver) {
  const cards = GENRES.map((g) => (
    `      <a class="card" href="games/${g.id}/index.html">\n` +
    `        <div class="glyph">${g.glyph}</div>\n` +
    `        <div class="tag">${g.tag}</div>\n` +
    `        <h2>${g.title}</h2>\n` +
    `        <p>${g.desc}</p>\n` +
    `        <span class="play">PLAY &rarr;</span>\n` +
    `      </a>`
  )).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kawalight Game Studio Maker v${ver}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: system-ui, 'Segoe UI', sans-serif; background: #090d16; color: #cbd5e1; min-height: 100vh; padding: 40px 20px; }
  .wrap { max-width: 1080px; margin: 0 auto; }
  header { text-align: center; margin-bottom: 32px; }
  header h1 { color: #f8fafc; font-size: 28px; letter-spacing: 2px; }
  header p { color: #38bdf8; font-family: monospace; font-size: 13px; margin-top: 8px; letter-spacing: 1px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
  .card { display: block; text-decoration: none; color: inherit; background: linear-gradient(135deg, rgba(17,24,39,.9), rgba(11,17,32,.95)); border: 1px solid rgba(255,255,255,.08); border-radius: 16px; padding: 20px; transition: border-color .15s; }
  .card:hover { border-color: rgba(56,189,248,.5); }
  .card.studio { border-color: rgba(56,189,248,.3); }
  .glyph { font-size: 34px; color: #38bdf8; }
  .tag { font-family: monospace; font-size: 10px; letter-spacing: 2px; color: #64748b; margin: 8px 0 4px; }
  .card h2 { color: #f8fafc; font-size: 17px; }
  .card p { font-size: 12px; color: #94a3b8; margin: 6px 0 12px; min-height: 30px; }
  .play { font-family: monospace; font-size: 12px; font-weight: bold; color: #38bdf8; letter-spacing: 1px; }
  footer { text-align: center; margin-top: 32px; font-family: monospace; font-size: 11px; color: #475569; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>KAWALIGHT GAME STUDIO MAKER</h1>
    <p>v${ver} // PLAYABLE WEB BUILD</p>
  </header>
  <div class="grid">
    <a class="card studio" href="studio/index.html">
      <div class="glyph">⬢</div>
      <div class="tag">CREATION DECK</div>
      <h2>Open Studio</h2>
      <p>Build games: projects, assets, levels, export.</p>
      <span class="play">LAUNCH &rarr;</span>
    </a>
${cards}
  </div>
  <footer>static bundle — no account, no build step, just play</footer>
</div>
</body>
</html>
`;
}

const HTACCESS = `# KGSM web bundle: safe on Apache 2.4 / LiteSpeed (all guarded).
Options -Indexes

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml
</IfModule>

<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/html "access plus 0 seconds"
  ExpiresByType application/json "access plus 0 seconds"
  ExpiresByType text/css "access plus 7 days"
  ExpiresByType application/javascript "access plus 7 days"
  ExpiresByType image/png "access plus 30 days"
  ExpiresByType image/svg+xml "access plus 30 days"
</IfModule>

<IfModule mod_headers.c>
  Header set X-Content-Type-Options "nosniff"
  Header set X-Frame-Options "SAMEORIGIN"
  # Baseline CSP for landing + studio + games (one static bundle):
  # 'unsafe-inline' scripts/styles are required by existing inline code;
  # jsdelivr covers the Phaser CDN fallback in staged games; connect/img/
  # media allow http(s) because Studio calls a user-configured worker origin.
  Header set Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; media-src 'self' data: blob: http: https:; font-src 'self' data:; connect-src 'self' http: https: ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
</IfModule>
`;

function main() {
  const ver = version();
  assertSafeOutdir();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'games'), { recursive: true });

  // 1. Studio UI (drop node-only test file; runtime never loads it).
  cpSync(join(repo, 'apps/desktop/ui'), join(out, 'studio'), {
    recursive: true,
    filter: (p) => !p.endsWith('.test.js'),
  });

  // 2. Staged games via the canonical stage tool, straight into the bundle.
  const stageTool = join(repo, 'packages/templates/phaser/tools/stage-demo.mjs');
  for (const g of GENRES) {
    const dest = join(out, 'games', g.id);
    try {
      execFileSync(process.execPath, [stageTool, g.id, dest], { stdio: 'pipe' });
    } catch (e) {
      console.error(`stage failed for ${g.id}: ${(e.stderr || e).toString().slice(0, 300)}`);
      process.exit(1);
    }
  }

  // 3. Landing + hosting files.
  writeFileSync(join(out, 'index.html'), landing(ver), 'utf8');
  writeFileSync(join(out, '.htaccess'), HTACCESS, 'utf8');
  cpSync(join(webDir, 'server'), join(out, 'server'), { recursive: true });
  cpSync(join(webDir, 'README-DEPLOY.md'), join(out, 'README-DEPLOY.md'));

  // 4. Self-check: every entry point present, studio has no test files.
  const must = [join(out, 'index.html'), join(out, '.htaccess'),
    join(out, 'studio/index.html'), join(out, 'README-DEPLOY.md'),
    join(out, 'server/kgsm-worker.service'), join(out, 'server/nginx-kgsm.conf'),
    ...GENRES.flatMap((g) => [join(out, 'games', g.id, 'index.html'),
      join(out, 'games', g.id, 'config.json')])];
  for (const f of must) {
    if (!existsSync(f)) { console.error(`missing: ${f}`); process.exit(1); }
  }
  let files = 0, bytes = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { files++; bytes += statSync(p).size; }
    }
  };
  walk(out);
  console.log(`web bundle v${ver} -> ${out}`);
  console.log(`files=${files} bytes=${bytes} genres=${GENRES.length}`);
}

main();
