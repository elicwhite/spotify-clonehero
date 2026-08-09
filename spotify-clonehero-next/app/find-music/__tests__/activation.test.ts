import {
  FIND_MUSIC_ACTIVATION_KEY,
  clearFindMusicActivation,
  hasFindMusicActivation,
  markFindMusicActivated,
} from '../activation';

describe('Find Music navigation activation', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };

  beforeEach(() => values.clear());

  it('survives provider navigation until the live return effect clears it', () => {
    markFindMusicActivated(storage);

    expect(hasFindMusicActivation(storage)).toBe(true);
    expect(hasFindMusicActivation(storage)).toBe(true);
    clearFindMusicActivation(storage);
    expect(hasFindMusicActivation(storage)).toBe(false);
    expect(values.has(FIND_MUSIC_ACTIVATION_KEY)).toBe(false);
  });
});
