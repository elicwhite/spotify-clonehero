import {
  BASE_BIN_MS,
  buildAmpPyramid,
  pickLevel,
  sampleAmpRange,
} from '../wavePeaks';

describe('wavePeaks: buildAmpPyramid', () => {
  it('returns an empty pyramid for missing/empty/zero-duration input', () => {
    expect(buildAmpPyramid(undefined, 2, 1000).levels).toHaveLength(0);
    expect(buildAmpPyramid(new Float32Array(0), 2, 1000).levels).toHaveLength(
      0,
    );
    expect(buildAmpPyramid(new Float32Array([1, 1]), 2, 0).levels).toHaveLength(
      0,
    );
  });

  it('builds a level-0 bucket per BASE_BIN_MS and coarser levels by max-pooling', () => {
    // 1 second, mono, 1000 samples/sec so 1 sample == 1ms; a single loud
    // sample at ~500ms with everything else silent.
    const sampleRate = 1000;
    const durationMs = 1000;
    const audio = new Float32Array(sampleRate);
    audio[500] = 0.9;
    const pyramid = buildAmpPyramid(audio, 1, durationMs);
    expect(pyramid.levels[0].binMs).toBe(BASE_BIN_MS);
    // Every subsequent level doubles the bucket width.
    for (let i = 1; i < pyramid.levels.length; i++) {
      expect(pyramid.levels[i].binMs).toBe(pyramid.levels[i - 1].binMs * 2);
    }
    // The loud sample survives (as the max) all the way up the pyramid.
    for (const level of pyramid.levels) {
      const bucket = Math.floor(500 / level.binMs);
      expect(level.peaks[bucket]).toBeCloseTo(0.9, 5);
    }
  });

  it('collapses stereo channels via per-sample max', () => {
    const sampleRate = 1000;
    const durationMs = 100;
    // Interleaved L/R; a spike on the right channel only should still show.
    const audio = new Float32Array((sampleRate / 10) * 2);
    audio[2 * 3 + 1] = 0.7; // sample 3, right channel
    const pyramid = buildAmpPyramid(audio, 2, durationMs);
    const bucket = Math.floor(3 / (sampleRate / 1000) / BASE_BIN_MS);
    expect(pyramid.levels[0].peaks[bucket]).toBeCloseTo(0.7, 5);
  });
});

describe('wavePeaks: pickLevel', () => {
  it('picks the finest level whose bucket is <= the target width', () => {
    const audio = new Float32Array(4000).fill(0.1);
    const pyramid = buildAmpPyramid(audio, 1, 4000);
    // Exactly BASE_BIN_MS should pick level 0.
    expect(pickLevel(pyramid, BASE_BIN_MS)).toBe(0);
    // A much wider target should pick a coarser level.
    const coarse = pickLevel(pyramid, 500);
    expect(pyramid.levels[coarse].binMs).toBeLessThanOrEqual(500);
    expect(coarse).toBeGreaterThan(0);
  });

  it('returns -1 for an empty pyramid', () => {
    expect(pickLevel(buildAmpPyramid(undefined, 1, 0), 100)).toBe(-1);
  });
});

describe('wavePeaks: sampleAmpRange (the anti-aliasing fix)', () => {
  it('finds a transient a coarse point-sample at the column edge would miss', () => {
    // 2 seconds, one sharp spike right in the middle of a wide column.
    const sampleRate = 1000;
    const durationMs = 2000;
    const audio = new Float32Array(sampleRate * 2);
    audio[1000] = 1; // spike at exactly 1000ms
    const pyramid = buildAmpPyramid(audio, 1, durationMs);

    // A zoomed-out column spanning 900ms..1100ms (200ms wide) — a single
    // point sample at either edge would read ~0, but the peak (1.0) sits in
    // the middle and must not be lost.
    expect(sampleAmpRange(pyramid, 900, 1100)).toBeCloseTo(1, 5);
    // Edges alone (no spike) read ~0.
    expect(sampleAmpRange(pyramid, 0, 100)).toBeCloseTo(0, 5);
  });

  it('returns 0 outside the audio duration', () => {
    const audio = new Float32Array(1000).fill(0.5);
    const pyramid = buildAmpPyramid(audio, 1, 1000);
    expect(sampleAmpRange(pyramid, 5000, 5100)).toBe(0);
  });

  it('returns 0 for an empty pyramid', () => {
    expect(sampleAmpRange(buildAmpPyramid(undefined, 1, 0), 0, 100)).toBe(0);
  });
});
