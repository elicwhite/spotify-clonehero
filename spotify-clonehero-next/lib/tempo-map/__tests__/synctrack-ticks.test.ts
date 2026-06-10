import {buildSegments, msToTick, tickToMs} from '../synctrack-ticks';
import type {Synctrack} from '../types';

const RES = 480;

describe('buildSegments', () => {
  test('places the origin on a bar boundary', () => {
    const sync: Synctrack = {
      origin_ms: 1000,
      tempos: [{ms: 1000, bpm: 120}],
      timeSignatures: [{ms: 1000, numerator: 4, denominator: 4}],
    };
    const segs = buildSegments(sync, RES);
    // Origin is 2 beats after ms=0; the nearest whole bar at/after that is
    // bar 1 (tick 1920), so ms=0 anchors at 1920 - 960 = 960.
    expect(segs[0]).toEqual({tick: 960, ms: 0, bpm: 120});
    expect(segs[1]).toEqual({tick: 1920, ms: 1000, bpm: 120});
    expect(segs[1].tick % (4 * RES)).toBe(0);
  });

  test('small positive origin still lands on a bar boundary with ms=0 ≥ tick 0', () => {
    const sync: Synctrack = {
      origin_ms: 65.2,
      tempos: [{ms: 65.2, bpm: 181.28}],
      timeSignatures: [{ms: 65.2, numerator: 4, denominator: 4}],
    };
    const segs = buildSegments(sync, RES);
    expect(segs[0].tick).toBeGreaterThanOrEqual(0);
    expect(segs[1].ms).toBeCloseTo(65.2, 6);
    expect(segs[1].tick % (4 * RES)).toBe(0);
  });

  test('negative origin anchors at tick 0 with ms=0 slightly after', () => {
    const sync: Synctrack = {
      origin_ms: -11,
      tempos: [{ms: -11, bpm: 96.77}],
      timeSignatures: [{ms: -11, numerator: 4, denominator: 4}],
    };
    const segs = buildSegments(sync, RES);
    expect(segs[0].ms).toBe(0);
    expect(segs[0].tick).toBeGreaterThan(0);
    expect(segs[0].tick).toBeLessThan(20);
  });

  test('accumulates ticks across tempo changes', () => {
    const sync: Synctrack = {
      origin_ms: 0,
      tempos: [
        {ms: 0, bpm: 120},
        {ms: 1000, bpm: 60},
      ],
      timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
    };
    const segs = buildSegments(sync, RES);
    // 1000ms at 120 BPM = 2 beats = 960 ticks, then 60 BPM after
    expect(segs).toEqual([
      {tick: 0, ms: 0, bpm: 120},
      {tick: 960, ms: 1000, bpm: 60},
    ]);
  });

  test('empty tempos falls back to 120 BPM anchor', () => {
    const sync: Synctrack = {origin_ms: 0, tempos: [], timeSignatures: []};
    expect(buildSegments(sync, RES)).toEqual([{tick: 0, ms: 0, bpm: 120}]);
  });
});

describe('msToTick / tickToMs round trip', () => {
  const sync: Synctrack = {
    origin_ms: 0,
    tempos: [
      {ms: 0, bpm: 120},
      {ms: 2000, bpm: 90},
      {ms: 4000, bpm: 180},
    ],
    timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
  };
  const segs = buildSegments(sync, RES);

  test('inside each segment', () => {
    // 1000ms in segment 1 (120 BPM): 2 beats = 960 ticks
    expect(msToTick(1000, segs, RES)).toBeCloseTo(960, 6);
    // 3000ms: 2000ms at 120 (1920 ticks) + 1000ms at 90 (1.5 beats = 720)
    expect(msToTick(3000, segs, RES)).toBeCloseTo(1920 + 720, 6);
  });

  test('round-trips arbitrary times', () => {
    for (const ms of [0, 123.4, 1999.9, 2000, 3500, 4000, 9876.5]) {
      const tick = msToTick(ms, segs, RES);
      expect(tickToMs(tick, segs, RES)).toBeCloseTo(ms, 6);
    }
  });

  test('extrapolates backward before the anchor', () => {
    // -500ms at 120 BPM = -1 beat = -480 ticks (fractional; callers clamp)
    expect(msToTick(-500, segs, RES)).toBeCloseTo(-480, 6);
  });
});
