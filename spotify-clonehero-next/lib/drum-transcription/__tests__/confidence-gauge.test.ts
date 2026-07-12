import {
  computeLowConfidenceFraction,
  computeTempoInstability,
  computeConfidenceBucket,
  computeSongConfidence,
} from '../confidence-gauge';

describe('computeLowConfidenceFraction', () => {
  it('returns 0 for no notes', () => {
    expect(computeLowConfidenceFraction([])).toBe(0);
  });

  it('counts confidences strictly below 0.6 as low', () => {
    expect(computeLowConfidenceFraction([0.9, 0.8, 0.5, 0.3])).toBe(0.5);
  });

  it('treats exactly 0.6 as NOT low', () => {
    expect(computeLowConfidenceFraction([0.6, 0.6, 0.6, 0.6])).toBe(0);
  });

  it('all-low gives 1', () => {
    expect(computeLowConfidenceFraction([0.1, 0.2])).toBe(1);
  });
});

describe('computeTempoInstability', () => {
  it('returns 0 for a single tempo (or none)', () => {
    expect(computeTempoInstability([120])).toBe(0);
    expect(computeTempoInstability([])).toBe(0);
  });

  it('returns 0 for a perfectly steady multi-entry tempo map', () => {
    expect(computeTempoInstability([120, 120, 120])).toBe(0);
  });

  it('returns a higher coefficient of variation for a more variable tempo map', () => {
    const steady = computeTempoInstability([120, 121, 119]);
    const variable = computeTempoInstability([80, 160, 100]);
    expect(variable).toBeGreaterThan(steady);
  });
});

describe('computeConfidenceBucket', () => {
  it('is high when both features are good', () => {
    expect(computeConfidenceBucket(0.05, 0.01)).toBe('high');
  });

  it('is low when fraction of low-confidence notes is high', () => {
    expect(computeConfidenceBucket(0.5, 0.0)).toBe('low');
  });

  it('is low when tempo is unstable, even with good model confidence', () => {
    expect(computeConfidenceBucket(0.05, 0.3)).toBe('low');
  });

  it('is medium in between', () => {
    expect(computeConfidenceBucket(0.2, 0.02)).toBe('medium');
  });

  it('ignores tempo instability entirely when null (provided-grid path)', () => {
    // Good model confidence, no predicted tempo (existing chart's own grid) -> high.
    expect(computeConfidenceBucket(0.05, null)).toBe('high');
    // Bad model confidence still drags it down even with tempoInstability null.
    expect(computeConfidenceBucket(0.5, null)).toBe('low');
  });
});

describe('computeSongConfidence', () => {
  it('sets tempoInstability to null when predictedTempoBpms is null (chart-flow path 3a)', () => {
    const result = computeSongConfidence([0.9, 0.8], null);
    expect(result.tempoInstability).toBeNull();
    expect(result.fracLowConfidence).toBe(0);
    expect(result.bucket).toBe('high');
  });

  it('computes both features when a predicted tempo map is available', () => {
    const result = computeSongConfidence([0.9, 0.3, 0.2], [80, 160, 100]);
    expect(result.tempoInstability).not.toBeNull();
    expect(result.tempoInstability).toBeGreaterThan(0);
    expect(result.fracLowConfidence).toBeCloseTo(2 / 3);
    expect(result.bucket).toBe('low');
  });
});
