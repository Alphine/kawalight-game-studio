// Headless smoke test (FR-020): serves the staged demo, runs Chrome headless,
// asserts the autotest PASS marker and a clean error hook, saves screenshots.
// Zero deps; uses the Chrome/Edge already on the machine.
// Usage: node tools/smoke.mjs [genre] [dist] [--genre=X]
// Back-compat: bare `node tools/smoke.mjs [dist]` still smokes space-shooter.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GENRES = ['space-shooter', 'endless-runner'];
let genre = 'space-shooter';
let distArg = null;
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--genre=')) genre = a.slice('--genre='.length);
  else if (GENRES.includes(a)) genre = a;
  else if (!distArg) distArg = a;
}
if (!GENRES.includes(genre)) {
  console.error(`unknown genre: ${genre} (known: ${GENRES.join(', ')})`);
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, distArg || `dist-${genre}`);
const outDir = join(root, '.smoke');
// Space-shooter keeps the original artifact names; other genres are suffixed.
const tag = (name) => (genre === 'space-shooter' ? name : `${name}-${genre}`);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

function chrome(chromePath, url, args) {
  return spawnSync(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--allow-file-access-from-files',
    `--user-data-dir=${join(outDir, 'chrome-profile')}`,
    '--virtual-time-budget=30000', ...args, url,
  ], { encoding: 'utf-8', timeout: 120000 });
}

const failures = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures.push(msg);
};

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('no Chrome/Edge found; cannot run the smoke test');
  process.exit(2);
}
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`staged demo missing at ${dist}; run npm run stage first`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const page = pathToFileURL(join(dist, 'index.html')).href;
try {
  // 1. Logic autotest in a real page context.
  const auto = chrome(chromePath, `${page}?autotest=1&seed=42`, ['--dump-dom']);
  const dom = auto.stdout || '';
  check(dom.includes('KGSM-AUTOTEST-PASS'), `[${genre}] autotest marker PASS in DOM`);
  check(!dom.includes('KGSM-AUTOTEST-FAIL'), `[${genre}] no autotest FAIL marker`);
  const errOpen = dom.indexOf('<pre id="kgsm-errors">');
  const errShown = errOpen !== -1 && !dom.includes('<pre id="kgsm-errors" hidden');
  check(!errShown, `[${genre}] error hook stayed hidden during autotest`);

  // 2. Real Phaser boot: title screenshot + gameplay screenshot.
  const titleShot = join(outDir, tag('title') + '.png');
  const t = chrome(chromePath, `${page}?seed=42`, [`--screenshot=${titleShot}`]);
  check(t.status === 0 && existsSync(titleShot), `[${genre}] title screenshot captured`);
  const gameShot = join(outDir, tag('gameplay') + '.png');
  const g = chrome(chromePath,
    `${page}?seed=42&scene=game&demo-input=1`,
    [`--screenshot=${gameShot}`, '--window-size=1000,700']);
  check(g.status === 0 && existsSync(gameShot), `[${genre}] gameplay screenshot captured`);

  // 3. Booted page reports no errors.
  const boot = chrome(chromePath, `${page}?seed=42`, ['--dump-dom']);
  const bootDom = boot.stdout || '';
  const bootErr = bootDom.indexOf('<pre id="kgsm-errors">') !== -1
    && !bootDom.includes('<pre id="kgsm-errors" hidden');
  check(!bootErr, `[${genre}] error hook stayed hidden on Phaser boot`);
  writeFileSync(join(outDir, tag('autotest-dom') + '.html'), dom);
} finally {
  /* file:// run: nothing to close */
}

if (failures.length) {
  console.error(`\nSMOKE FAIL [${genre}]: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nSMOKE PASS [${genre}]`);
