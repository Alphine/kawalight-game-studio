const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const S = require('./sfx-synth.js');

describe('sfx-synth presets', () => {
  it('lists the eight presets the worker also knows', () => {
    assert.deepEqual(S.PRESETS, ['click', 'coin', 'explosion', 'fail', 'hit', 'jump', 'laser', 'powerup']);
  });

  it('renders the same samples for the same preset and seed', () => {
    assert.deepEqual(S.render('hit', 7), S.render('hit', 7));
  });

  it('changes noise presets with the seed but not tone presets', () => {
    assert.notDeepEqual(S.render('explosion', 1), S.render('explosion', 2));
    assert.deepEqual(S.render('jump', 1), S.render('jump', 2));
  });

  it('keeps every sample inside [-1, 1] and never silent', () => {
    for (const preset of S.PRESETS) {
      const samples = S.render(preset, 3);
      assert.ok(samples.length > 0, preset);
      let peak = 0;
      for (const v of samples) {
        assert.ok(Number.isFinite(v), preset);
        peak = Math.max(peak, Math.abs(v));
      }
      assert.ok(peak > 0 && peak <= 1, preset);
    }
  });

  it('rejects unknown presets and bad seeds', () => {
    assert.throws(() => S.render('orchestra', 0), /unknown sfx preset/);
    assert.throws(() => S.render('jump', -1), /seed/);
    assert.throws(() => S.render('jump', 2147483648), /seed/);
    assert.throws(() => S.render('jump', 1.5), /seed/);
  });
});

describe('WAV encoding', () => {
  it('writes a valid mono 16-bit 22050 Hz RIFF/WAVE file', () => {
    const samples = S.render('coin', 5);
    const bytes = S.encodeWav(samples);
    const v = new DataView(bytes.buffer);
    const text = (off, n) => String.fromCharCode(...bytes.slice(off, off + n));
    assert.equal(text(0, 4), 'RIFF');
    assert.equal(text(8, 4), 'WAVE');
    assert.equal(text(12, 4), 'fmt ');
    assert.equal(v.getUint16(20, true), 1); // PCM
    assert.equal(v.getUint16(22, true), 1); // mono
    assert.equal(v.getUint32(24, true), 22050);
    assert.equal(v.getUint16(34, true), 16);
    assert.equal(text(36, 4), 'data');
    assert.equal(v.getUint32(40, true), samples.length * 2);
    assert.equal(bytes.length, 44 + samples.length * 2);
    assert.equal(v.getUint32(4, true), bytes.length - 8);
  });

  it('clamps out-of-range samples instead of wrapping', () => {
    const bytes = S.encodeWav(Float32Array.from([2, -2]));
    const v = new DataView(bytes.buffer);
    assert.equal(v.getInt16(44, true), 32767);
    assert.equal(v.getInt16(46, true), -32767);
  });

  it('encodes base64 that round-trips to the same bytes', () => {
    const bytes = S.encodeWav(S.render('click', 2));
    const b64 = S.toBase64(bytes);
    assert.deepEqual(Buffer.from(b64, 'base64'), Buffer.from(bytes));
  });
});
