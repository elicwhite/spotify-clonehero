/**
 * The time-signature entry fields' pure rules: which meters commit, and which
 * ones the `.chart` format cannot encode.
 */

import {
  MAX_TS_NUMERATOR,
  TS_DENOMINATORS,
  parseMeterInput,
} from '../timeSignatureInput';

describe('parseMeterInput', () => {
  it('accepts a whole meter, with surrounding space', () => {
    expect(parseMeterInput('7', '8')).toEqual({
      ok: true,
      numerator: 7,
      denominator: 8,
    });
    expect(parseMeterInput('  3 ', ' 4 ')).toEqual({
      ok: true,
      numerator: 3,
      denominator: 4,
    });
  });

  it('accepts every denominator the format can encode', () => {
    for (const denominator of TS_DENOMINATORS) {
      expect(parseMeterInput('4', String(denominator))).toEqual({
        ok: true,
        numerator: 4,
        denominator,
      });
    }
  });

  it('rejects a denominator that is not a power of two', () => {
    expect(parseMeterInput('4', '3').ok).toBe(false);
    expect(parseMeterInput('4', '6').ok).toBe(false);
    expect(parseMeterInput('4', '128').ok).toBe(false);
  });

  it('rejects a numerator of zero, which would make a bar of no length', () => {
    expect(parseMeterInput('0', '4').ok).toBe(false);
  });

  it('rejects a numerator past the bound', () => {
    expect(parseMeterInput(String(MAX_TS_NUMERATOR), '4').ok).toBe(true);
    expect(parseMeterInput(String(MAX_TS_NUMERATOR + 1), '4').ok).toBe(false);
  });

  it('rejects empty, fractional, negative and non-numeric input', () => {
    expect(parseMeterInput('', '4').ok).toBe(false);
    expect(parseMeterInput('4', '').ok).toBe(false);
    expect(parseMeterInput('4.5', '4').ok).toBe(false);
    expect(parseMeterInput('-4', '4').ok).toBe(false);
    expect(parseMeterInput('4', '-4').ok).toBe(false);
    expect(parseMeterInput('four', '4').ok).toBe(false);
    expect(parseMeterInput('4', 'x8').ok).toBe(false);
  });

  it('reports the numerator first when both fields are wrong', () => {
    const result = parseMeterInput('0', '3');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Beats per bar/);
  });
});
