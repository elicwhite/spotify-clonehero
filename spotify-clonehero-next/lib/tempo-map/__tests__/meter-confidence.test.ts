import {
  computeMeterStats,
  METER_CONFIDENCE_THRESHOLD,
} from '../meter-confidence';

/** Build beats + downbeats from a bar pattern (beats per bar). */
function song(barPattern: number[], beatSec = 0.5) {
  const beats: number[] = [];
  const downbeats: number[] = [];
  let t = 0;
  for (const n of barPattern) {
    downbeats.push(t);
    for (let i = 0; i < n; i++) {
      beats.push(t + i * beatSec);
    }
    t += n * beatSec;
  }
  downbeats.push(t); // terminal downbeat closes the last bar
  return {beats, downbeats};
}

describe('computeMeterStats', () => {
  test('steady 4/4 is fully regular and above the threshold', () => {
    const {beats, downbeats} = song(Array(16).fill(4));
    const stats = computeMeterStats(beats, downbeats)!;
    expect(stats.frac4).toBe(1);
    expect(stats.mode).toBe(4);
    expect(stats.fracMode).toBe(1);
    expect(stats.barCount).toBe(16);
    expect(stats.frac4).toBeGreaterThanOrEqual(METER_CONFIDENCE_THRESHOLD);
  });

  test('steady 3/4 flags (frac4 = 0, mode = 3)', () => {
    const {beats, downbeats} = song(Array(16).fill(3));
    const stats = computeMeterStats(beats, downbeats)!;
    expect(stats.frac4).toBe(0);
    expect(stats.mode).toBe(3);
    expect(stats.fracMode).toBe(1);
    expect(stats.frac4).toBeLessThan(METER_CONFIDENCE_THRESHOLD);
  });

  test('mixed meter (7/8-style alternation) flags', () => {
    const pattern: number[] = [];
    for (let i = 0; i < 10; i++) pattern.push(4, 3);
    const {beats, downbeats} = song(pattern);
    const stats = computeMeterStats(beats, downbeats)!;
    expect(stats.frac4).toBeCloseTo(0.5, 6);
    expect(stats.frac4).toBeLessThan(METER_CONFIDENCE_THRESHOLD);
  });

  test('occasional 2/4 bar in 4/4 stays above the threshold', () => {
    const pattern = [...Array(14).fill(4), 2, 4];
    const {beats, downbeats} = song(pattern);
    const stats = computeMeterStats(beats, downbeats)!;
    expect(stats.frac4).toBeCloseTo(15 / 16, 6);
    expect(stats.frac4).toBeGreaterThanOrEqual(METER_CONFIDENCE_THRESHOLD);
  });

  test('too-short input returns null', () => {
    const {beats, downbeats} = song([4, 4]);
    expect(computeMeterStats(beats, downbeats)).toBeNull();
    expect(computeMeterStats([], [])).toBeNull();
  });
});
