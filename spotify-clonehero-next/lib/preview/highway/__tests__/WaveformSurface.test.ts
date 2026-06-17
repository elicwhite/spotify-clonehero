import {computeGlobalPeak, computeRowHalfWidth} from '../WaveformSurface';

describe('computeGlobalPeak', () => {
  it('returns 0 for an empty buffer', () => {
    expect(computeGlobalPeak(new Float32Array(0))).toBe(0);
  });

  it('returns 0 for a fully silent buffer', () => {
    expect(computeGlobalPeak(new Float32Array(1024))).toBe(0);
  });

  it('returns the largest absolute sample value', () => {
    const data = new Float32Array([0.1, -0.3, 0.5, -0.7, 0.2]);
    expect(computeGlobalPeak(data)).toBeCloseTo(0.7, 6);
  });

  it('considers negative peaks as well as positive peaks', () => {
    const data = new Float32Array([0.2, -0.9, 0.4]);
    expect(computeGlobalPeak(data)).toBeCloseTo(0.9, 6);
  });

  it('scans interleaved multi-channel data the same as mono', () => {
    // L/R interleaved; loudest sample is on the right channel
    const data = new Float32Array([0.1, 0.6, -0.2, -0.8, 0.3, 0.4]);
    expect(computeGlobalPeak(data)).toBeCloseTo(0.8, 6);
  });
});

describe('computeRowHalfWidth', () => {
  const CANVAS_HALF = 256; // arbitrary half-width in pixels
  const FILL = 0.8;

  it('renders the global peak at 80% of the canvas half-width', () => {
    const w = computeRowHalfWidth(0.5, 0.5, CANVAS_HALF);
    expect(w).toBeCloseTo(CANVAS_HALF * FILL, 6);
  });

  it('returns 0 when the global peak is 0 (silent audio)', () => {
    expect(computeRowHalfWidth(0, 0, CANVAS_HALF)).toBe(0);
    // Even if rowPeak is somehow non-zero, silent global peak should not blow up.
    expect(computeRowHalfWidth(0.1, 0, CANVAS_HALF)).toBe(0);
  });

  it('returns 0 when global peak is negative (defensive)', () => {
    expect(computeRowHalfWidth(0.5, -1, CANVAS_HALF)).toBe(0);
  });

  it('scales linearly with the row peak relative to the global peak', () => {
    const globalPeak = 0.5;
    // Half as loud as the loudest sample → half the width
    expect(computeRowHalfWidth(0.25, globalPeak, CANVAS_HALF)).toBeCloseTo(
      CANVAS_HALF * FILL * 0.5,
      6,
    );
    // 10% as loud → 10% the width
    expect(computeRowHalfWidth(0.05, globalPeak, CANVAS_HALF)).toBeCloseTo(
      CANVAS_HALF * FILL * 0.1,
      6,
    );
  });

  it('quiet audio still fills 80% at its own peak', () => {
    // If the entire song peaks at 0.1, that 0.1 sample should still render
    // at 80% of the canvas half-width.
    const w = computeRowHalfWidth(0.1, 0.1, CANVAS_HALF);
    expect(w).toBeCloseTo(CANVAS_HALF * FILL, 6);
  });
});
