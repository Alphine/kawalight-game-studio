// Canonical-binary checksums: the side-scroller/battle-2d starter PNGs were
// made by a throwaway script (since deleted), so these hashes pin the
// committed bytes. Intentionally replacing a sprite means updating its hash.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = {
  'side-scroller/assets/checkpoint.png':
    '396edbd0f688ecbcfd59f56f1355b2654705689b73e658e1aba8818d2f130575',
  'side-scroller/assets/coin.png':
    'c7f2db4727180edd87c9913536e11dd046fbfdd6ff29886cbcc76bce6561df20',
  'side-scroller/assets/exit-door.png':
    'b2285cebc41ddc7f48eb38e6d17ce2e9f6e157c986e25addb969381fd91ddf0c',
  'side-scroller/assets/player.png':
    '702523252f81446803b5b9df970141889438607ac04a4bf646632448fa166275',
  'side-scroller/assets/spikes.png':
    'd5404b2f3c55dbdb2351726ff5c097f53b0ed22e76c38a52ea2464debd473424',
  'side-scroller/assets/walker.png':
    '1d05462fab2802e9c5ff245bd08f0782169ce7f2e8a3ac5ce447b33f8ef0a2b5',
  'battle-2d/assets/enemy-grunt.png':
    'cc9c07b6d221d3a1e12acd9a6597f630d009866df4516fe0383747071fa5be3b',
  'battle-2d/assets/enemy-skitter.png':
    '1aa28c94962fd48873fe34b03cbee6fd35b96f5f62fe25a167cac6b6e8d235c9',
  'battle-2d/assets/enemy-stinger.png':
    '0bcc2fa36521d0fc3f52e57143fcb4faa16916bed9fa240d25366f61f774b6e1',
  'battle-2d/assets/foe-shot.png':
    '881bc80c1cf46f404fe440ab2ba2ca614e62439a8c46795be4925ddbe4dc6ff9',
  'battle-2d/assets/pickup.png':
    '678917450029077a2d4c17631483969cfd750fc74cb888110f309e5d0ea7e6c4',
  'battle-2d/assets/player.png':
    'de3178709970bccc7775be7d77c68f68549efa30ee9407fa774a93a7f124f7db',
  'battle-2d/assets/shot.png':
    '2ec94eaed3f762859d288ab2da3bcc3f1629a1f18b4fb96b21e4fc539e160ea6',
};

describe('canonical starter PNGs', () => {
  for (const [rel, sha] of Object.entries(EXPECTED)) {
    it(`pins ${rel}`, () => {
      const actual = createHash('sha256')
        .update(readFileSync(join(root, rel))).digest('hex');
      assert.equal(actual, sha);
    });
  }
});
