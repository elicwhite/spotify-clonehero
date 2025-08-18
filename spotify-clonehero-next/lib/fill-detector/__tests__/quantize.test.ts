import {
  ticksToBeats,
  beatsToTicks,
  quantizeTick,
  getQuantUnit,
} from '../quantize';

describe('Quantization Functions', () => {
  describe('ticksToBeats', () => {
    it('should convert ticks to beats correctly', () => {
      const resolution = 192; // Standard resolution (192 ticks per quarter note)

      // Test basic conversions
      expect(ticksToBeats(192, resolution)).toBe(1); // 1 beat
      expect(ticksToBeats(384, resolution)).toBe(2); // 2 beats
      expect(ticksToBeats(96, resolution)).toBe(0.5); // Half beat
      expect(ticksToBeats(48, resolution)).toBe(0.25); // Quarter beat
    });

    it('should handle different resolutions', () => {
      // Test with different resolution values
      expect(ticksToBeats(480, 480)).toBe(1); // 1 beat with 480 resolution
      expect(ticksToBeats(960, 480)).toBe(2); // 2 beats with 480 resolution

      expect(ticksToBeats(96, 96)).toBe(1); // 1 beat with 96 resolution
    });

    it('should handle edge cases', () => {
      const resolution = 192;

      // Zero ticks
      expect(ticksToBeats(0, resolution)).toBe(0);

      // Fractional results
      expect(ticksToBeats(64, resolution)).toBeCloseTo(0.333, 2);
    });

    it('should not return Infinity for valid inputs', () => {
      const resolution = 192;
      const windowTicks = 192; // 1 beat window
      const windowBeats = ticksToBeats(windowTicks, resolution);

      expect(windowBeats).toBe(1);
      expect(windowBeats).not.toBe(Infinity);
      expect(isFinite(windowBeats)).toBe(true);
    });
  });

  describe('beatsToTicks', () => {
    it('should convert beats to ticks correctly', () => {
      const resolution = 192;

      expect(beatsToTicks(1, resolution)).toBe(192);
      expect(beatsToTicks(2, resolution)).toBe(384);
      expect(beatsToTicks(0.5, resolution)).toBe(96);
      expect(beatsToTicks(0.25, resolution)).toBe(48);
    });

    it('should be inverse of ticksToBeats', () => {
      const resolution = 192;
      const originalTicks = 384;

      const beats = ticksToBeats(originalTicks, resolution);
      const backToTicks = beatsToTicks(beats, resolution);

      expect(backToTicks).toBe(originalTicks);
    });
  });

  describe('density calculations', () => {
    it('should calculate note density correctly', () => {
      const resolution = 192;
      const windowTicks = 192; // 1 beat window
      const windowBeats = ticksToBeats(windowTicks, resolution);

      // Test various note counts
      expect(4 / windowBeats).toBe(4); // 4 notes per beat
      expect(8 / windowBeats).toBe(8); // 8 notes per beat
      expect(2 / windowBeats).toBe(2); // 2 notes per beat
    });

    it('should handle actual window sizes from fill detection', () => {
      const resolution = 192;

      // Test actual window from debug (3072-3264 = 192 ticks)
      const actualWindowStart = 3072;
      const actualWindowEnd = 3264;
      const actualWindowTicks = actualWindowEnd - actualWindowStart;
      const actualWindowBeats = ticksToBeats(actualWindowTicks, resolution);
      const actualDensity = 4 / actualWindowBeats;

      expect(actualWindowTicks).toBe(192);
      expect(actualWindowBeats).toBe(1);
      expect(actualDensity).toBe(4);
    });
  });

  describe('quantizeTick', () => {
    it('should quantize ticks to grid', () => {
      const resolution = 192;
      const quantDiv = 4; // 16th notes

      // Test quantization to 16th note grid (quantDiv=4 means 16th notes)
      expect(quantizeTick(0, resolution, quantDiv)).toBe(0);
      expect(quantizeTick(48, resolution, quantDiv)).toBe(48); // Exactly on grid
      expect(quantizeTick(50, resolution, quantDiv)).toBe(48); // Round down
      expect(quantizeTick(70, resolution, quantDiv)).toBe(48); // Round down (closer to 48 than 96)
    });
  });

  describe('getQuantUnit', () => {
    it('should calculate quantization unit correctly', () => {
      const resolution = 192;

      expect(getQuantUnit(resolution, 1)).toBe(192); // Quarter notes (resolution / 1)
      expect(getQuantUnit(resolution, 2)).toBe(96); // 8th notes (resolution / 2)
      expect(getQuantUnit(resolution, 4)).toBe(48); // 16th notes (resolution / 4)
      expect(getQuantUnit(resolution, 8)).toBe(24); // 32nd notes (resolution / 8)
      expect(getQuantUnit(resolution, 16)).toBe(12); // 64th notes (resolution / 16)
    });
  });
});
