import {getNextGridTick, getNextMeasureTick} from '../timing';

describe('getNextGridTick', () => {
  const resolution = 480;

  describe('1/16th note grid (gridDivision=4)', () => {
    const gridDivision = 4; // stepTicks = 480/4 = 120

    it('moves forward from 0', () => {
      expect(getNextGridTick(0, 1, gridDivision, resolution)).toBe(120);
    });

    it('moves forward from a grid line', () => {
      expect(getNextGridTick(120, 1, gridDivision, resolution)).toBe(240);
    });

    it('moves forward from between grid lines', () => {
      // Between 120 and 240, snaps to 240
      expect(getNextGridTick(150, 1, gridDivision, resolution)).toBe(240);
    });

    it('moves backward from a grid line', () => {
      expect(getNextGridTick(240, -1, gridDivision, resolution)).toBe(120);
    });

    it('moves backward from between grid lines', () => {
      // Between 120 and 240, snaps back to 120
      expect(getNextGridTick(200, -1, gridDivision, resolution)).toBe(120);
    });

    it('clamps to 0 when moving backward from 0', () => {
      expect(getNextGridTick(0, -1, gridDivision, resolution)).toBe(0);
    });

    it('clamps to 0 when moving backward from a small tick', () => {
      expect(getNextGridTick(60, -1, gridDivision, resolution)).toBe(0);
    });
  });

  describe('1/4 note grid (gridDivision=1)', () => {
    const gridDivision = 1; // stepTicks = 480/1 = 480

    it('moves forward by a quarter note', () => {
      expect(getNextGridTick(0, 1, gridDivision, resolution)).toBe(480);
    });

    it('moves forward from a grid line', () => {
      expect(getNextGridTick(480, 1, gridDivision, resolution)).toBe(960);
    });

    it('moves backward by a quarter note', () => {
      expect(getNextGridTick(960, -1, gridDivision, resolution)).toBe(480);
    });
  });

  describe('1/8 note grid (gridDivision=2)', () => {
    const gridDivision = 2; // stepTicks = 480/2 = 240

    it('moves forward by an eighth note', () => {
      expect(getNextGridTick(0, 1, gridDivision, resolution)).toBe(240);
    });

    it('moves forward from between grid lines', () => {
      expect(getNextGridTick(100, 1, gridDivision, resolution)).toBe(240);
    });
  });

  describe('free mode (gridDivision=0)', () => {
    it('moves forward by 1 tick', () => {
      expect(getNextGridTick(100, 1, 0, resolution)).toBe(101);
    });

    it('moves backward by 1 tick', () => {
      expect(getNextGridTick(100, -1, 0, resolution)).toBe(99);
    });

    it('clamps to 0', () => {
      expect(getNextGridTick(0, -1, 0, resolution)).toBe(0);
    });
  });

  describe('triplet grid (gridDivision=12)', () => {
    const gridDivision = 12; // stepTicks = 480/12 = 40

    it('moves forward by triplet step', () => {
      expect(getNextGridTick(0, 1, gridDivision, resolution)).toBe(40);
    });

    it('moves forward from grid line', () => {
      expect(getNextGridTick(40, 1, gridDivision, resolution)).toBe(80);
    });
  });
});

describe('getNextMeasureTick', () => {
  const resolution = 480;

  describe('4/4 time signature', () => {
    const timeSignatures = [{tick: 0, numerator: 4, denominator: 4}];
    // Measure = 4 * 480 = 1920 ticks

    it('moves forward from 0 to first measure boundary', () => {
      expect(getNextMeasureTick(0, 1, resolution, timeSignatures)).toBe(1920);
    });

    it('moves forward from mid-measure', () => {
      expect(getNextMeasureTick(500, 1, resolution, timeSignatures)).toBe(1920);
    });

    it('moves forward from a measure boundary', () => {
      expect(getNextMeasureTick(1920, 1, resolution, timeSignatures)).toBe(
        3840,
      );
    });

    it('moves backward from a measure boundary', () => {
      expect(getNextMeasureTick(1920, -1, resolution, timeSignatures)).toBe(0);
    });

    it('moves backward from mid-measure to measure start', () => {
      expect(getNextMeasureTick(500, -1, resolution, timeSignatures)).toBe(0);
    });

    it('moves backward from second measure mid-point', () => {
      expect(getNextMeasureTick(2500, -1, resolution, timeSignatures)).toBe(
        1920,
      );
    });

    it('clamps to 0 when moving backward from start', () => {
      expect(getNextMeasureTick(0, -1, resolution, timeSignatures)).toBe(0);
    });
  });

  describe('3/4 time signature', () => {
    const timeSignatures = [{tick: 0, numerator: 3, denominator: 4}];
    // Measure = 3 * 480 = 1440 ticks

    it('moves forward from 0', () => {
      expect(getNextMeasureTick(0, 1, resolution, timeSignatures)).toBe(1440);
    });

    it('moves backward from measure boundary', () => {
      expect(getNextMeasureTick(1440, -1, resolution, timeSignatures)).toBe(0);
    });
  });

  describe('6/8 time signature', () => {
    const timeSignatures = [{tick: 0, numerator: 6, denominator: 8}];
    // Beat = 480 * (4/8) = 240; Measure = 6 * 240 = 1440 ticks

    it('moves forward from 0', () => {
      expect(getNextMeasureTick(0, 1, resolution, timeSignatures)).toBe(1440);
    });

    it('moves forward from mid-measure', () => {
      expect(getNextMeasureTick(700, 1, resolution, timeSignatures)).toBe(1440);
    });
  });

  describe('time signature changes', () => {
    const timeSignatures = [
      {tick: 0, numerator: 4, denominator: 4}, // measure = 1920
      {tick: 3840, numerator: 3, denominator: 4}, // measure = 1440, starts at tick 3840
    ];

    it('navigates correctly in first TS', () => {
      expect(getNextMeasureTick(0, 1, resolution, timeSignatures)).toBe(1920);
    });

    it('navigates forward to second TS boundary', () => {
      expect(getNextMeasureTick(1920, 1, resolution, timeSignatures)).toBe(
        3840,
      );
    });

    it('navigates forward in second TS', () => {
      // In 3/4 starting at 3840: next measure = 3840 + 1440 = 5280
      expect(getNextMeasureTick(3840, 1, resolution, timeSignatures)).toBe(
        5280,
      );
    });

    it('navigates backward from second TS to first', () => {
      expect(getNextMeasureTick(3840, -1, resolution, timeSignatures)).toBe(
        1920,
      );
    });

    it('navigates backward within second TS', () => {
      // Mid-second-TS measure: 4000 -> back to 3840
      expect(getNextMeasureTick(4000, -1, resolution, timeSignatures)).toBe(
        3840,
      );
    });
  });

  describe('empty time signatures (defaults to 4/4)', () => {
    it('moves forward from 0', () => {
      expect(getNextMeasureTick(0, 1, resolution, [])).toBe(1920);
    });

    it('moves backward from measure boundary', () => {
      expect(getNextMeasureTick(1920, -1, resolution, [])).toBe(0);
    });

    it('clamps to 0', () => {
      expect(getNextMeasureTick(0, -1, resolution, [])).toBe(0);
    });
  });
});
