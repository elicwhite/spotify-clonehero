/**
 * Structural tempo-correction incumbent-grid builder (plan 0061 §7).
 *
 * Produces the corrected `Synctrack` that the class-(b) RE-PREDICT op takes
 * as the warp's incumbent input — the octave rescale (×2 / ÷2). Pure
 * function; no chart, no onsets. (Tap-tempo's constant-BPM + phase fit was
 * removed in plan 0063 Round 2 §6.)
 */

import type {Synctrack} from '../types';
import {octaveRescaleSync} from '../structural-correction';

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
