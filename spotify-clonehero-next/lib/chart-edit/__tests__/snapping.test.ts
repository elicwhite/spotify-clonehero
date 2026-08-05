/**
 * Shared grid-snapping tests. This is the one implementation both interaction
 * views call, so these assertions pin the behavior the highway and the piano
 * roll both depend on.
 *
 * `RES` is ticks per quarter note, so a whole note is `RES * 4` and a
 * `gridDivision` of N steps by `RES * 4 / N`. The numbers below are written
 * as the note value the snap control's label promises, because the label
 * meaning what it says is the property under test.
 */

import {gridStepTicks, nextGridTick, snapTickToGrid} from '../snapping';

const RES = 480;
/** One quarter note. */
const QUARTER = RES;
/** One sixteenth: a quarter of a quarter. */
const SIXTEENTH = RES / 4;

describe('snapTickToGrid', () => {
  it('gridDivision 0 is free placement (rounds, clamps, does not snap)', () => {
    expect(snapTickToGrid(123, RES, 0)).toBe(123);
    expect(snapTickToGrid(123.6, RES, 0)).toBe(124);
    expect(snapTickToGrid(-50, RES, 0)).toBe(0);
  });

  it('snaps division 4 to quarter notes', () => {
    expect(QUARTER).toBe(480);
    expect(snapTickToGrid(0, RES, 4)).toBe(0);
    expect(snapTickToGrid(239, RES, 4)).toBe(0);
    expect(snapTickToGrid(240, RES, 4)).toBe(QUARTER);
    expect(snapTickToGrid(481, RES, 4)).toBe(QUARTER);
    expect(snapTickToGrid(1919, RES, 4)).toBe(QUARTER * 4);
  });

  it('snaps division 16 to sixteenths', () => {
    expect(SIXTEENTH).toBe(120);
    expect(snapTickToGrid(59, RES, 16)).toBe(0);
    expect(snapTickToGrid(60, RES, 16)).toBe(SIXTEENTH);
    expect(snapTickToGrid(179, RES, 16)).toBe(SIXTEENTH);
    expect(snapTickToGrid(180, RES, 16)).toBe(SIXTEENTH * 2);
  });

  it('snaps division 12 to eighth-note triplets', () => {
    // Three to the quarter: 480 / 3 = 160 ticks.
    expect(snapTickToGrid(160, RES, 12)).toBe(160);
    expect(snapTickToGrid(321, RES, 12)).toBe(320);
    expect(snapTickToGrid(480, RES, 12)).toBe(480);
  });

  it('never returns a negative tick', () => {
    expect(snapTickToGrid(-1000, RES, 4)).toBe(0);
    expect(snapTickToGrid(-5, RES, 16)).toBe(0);
  });

  it('rounds a non-integer grid step to whole ticks', () => {
    // 500 * 4 / 32 = 62.5, which rounds to a 63-tick lattice.
    expect(snapTickToGrid(63, 500, 32)).toBe(63);
    expect(snapTickToGrid(94, 500, 32)).toBe(63);
    expect(snapTickToGrid(95, 500, 32)).toBe(126);
  });
});

describe('gridStepTicks', () => {
  it('measures a step as the note value the label promises', () => {
    expect(gridStepTicks(RES, 4)).toBe(QUARTER);
    expect(gridStepTicks(RES, 16)).toBe(SIXTEENTH);
    expect(gridStepTicks(RES, 1)).toBe(QUARTER * 4);
  });

  it('has no lattice in free placement', () => {
    expect(gridStepTicks(RES, 0)).toBe(0);
  });
});

describe('nextGridTick', () => {
  it('steps a whole grid step off a line', () => {
    expect(nextGridTick(0, 1, RES, 4)).toBe(QUARTER);
    expect(nextGridTick(QUARTER, 1, RES, 4)).toBe(QUARTER * 2);
    expect(nextGridTick(QUARTER * 2, -1, RES, 4)).toBe(QUARTER);
  });

  it('moves to the neighbouring line from between two lines', () => {
    expect(nextGridTick(100, 1, RES, 4)).toBe(QUARTER);
    expect(nextGridTick(400, 1, RES, 4)).toBe(QUARTER);
    expect(nextGridTick(400, -1, RES, 4)).toBe(0);
    expect(nextGridTick(100, -1, RES, 4)).toBe(0);
  });

  it('steps one tick at a time in free placement', () => {
    expect(nextGridTick(123, 1, RES, 0)).toBe(124);
    expect(nextGridTick(123, -1, RES, 0)).toBe(122);
  });

  it('never walks past tick 0', () => {
    expect(nextGridTick(0, -1, RES, 4)).toBe(0);
    expect(nextGridTick(0, -1, RES, 0)).toBe(0);
  });

  it('shares the snap lattice, so a stepped cursor is already snapped', () => {
    const stepped = nextGridTick(137, 1, RES, 16);
    expect(stepped).toBe(snapTickToGrid(stepped, RES, 16));
  });
});
