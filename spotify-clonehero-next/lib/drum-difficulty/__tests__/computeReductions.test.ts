/**
 * Unit tests for `isHarmonixCharter`, the detection used to show the
 * optional fourth "Harmonix" grid row (real authored Hard/Medium/Easy
 * tracks) on `/difficulties`: a case-insensitive CONTAINS check, not an
 * exact match — real-world charter fields vary ("Harmonix Music Systems").
 */

import {isHarmonixCharter} from '../computeReductions';

describe('isHarmonixCharter', () => {
  test('exact match', () => {
    expect(isHarmonixCharter('Harmonix')).toBe(true);
  });

  test('case-insensitive', () => {
    expect(isHarmonixCharter('harmonix')).toBe(true);
    expect(isHarmonixCharter('HARMONIX')).toBe(true);
  });

  test('substring match, not just exact equality', () => {
    expect(isHarmonixCharter('Harmonix Music Systems')).toBe(true);
    expect(isHarmonixCharter('Ported by Harmonix')).toBe(true);
  });

  test('unrelated charter names are rejected', () => {
    expect(isHarmonixCharter('Some Fan Charter')).toBe(false);
    expect(isHarmonixCharter('Neversoft')).toBe(false);
  });

  test('missing/empty charter is rejected', () => {
    expect(isHarmonixCharter(undefined)).toBe(false);
    expect(isHarmonixCharter('')).toBe(false);
  });
});
