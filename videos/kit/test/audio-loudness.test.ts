/**
 * BS.1770-4 loudness and true peak on synthetic signals with known values:
 * the EBU Tech 3341 sine and gating cases, white noise against the K-filter's
 * analytic noise gain, and ffmpeg's own ebur128 reading of the same files.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';
import {
  K_HIGHPASS,
  K_SHELF,
  biquad,
  integratedLoudness,
  truePeakDb,
} from '../scripts/audio/dsp';
import {
  SAMPLE_RATE,
  allocStereo,
  writeWav,
  type Stereo,
} from '../scripts/audio/pcm';
import {
  ffmpegLoudness,
  parseDb,
  parseEbur128Summary,
} from '../scripts/audio/verify';
import {mulberry32} from '../src/motion/random';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-loudness-'));
after(() => fs.rmSync(scratch, {recursive: true, force: true}));

/** A stereo 1 kHz sine at `dbfs` peak level, both channels in phase, in pieces of [seconds, dBFS]. */
function sinePieces(pieces: [number, number][], hz = 1000, phase = 0): Stereo {
  const total = pieces.reduce(
    (n, [sec]) => n + Math.round(sec * SAMPLE_RATE),
    0,
  );
  const s = allocStereo(total);
  let i = 0;
  for (const [sec, dbfs] of pieces) {
    const a = 10 ** (dbfs / 20);
    for (const end = i + Math.round(sec * SAMPLE_RATE); i < end; i++) {
      const v = a * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE + phase);
      s.l[i] = v;
      s.r[i] = v;
    }
  }
  return s;
}

const near = (
  actual: number,
  expected: number,
  tolerance: number,
  what: string,
) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what}: ${actual.toFixed(3)}, expected ${expected} +- ${tolerance}`,
  );

describe('integratedLoudness (BS.1770-4)', () => {
  it('reads a stereo 1 kHz sine at its level (EBU Tech 3341 cases 1 and 2)', () => {
    near(
      integratedLoudness(sinePieces([[20, -23]])),
      -23,
      0.1,
      '-23 dBFS sine',
    );
    near(
      integratedLoudness(sinePieces([[20, -33]])),
      -33,
      0.1,
      '-33 dBFS sine',
    );
  });

  it('reads a 0 dBFS 1 kHz sine in one channel as -3.01 LUFS', () => {
    const s = sinePieces([[10, 0]]);
    s.r.fill(0);
    near(integratedLoudness(s), -3.01, 0.05, 'one-channel sine');
  });

  it('gates quiet blocks out (EBU Tech 3341 cases 3 and 4)', () => {
    const case3 = sinePieces([
      [10, -36],
      [60, -23],
      [10, -36],
    ]);
    near(integratedLoudness(case3), -23, 0.1, 'relative gate');
    const case4 = sinePieces([
      [10, -72],
      [10, -36],
      [60, -23],
      [10, -36],
      [10, -72],
    ]);
    near(integratedLoudness(case4), -23, 0.1, 'absolute and relative gates');
  });

  it('is -Infinity for silence', () => {
    assert.equal(integratedLoudness(allocStereo(SAMPLE_RATE * 2)), -Infinity);
  });

  it('reads white noise at the K-filter noise gain', () => {
    const impulse = new Float64Array(SAMPLE_RATE);
    impulse[0] = 1;
    const h = biquad(biquad(impulse, K_SHELF), K_HIGHPASS);
    const gain = h.reduce((acc, v) => acc + v * v, 0);
    const a = 0.25; // uniform in [-a, a]: variance a^2 / 3
    const rnd = mulberry32(3);
    const s = allocStereo(20 * SAMPLE_RATE);
    for (let i = 0; i < s.l.length; i++) {
      s.l[i] = a * (2 * rnd() - 1);
      s.r[i] = a * (2 * rnd() - 1);
    }
    const expected = -0.691 + 10 * Math.log10(2 * ((a * a) / 3) * gain);
    near(integratedLoudness(s), expected, 0.05, 'white noise');
    const file = path.join(scratch, 'noise.wav');
    writeWav(file, s, 32);
    near(ffmpegLoudness(file).lufs, expected, 0.15, 'ffmpeg on the same noise');
  });

  it('agrees with ffmpeg ebur128 on the gating case', () => {
    const file = path.join(scratch, 'case3.wav');
    const s = sinePieces([
      [10, -36],
      [30, -23],
      [10, -36],
    ]);
    writeWav(file, s, 32);
    near(
      ffmpegLoudness(file).lufs,
      integratedLoudness(s),
      0.1,
      'ffmpeg vs in-house',
    );
  });
});

describe('truePeakDb', () => {
  it('finds the peak between samples of a quarter-rate sine', () => {
    // fs/4 at 45 degrees: every sample is +-0.707 (-3.01 dBFS) but the wave peaks at 1.0.
    const s = sinePieces([[1, 0]], SAMPLE_RATE / 4, Math.PI / 4);
    let samplePeak = 0;
    for (const v of s.l) samplePeak = Math.max(samplePeak, Math.abs(v));
    near(20 * Math.log10(samplePeak), -3.01, 0.01, 'sample peak');
    near(truePeakDb(s), 0, 0.2, 'true peak');
  });

  it('agrees with ffmpeg on a mid-frequency sine', () => {
    // ffmpeg's own true-peak filter over-reads near fs/4, so compare where both are exact.
    const s = sinePieces([[2, -6]], 997);
    const file = path.join(scratch, 'tp.wav');
    writeWav(file, s, 32);
    near(truePeakDb(s), -6, 0.05, 'in-house');
    near(
      ffmpegLoudness(file).truePeakDb,
      truePeakDb(s),
      0.1,
      'ffmpeg vs in-house',
    );
  });
});

describe('ffmpeg loudness readings', () => {
  const summary = (i: string, peak: string) =>
    `[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         ${i} LUFS\n` +
    `    Threshold: -24.0 LUFS\n\n  True peak:\n    Peak:      ${peak} dBFS\n`;

  it('parses the summary, with -inf as silence', () => {
    assert.deepEqual(parseEbur128Summary(summary('-14.0', '-1.2')), {
      lufs: -14,
      truePeakDb: -1.2,
    });
    assert.deepEqual(parseEbur128Summary(summary('-70.0', '-inf')), {
      lufs: -70,
      truePeakDb: -Infinity,
    });
  });

  it('fails on an unreadable or missing reading instead of returning NaN', () => {
    assert.throws(() => parseEbur128Summary('no summary here'), /no summary/);
    assert.throws(
      () => parseEbur128Summary(summary('-14.0', 'nan')),
      /true peak/,
    );
    assert.throws(() => parseDb('1.2.3', 'true peak'), /unreadable true peak/);
    assert.throws(() => parseDb(undefined, 'true peak'), /no true peak/);
  });

  it('fails when ffmpeg fails', () => {
    assert.throws(
      () => ffmpegLoudness(path.join(scratch, 'missing.wav')),
      /ffmpeg exited/,
    );
  });
});
