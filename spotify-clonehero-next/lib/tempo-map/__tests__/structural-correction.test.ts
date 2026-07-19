/**
 * Structural tempo-correction incumbent-grid builders (plan 0061 §7).
 *
 * These produce the corrected `Synctrack` that the class-(b) RE-PREDICT op
 * takes as the warp's incumbent input — the octave rescale (×2 / ÷2) and the
 * tap-tempo constant-BPM + phase fit. Pure functions; no chart, no onsets.
 */

import type {Synctrack} from '../types';
import {
  octaveRescaleSync,
  fitTapTempo,
  tapTempoSync,
} from '../structural-correction';

const SYNC: Synctrack = {
  origin_ms: 10,
  tempos: [
    {ms: 10, bpm: 60},
    {ms: 2010, bpm: 90},
  ],
  timeSignatures: [{ms: 10, numerator: 6, denominator: 8}],
};

describe('octaveRescaleSync', () => {
  test('×2 doubles every segment BPM, preserving ms/TS/origin', () => {
    const out = octaveRescaleSync(SYNC, 2);
    expect(out.origin_ms).toBe(10);
    expect(out.tempos).toEqual([
      {ms: 10, bpm: 120},
      {ms: 2010, bpm: 180},
    ]);
    expect(out.timeSignatures).toEqual([
      {ms: 10, numerator: 6, denominator: 8},
    ]);
  });

  test('÷2 halves every segment BPM', () => {
    const out = octaveRescaleSync(SYNC, 0.5);
    expect(out.tempos.map(t => t.bpm)).toEqual([30, 45]);
  });

  test('does not mutate the input', () => {
    const before = JSON.parse(JSON.stringify(SYNC));
    octaveRescaleSync(SYNC, 2);
    expect(SYNC).toEqual(before);
  });

  test('rejects a non-positive factor', () => {
    expect(() => octaveRescaleSync(SYNC, 0)).toThrow();
    expect(() => octaveRescaleSync(SYNC, -2)).toThrow();
  });
});

describe('fitTapTempo', () => {
  test('two evenly-spaced taps → period + phase', () => {
    // 500 ms apart → 120 BPM; phase = first tap.
    const fit = fitTapTempo([1000, 1500]);
    expect(fit.bpm).toBeCloseTo(120, 6);
    expect(fit.phaseMs).toBe(1000);
  });

  test('more taps average the period (robust to a jittery middle tap)', () => {
    // Span 1000→2500 over 3 intervals = 500 ms mean → 120 BPM, despite the
    // middle tap sitting off the exact grid.
    const fit = fitTapTempo([1000, 1480, 2000, 2500]);
    expect(fit.bpm).toBeCloseTo(120, 6);
    expect(fit.phaseMs).toBe(1000);
  });

  test('unsorted taps are handled', () => {
    const fit = fitTapTempo([2500, 1000, 2000, 1500]);
    expect(fit.bpm).toBeCloseTo(120, 6);
    expect(fit.phaseMs).toBe(1000);
  });

  test('throws on fewer than two taps', () => {
    expect(() => fitTapTempo([1000])).toThrow();
    expect(() => fitTapTempo([])).toThrow();
  });

  test('throws when taps do not span a positive interval', () => {
    expect(() => fitTapTempo([1000, 1000, 1000])).toThrow();
  });
});

describe('tapTempoSync', () => {
  test('single constant-BPM segment phased to the first tap', () => {
    const out = tapTempoSync([1000, 1500, 2000]);
    expect(out.origin_ms).toBe(1000);
    expect(out.tempos).toHaveLength(1);
    expect(out.tempos[0].ms).toBe(1000);
    expect(out.tempos[0].bpm).toBeCloseTo(120, 6);
  });

  test('carries the chart meter (numerator + denominator) at the phase', () => {
    const out = tapTempoSync([0, 400], [{numerator: 7, denominator: 8}]);
    expect(out.timeSignatures).toEqual([{ms: 0, numerator: 7, denominator: 8}]);
  });

  test('defaults to 4/4 when no meter is supplied', () => {
    const out = tapTempoSync([0, 500]);
    expect(out.timeSignatures).toEqual([{ms: 0, numerator: 4, denominator: 4}]);
  });
});
