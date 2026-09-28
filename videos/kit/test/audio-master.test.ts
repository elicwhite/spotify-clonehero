/**
 * Mastering: the stem sum, one gain to the loudness target, a true-peak
 * limiter only when the peaks need it, a gain and limiter curve that always
 * belong together however hard the limiting, and a WAV writer that refuses
 * a NaN instead of writing it as silence.
 */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {integratedLoudness, truePeakDb} from '../scripts/audio/dsp';
import {applyMaster, master, sumStems} from '../scripts/audio/master';
import {
  SAMPLE_RATE,
  allocStereo,
  encodeWav,
  type Stereo,
} from '../scripts/audio/pcm';
import {mulberry32} from '../src/motion/random';

/** A 440 Hz bed at `bed` with a noise spike of `spike` every half second. */
function spiky(seconds: number, bed: number, spike: number): Stereo {
  const s = allocStereo(seconds * SAMPLE_RATE);
  const rnd = mulberry32(2);
  for (let i = 0; i < s.l.length; i++) {
    const hit = i % (SAMPLE_RATE / 2) < 40 ? spike * (2 * rnd() - 1) : 0;
    const v = bed * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) + hit;
    s.l[i] = v;
    s.r[i] = v;
  }
  return s;
}

const copy = (s: Stereo): Stereo => ({
  l: Float32Array.from(s.l),
  r: Float32Array.from(s.r),
});

describe('master', () => {
  it('uses the gain alone when the peaks fit', () => {
    const s = spiky(4, 0.02, 0);
    const m = master([s], -20, -1);
    assert.equal(m.limiter, null);
    assert.ok(Math.abs(m.lufs + 20) < 0.01, `lufs ${m.lufs}`);
    assert.ok(m.truePeakDb <= -1);
  });

  it('limits a peaky mix to the ceiling, and its numbers are those of what it returns', () => {
    const s = spiky(4, 0.002, 1);
    const m = master([s], -14, -1);
    assert.ok(m.limiter, 'needs limiting');
    assert.ok(m.maxReductionDb < -30, `reduction ${m.maxReductionDb}`);
    assert.ok(m.truePeakDb <= -1, `true peak ${m.truePeakDb}`);
    assert.ok(Math.abs(m.lufs + 14) < 0.05, `lufs ${m.lufs}`);
    const out = copy(s);
    applyMaster([out], m);
    assert.ok(Math.abs(integratedLoudness(out) - m.lufs) < 1e-6);
    assert.ok(Math.abs(truePeakDb(out) - m.truePeakDb) < 1e-6);
  });

  it('refuses a silent mix', () => {
    assert.throws(() => master([allocStereo(SAMPLE_RATE)], -14, -1), /silent/);
  });
});

describe('the stem sum and the WAV writer', () => {
  it('sums stems of different lengths to the longest', () => {
    const short: Stereo = {l: Float32Array.of(1, 1), r: Float32Array.of(2, 2)};
    const long: Stereo = {
      l: Float32Array.of(0.5, 0.5, 0.5, 0.5),
      r: Float32Array.of(0, 0, 0, 1),
    };
    const sum = sumStems([short, long]);
    assert.deepEqual([...sum.l], [1.5, 1.5, 0.5, 0.5]);
    assert.deepEqual([...sum.r], [2, 2, 0, 1]);
  });

  it('refuses a NaN or infinite sample, in either channel and format', () => {
    const s = allocStereo(4);
    s.r[2] = NaN;
    assert.throws(() => encodeWav(s), /sample 2 of the right channel is NaN/);
    s.r[2] = 0;
    s.l[3] = -Infinity;
    assert.throws(() => encodeWav(s, 32), /sample 3 of the left channel/);
    s.l[3] = 0.25;
    const wav = encodeWav(s);
    assert.equal(wav.length, 44 + 4 * 2 * 3);
    assert.equal(wav.readIntLE(44 + 3 * 6, 3), Math.round(0.25 * 8388607));
  });
});
