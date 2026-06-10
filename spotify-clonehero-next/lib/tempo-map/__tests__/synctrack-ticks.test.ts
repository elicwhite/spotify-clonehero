import {buildSegments, msToTick, tickToMs} from '../synctrack-ticks';
import type {Synctrack} from '../types';

const RES = 480;

describe('buildSegments', () => {
  test('lead-in bar spans exactly the origin time and ends on a bar boundary', () => {
    const sync: Synctrack = {
      origin_ms: 1000,
      tempos: [{ms: 1000, bpm: 120}],
      timeSignatures: [{ms: 1000, numerator: 4, denominator: 4}],
    };
    const segs = buildSegments(sync, RES);
    // One 4-beat lead-in bar covering 1000ms → 240 BPM lead.
    expect(segs[0]).toEqual({tick: 0, ms: 0, bpm: 240});
    expect(segs[1]).toEqual({tick: 1920, ms: 1000, bpm: 120});
    expect(segs[1].tick % (4 * RES)).toBe(0);
    // Audio anchor: ms=0 is exactly tick 0.
    expect(msToTick(0, segs, RES)).toBe(0);
    expect(tickToMs(0, segs, RES)).toBe(0);
  });

  test('small positive origin: fast lead-in bar, origin on a bar boundary', () => {
    const sync: Synctrack = {
      origin_ms: 65.2,
      tempos: [{ms: 65.2, bpm: 181.28}],
      timeSignatures: [{ms: 65.2, numerator: 4, denominator: 4}],
    };
    const segs = buildSegments(sync, RES);
    expect(segs[0].tick).toBe(0);
    expect(segs[0].ms).toBe(0);
    // 4 beats in 65.2ms
    expect(segs[0].bpm).toBeCloseTo((4 * 60000) / 65.2, 6);
    expect(segs[1].ms).toBeCloseTo(65.2, 6);
    expect(segs[1].tick % (4 * RES)).toBe(0);
    expect(tickToMs(0, segs, RES)).toBe(0);
  });

  test('negative origin: pre-audio region compressed, ms=0 ≈ its tick', () => {
    const sync: Synctrack = {
      origin_ms: -200,
      tempos: [{ms: -200, bpm: 96.77}],
      timeSignatures: [{ms: -200, numerator: 4, denominator: 4}],
    };
    const segs = buildSegments(sync, RES);
    // Origin (the downbeat) is tick 0; ms=0 lands shortly after.
    expect(segs[1].ms).toBe(0);
    expect(segs[1].tick).toBeGreaterThan(0);
    // The compressed region occupies ≤ 0.5ms of chart time.
    expect(tickToMs(0, segs, RES)).toBeGreaterThanOrEqual(-0.51);
    expect(tickToMs(segs[1].tick, segs, RES)).toBe(0);
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
