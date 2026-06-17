import {
  clickTrackTimesSec,
  clickTrackSampleCount,
} from '../practice/clickTrack';

describe('clickTrackTimesSec', () => {
  it('places clicks at leadIn + i*interval', () => {
    expect(clickTrackTimesSec(4, 0.6, 0.5)).toEqual([0.5, 1.1, 1.7, 2.3]);
  });

  it('returns an empty array for zero clicks', () => {
    expect(clickTrackTimesSec(0, 0.6, 0.5)).toEqual([]);
  });
});

describe('clickTrackSampleCount', () => {
  it('covers lead-in, all clicks, and the tail', () => {
    // last click at 0.5 + 3*0.6 = 2.3s, + 0.5s tail = 2.8s
    expect(clickTrackSampleCount(4, 0.6, 0.5, 0.5, 1000)).toBe(2800);
  });

  it('is at least one sample even with no clicks', () => {
    expect(clickTrackSampleCount(0, 0.6, 0.5, 0, 1000)).toBe(1);
  });

  it('rounds up to whole samples', () => {
    // last click 0.5s, +0.5 tail = 1.0s at 44100 → 44100 samples
    expect(clickTrackSampleCount(1, 0.6, 0.5, 0.5, 44100)).toBe(44100);
  });
});
