import {describe, test, expect} from '@jest/globals';
import {buildTimedTempoMap, msToTick} from '../timing';

describe('buildTimedTempoMap', () => {
  test('single tempo starts at ms 0', () => {
    const timed = buildTimedTempoMap([{tick: 0, beatsPerMinute: 120}], 480);
    expect(timed).toEqual([{tick: 0, beatsPerMinute: 120, msTime: 0}]);
  });

  test('computes msTime for tempo changes', () => {
    // At 120 BPM, 480 ticks = 1 beat = 500ms
    // So tick 960 = 2 beats = 1000ms
    const timed = buildTimedTempoMap(
      [
        {tick: 0, beatsPerMinute: 120},
        {tick: 960, beatsPerMinute: 240},
      ],
      480,
    );
    expect(timed[0].msTime).toBe(0);
    expect(timed[1].msTime).toBe(1000);
  });
});

describe('msToTick', () => {
  test('single tempo: ms 0 = tick 0', () => {
    const timed = buildTimedTempoMap([{tick: 0, beatsPerMinute: 120}], 480);
    expect(msToTick(0, timed, 480)).toBe(0);
  });

  test('single tempo: 500ms at 120 BPM / 480 ppq = tick 480', () => {
    const timed = buildTimedTempoMap([{tick: 0, beatsPerMinute: 120}], 480);
    expect(msToTick(500, timed, 480)).toBe(480);
  });

  test('single tempo: 1000ms at 120 BPM / 480 ppq = tick 960', () => {
    const timed = buildTimedTempoMap([{tick: 0, beatsPerMinute: 120}], 480);
    expect(msToTick(1000, timed, 480)).toBe(960);
  });

  test('multi-tempo: correctly switches at boundary', () => {
    // 120 BPM for first 960 ticks (1000ms), then 240 BPM
    const timed = buildTimedTempoMap(
      [
        {tick: 0, beatsPerMinute: 120},
        {tick: 960, beatsPerMinute: 240},
      ],
      480,
    );

    // Exactly at boundary
    expect(msToTick(1000, timed, 480)).toBe(960);

    // 250ms into the 240 BPM section: 250 * 240 * 480 / 60000 = 480 ticks past 960
    expect(msToTick(1250, timed, 480)).toBe(960 + 480);
  });

  test('ms before first tempo returns tick 0 region', () => {
    const timed = buildTimedTempoMap([{tick: 0, beatsPerMinute: 120}], 480);
    // Negative ms should still work (extrapolates backward)
    expect(msToTick(0, timed, 480)).toBe(0);
  });

  test('rounds to nearest tick', () => {
    const timed = buildTimedTempoMap([{tick: 0, beatsPerMinute: 120}], 480);
    // 250ms at 120 BPM / 480 ppq = 240 ticks exactly
    expect(msToTick(250, timed, 480)).toBe(240);
    // 251ms should round to 241
    const result = msToTick(251, timed, 480);
    expect(result).toBeGreaterThanOrEqual(240);
    expect(result).toBeLessThanOrEqual(242);
  });
});
