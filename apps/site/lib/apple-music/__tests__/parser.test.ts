import {
  readCatalogSearchSongs,
  readCatalogSong,
  readLibrarySong,
} from '../parser';

describe('Apple Music response parsing', () => {
  it('extracts a usable row only when artist and title are present', () => {
    expect(
      readLibrarySong({
        attributes: {
          artistName: ' Artist ',
          name: ' Track ',
          playParams: {catalogId: 'catalog-id'},
        },
      }),
    ).toEqual({artistName: 'Artist', title: 'Track', catalogId: 'catalog-id'});
    expect(readLibrarySong({attributes: {artistName: 'Artist'}})).toBeNull();
  });

  it('accepts complete catalog actions and ignores incomplete search resources', () => {
    const response = {
      data: {
        data: [
          {
            id: 'one',
            attributes: {
              artistName: 'Artist',
              name: 'Song',
              url: 'https://music.apple.com/us/song/song/1',
              previews: [
                {url: 'not a link'},
                {url: 'https://preview.test/a.m4a'},
              ],
            },
          },
        ],
      },
    };
    expect(readCatalogSong(response)).toEqual({
      catalogId: 'one',
      artistName: 'Artist',
      title: 'Song',
      url: 'https://music.apple.com/us/song/song/1',
      previewUrl: 'https://preview.test/a.m4a',
    });
    expect(
      readCatalogSearchSongs({
        data: {
          results: {
            songs: {
              data: [response.data.data[0], {id: 'missing', attributes: {}}],
            },
          },
        },
      }),
    ).toHaveLength(1);
  });
});
