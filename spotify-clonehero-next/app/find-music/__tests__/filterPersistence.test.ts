import {
  FIND_MUSIC_FILTERS_STORAGE_KEY,
  loadFindMusicFilters,
  saveFindMusicFilters,
} from '../filterPersistence';

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: jest.fn(() => value),
    setItem: jest.fn((_key: string, next: string) => {
      value = next;
    }),
  };
}

describe('find music filter persistence', () => {
  it('round-trips the supported filters', () => {
    const storage = memoryStorage();
    saveFindMusicFilters(storage, {
      install: 'hide-installed',
      instruments: new Set(['guitar', 'drums']),
      query: 'Incubus Drive',
      exclusions: ['blink', 'Charter Name'],
      exclusionDraft: 'fall out',
    });

    expect(storage.setItem).toHaveBeenCalledWith(
      FIND_MUSIC_FILTERS_STORAGE_KEY,
      expect.any(String),
    );
    expect(loadFindMusicFilters(storage)).toEqual({
      install: 'hide-installed',
      instruments: new Set(['guitar', 'drums']),
      query: 'Incubus Drive',
      exclusions: ['blink', 'Charter Name'],
      exclusionDraft: 'fall out',
    });
  });

  it('safely ignores removed and invalid filter values', () => {
    const storage = memoryStorage(
      JSON.stringify({
        install: 'only-installed',
        instruments: ['drums', 'guitar', 'vocals', 42],
        query: 123,
        minPlays: 50,
        evidence: ['history'],
        exclusions: [' blink ', '', 'BLINK', 42, 'Charter Name'],
        exclusionDraft: 123,
      }),
    );

    expect(loadFindMusicFilters(storage)).toEqual({
      install: 'all',
      instruments: new Set(['drums', 'guitar']),
      query: '',
      exclusions: ['blink', 'Charter Name'],
      exclusionDraft: '',
    });
  });

  it('migrates the old pro drums filter id to drums', () => {
    const storage = memoryStorage(
      JSON.stringify({instruments: ['proDrums', 'drums']}),
    );

    expect(loadFindMusicFilters(storage).instruments).toEqual(
      new Set(['drums']),
    );
  });

  it('falls back to fresh defaults for corrupt or unavailable storage', () => {
    expect(loadFindMusicFilters(memoryStorage('{bad json'))).toEqual({
      install: 'all',
      instruments: new Set(),
      query: '',
      exclusions: [],
      exclusionDraft: '',
    });

    const unavailable = {
      getItem: jest.fn(() => {
        throw new Error('blocked');
      }),
    };
    expect(loadFindMusicFilters(unavailable)).toEqual({
      install: 'all',
      instruments: new Set(),
      query: '',
      exclusions: [],
      exclusionDraft: '',
    });
  });
});
