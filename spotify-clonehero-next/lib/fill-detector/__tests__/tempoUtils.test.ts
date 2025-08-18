import {
  buildTempoMap,
  tickToMs,
  ticksToMsDuration,
  msToDurationTicks,
  validateTempos,
} from '../utils/tempoUtils';
import {TempoEvent} from '../types';

describe('Tempo Utilities', () => {
  const resolution = 192;

  describe('buildTempoMap', () => {
    it('should build tempo map from single tempo', () => {
      const tempos: TempoEvent[] = [{tick: 0, beatsPerMinute: 120, msTime: 0}];

      const tempoMap = buildTempoMap(tempos, resolution);

      expect(tempoMap).toHaveLength(1);
      expect(tempoMap[0].tick).toBe(0);
      expect(tempoMap[0].beatsPerMinute).toBe(120);
      expect(tempoMap[0].msTime).toBe(0);
    });

    it('should build tempo map from multiple tempos', () => {
      const tempos: TempoEvent[] = [
        {tick: 0, beatsPerMinute: 120, msTime: 0},
        {tick: 1920, beatsPerMinute: 140, msTime: 5000}, // 10 beats later, faster tempo
        {tick: 3840, beatsPerMinute: 100, msTime: 11000}, // 10 beats later, slower tempo
      ];

      const tempoMap = buildTempoMap(tempos, resolution);

      expect(tempoMap).toHaveLength(3);
      expect(tempoMap[0].beatsPerMinute).toBe(120);
      expect(tempoMap[1].beatsPerMinute).toBe(140);
      expect(tempoMap[2].beatsPerMinute).toBe(100);
    });

    it('should handle empty tempo array', () => {
      const tempoMap = buildTempoMap([], resolution);

      // Empty input returns empty array
      expect(tempoMap).toHaveLength(0);
    });
  });

  describe('validateTempos', () => {
    it('should validate correct tempo events', () => {
      const tempos: TempoEvent[] = [
        {tick: 0, beatsPerMinute: 120, msTime: 0},
        {tick: 1920, beatsPerMinute: 140, msTime: 5000},
      ];

      expect(() => validateTempos(tempos)).not.toThrow();
    });

    it('should reject negative BPM', () => {
      const tempos: TempoEvent[] = [{tick: 0, beatsPerMinute: -120, msTime: 0}];

      expect(() => validateTempos(tempos)).toThrow();
    });

    it('should reject zero BPM', () => {
      const tempos: TempoEvent[] = [{tick: 0, beatsPerMinute: 0, msTime: 0}];

      expect(() => validateTempos(tempos)).toThrow();
    });

    it('should reject negative ticks', () => {
      const tempos: TempoEvent[] = [
        {tick: -100, beatsPerMinute: 120, msTime: 0},
      ];

      expect(() => validateTempos(tempos)).toThrow();
    });
  });

  describe('ticksToMsDuration', () => {
    it('should convert tick duration to milliseconds at 120 BPM', () => {
      const bpm = 120;

      // 1 beat = 192 ticks at resolution 192
      // At 120 BPM: 1 beat = 500ms
      expect(ticksToMsDuration(192, resolution, bpm)).toBe(500);

      // 2 beats = 384 ticks = 1000ms
      expect(ticksToMsDuration(384, resolution, bpm)).toBe(1000);

      // Half beat = 96 ticks = 250ms
      expect(ticksToMsDuration(96, resolution, bpm)).toBe(250);
    });

    it('should convert tick duration to milliseconds at different BPMs', () => {
      // At 60 BPM: 1 beat = 1000ms
      expect(ticksToMsDuration(192, resolution, 60)).toBe(1000);

      // At 240 BPM: 1 beat = 250ms
      expect(ticksToMsDuration(192, resolution, 240)).toBe(250);
    });
  });

  describe('msToDurationTicks', () => {
    it('should convert millisecond duration to ticks at 120 BPM', () => {
      const bpm = 120;

      // 500ms = 1 beat = 192 ticks at 120 BPM
      expect(msToDurationTicks(500, bpm, resolution)).toBe(192);

      // 1000ms = 2 beats = 384 ticks
      expect(msToDurationTicks(1000, bpm, resolution)).toBe(384);

      // 250ms = half beat = 96 ticks
      expect(msToDurationTicks(250, bpm, resolution)).toBe(96);
    });

    it('should be inverse of ticksToMsDuration', () => {
      const bpm = 120;
      const originalTicks = 576; // 3 beats

      const ms = ticksToMsDuration(originalTicks, bpm, resolution);
      const backToTicks = msToDurationTicks(ms, bpm, resolution);

      expect(backToTicks).toBe(originalTicks);
    });
  });

  describe('tickToMs', () => {
    it('should get millisecond time from tick with single tempo', () => {
      const tempos: TempoEvent[] = [{tick: 0, beatsPerMinute: 120, msTime: 0}];

      // At tick 0
      expect(tickToMs(0, tempos, resolution)).toBe(0);

      // At tick 192 (1 beat) = 500ms at 120 BPM
      expect(tickToMs(192, tempos, resolution)).toBe(500);

      // At tick 384 (2 beats) = 1000ms
      expect(tickToMs(384, tempos, resolution)).toBe(1000);
    });

    it('should handle tempo changes correctly', () => {
      const tempos: TempoEvent[] = [
        {tick: 0, beatsPerMinute: 120, msTime: 0}, // 0-1920: 120 BPM
        {tick: 1920, beatsPerMinute: 60, msTime: 5000}, // 1920+: 60 BPM (slower)
      ];

      // Before tempo change
      expect(tickToMs(0, tempos, resolution)).toBe(0);
      expect(tickToMs(192, tempos, resolution)).toBe(500); // 1 beat at 120 BPM

      // At tempo change point
      expect(tickToMs(1920, tempos, resolution)).toBe(5000);

      // After tempo change (60 BPM: 1 beat = 1000ms)
      expect(tickToMs(1920 + 192, tempos, resolution)).toBe(5000 + 1000);
    });
  });

  // Note: There's no getTickFromMs function exported, so we'll skip this test
  // The tickToMs function is one-way conversion

  describe('edge cases', () => {
    it('should handle very high BPM values', () => {
      const tempos: TempoEvent[] = [{tick: 0, beatsPerMinute: 300, msTime: 0}];

      // At 300 BPM: 1 beat = 200ms
      const ms = tickToMs(192, tempos, resolution);
      expect(ms).toBe(200);
    });

    it('should handle very low BPM values', () => {
      const tempos: TempoEvent[] = [{tick: 0, beatsPerMinute: 30, msTime: 0}];

      // At 30 BPM: 1 beat = 2000ms
      const ms = tickToMs(192, tempos, resolution);
      expect(ms).toBe(2000);
    });

    it('should handle fractional tick values', () => {
      const tempos: TempoEvent[] = [{tick: 0, beatsPerMinute: 120, msTime: 0}];

      // Half tick should give half the time
      const fullBeatMs = tickToMs(192, tempos, resolution);
      const halfBeatMs = tickToMs(96, tempos, resolution);

      expect(halfBeatMs).toBe(fullBeatMs / 2);
    });

    it('should handle requests for ticks before first tempo event', () => {
      const tempos: TempoEvent[] = [
        {tick: 100, beatsPerMinute: 120, msTime: 1000}, // First tempo not at tick 0
      ];

      // Should extrapolate backwards
      const ms = tickToMs(0, tempos, resolution);
      expect(typeof ms).toBe('number');
      expect(isFinite(ms)).toBe(true);
    });
  });
});
