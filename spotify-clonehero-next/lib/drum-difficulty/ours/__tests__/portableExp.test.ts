/**
 * Bit-exact cross-language parity for `portableExp`/`sigmoid`/`softmax`
 * against the ACTUAL `drum-reducer-reference` Python module (not a
 * hand-transcribed expectation) — see
 * `__fixtures__/portable_exp_fixture.json`'s generation script
 * (`gen_portable_exp_fixture.py`, run under
 * `~/projects/drum-to-chart/.venv`) for how the fixture was produced: every
 * case is `drum_reducer.portable_exp`'s own output on a dense grid spanning
 * the overflow/underflow/tiny fast-paths, the exact boundary constants, and
 * the realistic GBM raw-score range this reducer actually sees.
 */

import {readFileSync} from 'fs';
import {join} from 'path';
import {portableExp, sigmoid, softmax} from '../portableExp';

type EncodedFloat = number | 'Infinity' | '-Infinity' | 'NaN';

interface Fixture {
  exp: {x: number; y: EncodedFloat}[];
  sigmoid: {x: number; y: EncodedFloat}[];
  softmax: {x: number[]; y: EncodedFloat[]}[];
}

/** Plain JSON has no Infinity/NaN literal — the fixture generator encodes
 * non-finite floats as a string sentinel; decode back to a real number. */
function decodeFloat(v: EncodedFloat): number {
  if (v === 'Infinity') return Infinity;
  if (v === '-Infinity') return -Infinity;
  if (v === 'NaN') return NaN;
  return v;
}

const rawFixture: Fixture = JSON.parse(
  readFileSync(
    join(__dirname, '..', '__fixtures__', 'portable_exp_fixture.json'),
    'utf8',
  ),
);
const fixture = {
  exp: rawFixture.exp.map(c => ({x: c.x, y: decodeFloat(c.y)})),
  sigmoid: rawFixture.sigmoid.map(c => ({x: c.x, y: decodeFloat(c.y)})),
  softmax: rawFixture.softmax.map(c => ({x: c.x, y: c.y.map(decodeFloat)})),
};

describe('portableExp — bit-exact vs Python drum_reducer.portable_exp', () => {
  test(`exp: ${fixture.exp.length} cases`, () => {
    for (const {x, y} of fixture.exp) {
      const got = portableExp(x);
      if (!Object.is(got, y)) {
        throw new Error(`portableExp(${x}) = ${got}, want ${y}`);
      }
    }
  });

  test(`sigmoid: ${fixture.sigmoid.length} cases`, () => {
    for (const {x, y} of fixture.sigmoid) {
      const got = sigmoid(x);
      if (!Object.is(got, y)) {
        throw new Error(`sigmoid(${x}) = ${got}, want ${y}`);
      }
    }
  });

  test(`softmax: ${fixture.softmax.length} cases`, () => {
    for (const {x, y} of fixture.softmax) {
      const got = softmax(x);
      expect(got.length).toBe(y.length);
      for (let i = 0; i < y.length; i++) {
        if (!Object.is(got[i], y[i])) {
          throw new Error(
            `softmax(${JSON.stringify(x)})[${i}] = ${got[i]}, want ${y[i]}`,
          );
        }
      }
    }
  });
});

describe('portableExp — sanity', () => {
  test('exp(0) === 1', () => {
    expect(portableExp(0)).toBe(1);
  });

  test('sigmoid(0) === 0.5', () => {
    expect(sigmoid(0)).toBe(0.5);
  });

  test('overflow saturates to Infinity', () => {
    expect(portableExp(800)).toBe(Infinity);
  });

  test('underflow saturates to 0', () => {
    expect(portableExp(-800)).toBe(0);
  });

  test('softmax sums to 1', () => {
    const out = softmax([1, 2, 3, -1]);
    const sum = out.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 12);
  });
});
