import {
  calibrate,
  applyCalibration,
  median,
  medianAbsoluteDeviation,
  pairDeltas,
} from '../calibration';

describe('median', () => {
  it('handles odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it('returns 0 for empty', () => {
    expect(median([])).toBe(0);
  });
});

describe('medianAbsoluteDeviation', () => {
  it('computes MAD about the median', () => {
    const v = [1, 1, 2, 2, 4, 6, 9];
    expect(medianAbsoluteDeviation(v, median(v))).toBe(1);
  });
});

describe('pairDeltas', () => {
  it('pairs each hit to its nearest click', () => {
    const clicks = [0, 1000, 2000];
    const hits = [40, 1035, 2050];
    expect(pairDeltas(clicks, hits, 250).sort((a, b) => a - b)).toEqual([
      35, 40, 50,
    ]);
  });

  it('drops hits beyond maxPairMs', () => {
    expect(pairDeltas([0], [500], 250)).toEqual([]);
  });

  it('does not reuse a click or hit', () => {
    // Two hits near one click, one hit near a second click.
    const deltas = pairDeltas([0, 1000], [10, 20, 1005], 250);
    // Closest pairs: (0,10)=10, (1000,1005)=5 -> then 20 has no click left.
    expect(deltas.sort((a, b) => a - b)).toEqual([5, 10]);
  });
});

describe('calibrate', () => {
  it('returns the median delta as the offset', () => {
    const clicks = [0, 1000, 2000, 3000];
    const hits = [30, 1032, 2028, 3030];
    const res = calibrate(clicks, hits);
    expect(res.offsetMs).toBeCloseTo(30, 5);
    expect(res.sampleCount).toBe(4);
  });

  it('rejects outliers (a badly mistimed tap) before taking the median', () => {
    const clicks = [0, 1000, 2000, 3000, 4000];
    // four taps ~30ms late, one tap 200ms late.
    const hits = [30, 1031, 2029, 3030, 4200];
    const res = calibrate(clicks, hits);
    expect(res.offsetMs).toBeCloseTo(30, 0);
    expect(res.rejectedDeltas).toContain(200);
    expect(res.acceptedDeltas).not.toContain(200);
  });

  it('returns zero offset when there are no usable pairs', () => {
    const res = calibrate([], []);
    expect(res.offsetMs).toBe(0);
    expect(res.sampleCount).toBe(0);
  });

  it('handles a perfectly consistent (zero-spread) tap stream', () => {
    const clicks = [0, 1000, 2000];
    const hits = [25, 1025, 2025];
    const res = calibrate(clicks, hits);
    expect(res.offsetMs).toBe(25);
    expect(res.rejectedDeltas).toHaveLength(0);
  });

  it('rejects a lone divergent tap when the rest agree exactly', () => {
    const clicks = [0, 1000, 2000];
    const hits = [25, 1025, 2090]; // last one off
    const res = calibrate(clicks, hits, {maxPairMs: 250});
    expect(res.offsetMs).toBe(25);
    expect(res.rejectedDeltas).toContain(90);
  });

  it('applyCalibration subtracts the offset', () => {
    expect(applyCalibration(1030, 30)).toBe(1000);
    expect(applyCalibration(970, -30)).toBe(1000);
  });

  it('full round trip: calibrated hits align with clicks for matching', () => {
    const clicks = [0, 500, 1000, 1500];
    const offset = 42;
    const hits = clicks.map(c => c + offset);
    const res = calibrate(clicks, hits);
    expect(res.offsetMs).toBe(offset);
    const corrected = hits.map(h => applyCalibration(h, res.offsetMs));
    corrected.forEach((c, i) => expect(c).toBeCloseTo(clicks[i], 5));
  });
});
