// KGSM sound-effect synthesis in JavaScript (no network, no API key).
// Renders the same eight presets as the worker's kgsm/sfx.py, but with its own
// seeded PRNG, so a preset and seed always give the same samples in the browser.
// Output is mono 16-bit WAV. Preview plays through Web Audio.
(function () {
  'use strict';

  var RATE = 22050;
  var ATTACK_SECONDS = 0.003;
  var MAX_SEED = 2147483647;

  // [shape, fStart, fEnd, seconds, decay, gain]. Keep in sync with sfx.py.
  var SEGMENTS = {
    jump: [['square', 280, 860, 0.16, 6, 0.45]],
    coin: [['square', 988, 988, 0.08, 10, 0.45], ['square', 1319, 1319, 0.16, 7, 0.45]],
    hit: [['noise', 0, 0, 0.12, 25, 0.7], ['sine', 220, 90, 0.10, 12, 0.5]],
    explosion: [['noise', 0, 0, 0.70, 4, 0.9]],
    laser: [['square', 1400, 200, 0.28, 3, 0.4]],
    powerup: [['square', 523, 523, 0.07, 6, 0.4], ['square', 659, 659, 0.07, 6, 0.4],
      ['square', 784, 784, 0.07, 6, 0.4], ['square', 1047, 1047, 0.07, 6, 0.4]],
    click: [['sine', 1500, 1500, 0.03, 80, 0.5]],
    fail: [['triangle', 440, 220, 0.35, 3, 0.5]],
  };

  var PRESETS = Object.keys(SEGMENTS).sort();

  // mulberry32: small, fast, and reproducible for a given 32-bit seed.
  function prng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function waveValue(shape, phase) {
    var frac = phase - Math.floor(phase);
    if (shape === 'square') return frac < 0.5 ? 1 : -1;
    if (shape === 'triangle') return 4 * Math.abs(frac - 0.5) - 1;
    return Math.sin(2 * Math.PI * phase); // sine
  }

  // Float samples in [-1, 1] for one preset and seed.
  function render(preset, seed) {
    if (!Object.prototype.hasOwnProperty.call(SEGMENTS, preset)) {
      throw new Error('unknown sfx preset "' + preset + '"');
    }
    var s = checkSeed(seed);
    var rnd = prng(s);
    var attack = Math.max(1, Math.floor(ATTACK_SECONDS * RATE));
    var out = [];
    SEGMENTS[preset].forEach(function (seg) {
      var shape = seg[0], f0 = seg[1], f1 = seg[2], seconds = seg[3], decay = seg[4], gain = seg[5];
      var count = Math.max(1, Math.floor(seconds * RATE));
      var phase = 0, smooth = 0;
      for (var i = 0; i < count; i++) {
        var t = i / count;
        var value;
        if (shape === 'noise') {
          // One-pole low-pass on white noise keeps bursts from hissing.
          smooth += 0.5 * (rnd() * 2 - 1 - smooth);
          value = smooth;
        } else {
          phase += (f0 + (f1 - f0) * t) / RATE;
          value = waveValue(shape, phase);
        }
        var env = Math.exp(-decay * t) * Math.min(1, (i + 1) / attack);
        out.push(gain * env * value);
      }
    });
    return Float32Array.from(out);
  }

  function checkSeed(seed) {
    if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
      throw new Error('seed must be a whole number from 0 to ' + MAX_SEED);
    }
    return seed;
  }

  // 44-byte RIFF/WAVE header plus 16-bit little-endian PCM, mono.
  function encodeWav(samples) {
    var dataBytes = samples.length * 2;
    var buf = new ArrayBuffer(44 + dataBytes);
    var v = new DataView(buf);
    function ascii(off, text) { for (var i = 0; i < text.length; i++) v.setUint8(off + i, text.charCodeAt(i)); }
    ascii(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ascii(36, 'data'); v.setUint32(40, dataBytes, true);
    for (var i = 0; i < samples.length; i++) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, Math.round(s * 32767), true);
    }
    return new Uint8Array(buf);
  }

  function toBase64(bytes) {
    var bin = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  // Play a preset through Web Audio. Returns a promise that resolves when started.
  var ctxRef = null;
  function play(preset, seed) {
    var Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return Promise.reject(new Error('Web Audio is not available here'));
    if (!ctxRef) ctxRef = new Ctor();
    var ctx = ctxRef;
    var resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
    return resume.then(function () {
      var samples = render(preset, seed);
      var buffer = ctx.createBuffer(1, samples.length, RATE);
      buffer.copyToChannel(samples, 0);
      var src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start();
    });
  }

  var api = {
    PRESETS: PRESETS,
    RATE: RATE,
    render: render,
    encodeWav: encodeWav,
    toBase64: toBase64,
    play: play,
  };
  if (typeof globalThis !== 'undefined') globalThis.KgsmSfx = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
