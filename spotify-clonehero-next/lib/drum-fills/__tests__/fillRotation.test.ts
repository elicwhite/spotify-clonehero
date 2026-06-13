import {
  nextRotationIndex,
  previewRotationIndex,
} from '../practice/fillRotation';

describe('nextRotationIndex', () => {
  it('returns 0 for an empty or single-item pool', () => {
    expect(nextRotationIndex(0, 0, 'sequential')).toBe(0);
    expect(nextRotationIndex(1, 0, 'shuffle')).toBe(0);
  });

  it('wraps around in sequential order', () => {
    expect(nextRotationIndex(3, 0, 'sequential')).toBe(1);
    expect(nextRotationIndex(3, 1, 'sequential')).toBe(2);
    expect(nextRotationIndex(3, 2, 'sequential')).toBe(0);
  });

  it('uses the rng in shuffle order', () => {
    // rng=0 → index 0.
    expect(nextRotationIndex(4, 2, 'shuffle', () => 0)).toBe(0);
    // rng just under 1 → index 3.
    expect(nextRotationIndex(4, 0, 'shuffle', () => 0.999)).toBe(3);
  });

  it('avoids an immediate repeat in shuffle when possible', () => {
    // rng picks the current index → bumped to the next.
    expect(nextRotationIndex(4, 2, 'shuffle', () => 0.5)).not.toBe(2);
    expect(nextRotationIndex(4, 2, 'shuffle', () => 0.5)).toBe(3);
  });
});

describe('previewRotationIndex', () => {
  it('returns 0 for an empty or single-item pool', () => {
    expect(previewRotationIndex(0, 0)).toBe(0);
    expect(previewRotationIndex(1, 0)).toBe(0);
  });

  it('previews the sequential successor', () => {
    expect(previewRotationIndex(3, 0)).toBe(1);
    expect(previewRotationIndex(3, 2)).toBe(0);
  });
});
