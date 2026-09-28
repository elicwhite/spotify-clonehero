import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {breakLines} from '../src/text/measure';

/** Every test sets words 10 px apart. */
const SPACE = 10;

describe('breakLines', () => {
  it('keeps text that fits on one line', () => {
    assert.deepEqual(breakLines([50, 50, 50], SPACE, 500), [[0, 1, 2]]);
    assert.deepEqual(breakLines([], SPACE, 500), []);
  });

  it('uses the fewest lines, balanced', () => {
    // Greedy fills the first line (40 + 10 + 40 + 10 + 40 = 140) and leaves
    // one word on the second; balanced splits 90 / 90.
    const widths = [40, 40, 40, 40];
    assert.deepEqual(breakLines(widths, SPACE, 140, {balance: false}), [
      [0, 1, 2],
      [3],
    ]);
    assert.deepEqual(breakLines(widths, SPACE, 140), [
      [0, 1],
      [2, 3],
    ]);
  });

  it('makes the widest line as narrow as it can be', () => {
    // Two lines: 130 / 110 beats 60 / 180 and 170 / 70.
    assert.deepEqual(breakLines([60, 60, 30, 30, 30], SPACE, 200), [
      [0, 1],
      [2, 3, 4],
    ]);
  });

  it('then makes the lines as even as it can', () => {
    // Three lines; the 100 px word is the widest line whatever the break.
    // Of 100 / 20 / 80, 100 / 50 / 50 and 100 / 80 / 20, the second is the
    // most even.
    assert.deepEqual(breakLines([100, 20, 20, 20, 20], SPACE, 100), [
      [0],
      [1, 2],
      [3, 4],
    ]);
  });

  it('breaks a remaining tie as late as possible', () => {
    // 80 / 50 and 50 / 80 are equally narrow and even: the first line takes more.
    assert.deepEqual(breakLines([50, 20, 50], SPACE, 100), [[0, 1], [2]]);
  });

  it('caps the line count', () => {
    const widths = [80, 80, 80, 80];
    assert.deepEqual(breakLines(widths, SPACE, 90, {balance: false}), [
      [0],
      [1],
      [2],
      [3],
    ]);
    assert.deepEqual(
      breakLines(widths, SPACE, 90, {balance: false, maxLines: 2}),
      [[0], [1, 2, 3]],
    );
    // Balanced into two lines, the overflow is shared.
    assert.deepEqual(breakLines(widths, SPACE, 90, {maxLines: 2}), [
      [0, 1],
      [2, 3],
    ]);
  });

  it('keeps a word wider than the measure on its own line', () => {
    assert.deepEqual(breakLines([300, 20, 20], SPACE, 100), [[0], [1, 2]]);
  });
});
