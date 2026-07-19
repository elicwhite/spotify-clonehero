/**
 * Shared grid-snapping tests (plan 0062 invariant 3). This is the one
 * implementation both interaction views call, so these assertions pin the
 * behavior the highway and the piano roll both depend on.
 */

import {snapTickToGrid} from '../snapping';

const RES = 480;

describe('snapTickToGrid', () => {
  it('gridDivision 0 is free placement (rounds, clamps, does not snap)', () => {
    expect(snapTickToGrid(123, RES, 0)).toBe(123);
    expect(snapTickToGrid(123.6, RES, 0)).toBe(124);
    expect(snapTickToGrid(-50, RES, 0)).toBe(0);
  });

  it('snaps to the nearest grid step (quarter notes)', () => {
    // gridDivision 4 → step = 480/4 = 120 ticks.
    expect(snapTickToGrid(0, RES, 4)).toBe(0);
    expect(snapTickToGrid(59, RES, 4)).toBe(0);
    expect(snapTickToGrid(60, RES, 4)).toBe(120);
    expect(snapTickToGrid(121, RES, 4)).toBe(120);
    expect(snapTickToGrid(479, RES, 4)).toBe(480);
  });

  it('snaps to sixteenths', () => {
    // gridDivision 16 → step = 480/16 = 30 ticks.
    expect(snapTickToGrid(14, RES, 16)).toBe(0);
    expect(snapTickToGrid(16, RES, 16)).toBe(30);
    expect(snapTickToGrid(44, RES, 16)).toBe(30);
    expect(snapTickToGrid(45, RES, 16)).toBe(60);
  });

  it('never returns a negative tick', () => {
    expect(snapTickToGrid(-1000, RES, 4)).toBe(0);
    expect(snapTickToGrid(-5, RES, 16)).toBe(0);
  });

  it('rounds a non-integer grid step to whole ticks', () => {
    // resolution 480, gridDivision 3 → 160 exactly; use a resolution that
    // produces a fractional step to prove the integer rounding path.
    // 480/32 = 15 (integer). 500/32 = 15.625 → rounds to 16-tick lattice.
    expect(snapTickToGrid(16, 500, 32)).toBe(16);
    expect(snapTickToGrid(31, 500, 32)).toBe(32);
  });
});
