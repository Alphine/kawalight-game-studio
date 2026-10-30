// Browser-side config loading. The worker validates before assembly/export;
// the page re-checks required keys so a hand-edited config fails loudly.

const REQUIRED = ['world', 'player', 'spawning', 'obstacles', 'scoring', 'controls'];

export async function loadConfig() {
  const params = new URLSearchParams(location.search);
  const url = params.get('config') || 'config.json';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`config fetch failed: ${url} (${res.status})`);
  const config = await res.json();
  for (const key of REQUIRED) {
    if (config[key] === undefined) throw new Error(`config missing key: ${key}`);
  }
  if (config.template?.id !== 'phaser.endless-runner') {
    throw new Error(`wrong template id: ${config.template?.id}`);
  }
  const seedParam = params.get('seed');
  return {
    config,
    seed: seedParam === null || seedParam === '' ? undefined : Number(seedParam),
    debug: params.has('debug'),
    autotest: params.has('autotest'),
  };
}
