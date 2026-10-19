import {resolveEscapeTier} from '../escapeRouting';

describe('escapeRouting: staged Escape priority (§12)', () => {
  it('menu wins over a simultaneous in-flight gesture', () => {
    expect(resolveEscapeTier(true, true)).toBe('menu');
  });

  it('menu wins alone', () => {
    expect(resolveEscapeTier(true, false)).toBe('menu');
  });

  it('falls through to gesture when there is no menu', () => {
    expect(resolveEscapeTier(false, true)).toBe('gesture');
  });

  it('falls through to the global selection-clear hotkey when the panel has nothing open', () => {
    expect(resolveEscapeTier(false, false)).toBe('none');
  });
});
