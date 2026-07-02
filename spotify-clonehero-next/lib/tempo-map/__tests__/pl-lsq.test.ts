/**
 * Tests for the PL_LSQ piecewise least-squares tempo map (port of
 * drum-to-chart autoresearch-tempo `_pl_lsq_segments`, banked keep 83d432d).
 */

import {
  beatsToSynctrack,
  plLsqSegments,
  PL_LSQ_TOL_MS_DEFAULT,
} from '../converter';

/** Deterministic pseudo-random jitter in [-amp, +amp] (no Math.random). */
function jitter(i: number, amp: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * amp;
}

/** Constant-tempo beat times (ms) with bounded jitter. */
function constantBeats(bpm: number, n: number, jitterAmp = 0): number[] {
  const dur = 60_000 / bpm;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i * dur + jitter(i, jitterAmp));
  return out;
}

describe('plLsqSegments', () => {
  test('clean click track collapses to a single segment', () => {
    const beats = constantBeats(120, 200);
    const res = plLsqSegments(beats, PL_LSQ_TOL_MS_DEFAULT)!;
    // One segment = start event + terminal event.
    expect(res.tempos).toHaveLength(2);
    expect(res.tempos[0].bpm).toBeCloseTo(120, 6);
    // Integer-beta origin pinning: beat 0 sits at an integer beta.
    expect(Math.abs(res.originMs % (60_000 / 120))).toBeLessThan(1e-6);
  });

  test('jittered click track: few segments, slope recovers true bpm', () => {
    const beats = constantBeats(120, 200, 8); // ±8ms detector jitter
    const res = plLsqSegments(beats, PL_LSQ_TOL_MS_DEFAULT)!;
    // Far sparser than per-beat (which would be 200 events).
    expect(res.tempos.length).toBeLessThanOrEqual(6);
    // LSQ averages the jitter: fitted tempo is close to the true 120.
    expect(res.tempos[0].bpm).toBeGreaterThan(119);
    expect(res.tempos[0].bpm).toBeLessThan(121);
  });

  test('tempo change yields exactly two segments with the right slopes', () => {
    const durA = 60_000 / 120;
    const durB = 60_000 / 140;
    const beats: number[] = [];
    for (let i = 0; i < 100; i++) beats.push(i * durA);
    const t0 = 99 * durA;
    for (let i = 1; i <= 100; i++) beats.push(t0 + i * durB);
    const res = plLsqSegments(beats, PL_LSQ_TOL_MS_DEFAULT)!;
    expect(res.tempos).toHaveLength(3); // 2 segments + terminal event
    expect(res.tempos[0].bpm).toBeCloseTo(120, 3);
    expect(res.tempos[1].bpm).toBeCloseTo(140, 1);
    // Continuity: second segment starts at the first segment's fitted end.
    expect(res.tempos[1].ms).toBeCloseTo(t0, 3);
  });

  test('segments are continuous and monotone', () => {
    const beats = constantBeats(97.3, 150, 10);
    const res = plLsqSegments(beats, PL_LSQ_TOL_MS_DEFAULT)!;
    for (let i = 1; i < res.tempos.length; i++) {
      expect(res.tempos[i].ms).toBeGreaterThan(res.tempos[i - 1].ms);
      expect(res.tempos[i - 1].bpm).toBeGreaterThan(0);
    }
  });

  test('degenerate input returns null', () => {
    expect(plLsqSegments([1000], 15)).toBeNull();
    expect(plLsqSegments([], 15)).toBeNull();
  });
});

describe('beatsToSynctrack with plLsqTolMs', () => {
  const beatsSec = constantBeats(120, 200, 5).map(ms => ms / 1000);
  const downbeatsSec = beatsSec.filter((_, i) => i % 4 === 0);

  test('default (0) preserves the per-beat golden behavior', () => {
    const dense = beatsToSynctrack({beats: beatsSec, downbeats: downbeatsSec})!;
    const denseExplicit = beatsToSynctrack({
      beats: beatsSec,
      downbeats: downbeatsSec,
      plLsqTolMs: 0,
    })!;
    expect(denseExplicit).toEqual(dense);
    // Per-beat map: roughly one tempo event per beat (post dedup/collapse).
    expect(dense.tempos.length).toBeGreaterThan(50);
  });

  test('enabled: sparse map, same downstream contract', () => {
    const sparse = beatsToSynctrack({
      beats: beatsSec,
      downbeats: downbeatsSec,
      plLsqTolMs: PL_LSQ_TOL_MS_DEFAULT,
    })!;
    expect(sparse.tempos.length).toBeLessThanOrEqual(8);
    expect(sparse.timeSignatures).toHaveLength(1);
    expect(sparse.timeSignatures[0].numerator).toBe(4);
    expect(sparse.timeSignatures[0].denominator).toBe(4);
    // Fitted tempo near truth despite the ±5ms jitter.
    expect(sparse.tempos[0].bpm).toBeGreaterThan(119);
    expect(sparse.tempos[0].bpm).toBeLessThan(121);
  });
});
