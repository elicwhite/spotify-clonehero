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
      instruments: new Set(['guitar', 'proDrums']),
      query: 'Incubus Drive',
    });

    expect(storage.setItem).toHaveBeenCalledWith(
      FIND_MUSIC_FILTERS_STORAGE_KEY,
      expect.any(String),
    );
    expect(loadFindMusicFilters(storage)).toEqual({
      install: 'hide-installed',
      instruments: new Set(['guitar', 'proDrums']),
      query: 'Incubus Drive',
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
      }),
    );

    expect(loadFindMusicFilters(storage)).toEqual({
      install: 'all',
      instruments: new Set(['guitar']),
      query: '',
    });
  });

  it('falls back to fresh defaults for corrupt or unavailable storage', () => {
    expect(loadFindMusicFilters(memoryStorage('{bad json'))).toEqual({
      install: 'all',
      instruments: new Set(),
      query: '',
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
    });
  });
});
