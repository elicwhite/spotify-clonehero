/** @jest-environment jsdom */

import {
  AppleMusicError,
  classifyAppleMusicError,
  configureAppleMusicClient,
} from '../client';

describe('configureAppleMusicClient', () => {
  afterEach(() => {
    delete (window as Window & {MusicKit?: unknown}).MusicKit;
  });

  it('reports restored authorization without reading the library', async () => {
    const music = jest.fn();
    const instance = {
      isAuthorized: true,
      authorize: jest.fn(async () => undefined),
      unauthorize: jest.fn(async () => undefined),
      api: {music},
    };
    const configure = jest.fn(async () => instance);
    (window as Window & {MusicKit?: unknown}).MusicKit = {configure};

    const client = await configureAppleMusicClient('developer-token');

    expect(client.isAuthorized()).toBe(true);
    expect(music).not.toHaveBeenCalled();
    expect(instance.authorize).not.toHaveBeenCalled();
  });

  it('reads every returned library page serially and reports cumulative progress', async () => {
    const music = jest
      .fn()
      .mockResolvedValueOnce({data: {data: [{id: 'us'}]}})
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              attributes: {
                artistName: ' Artist ',
                name: ' Song ',
                playParams: {catalogId: 'first'},
              },
            },
            {attributes: {artistName: 'Missing title'}},
          ],
          meta: {total: 3},
          next: '/v1/me/library/songs?offset=2',
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              attributes: {artistName: 'Artist 2', name: 'Song 2'},
              relationships: {catalog: {data: [{id: 'second'}]}},
            },
          ],
        },
      });
    const instance = {
      isAuthorized: true,
      authorize: jest.fn(async () => undefined),
      unauthorize: jest.fn(async () => undefined),
      api: {music},
    };
    (window as Window & {MusicKit?: unknown}).MusicKit = {
      configure: jest.fn(async () => instance),
    };
    const client = await configureAppleMusicClient('developer-token');
    const onProgress = jest.fn();

    await expect(client.fetchLibrarySongs({onProgress})).resolves.toEqual({
      storefront: 'us',
      total: 3,
      fetchedCount: 3,
      usableCount: 2,
      catalogAssociatedCount: 2,
      pagesFetched: 2,
      songs: [
        {artistName: 'Artist', title: 'Song', catalogId: 'first'},
        {artistName: 'Artist 2', title: 'Song 2', catalogId: 'second'},
      ],
    });
    expect(music.mock.calls).toEqual([
      ['/v1/me/storefront'],
      ['/v1/me/library/songs', {limit: 100}],
      ['/v1/me/library/songs?offset=2'],
    ]);
    expect(onProgress.mock.calls).toEqual([
      [
        {
          total: 3,
          fetchedCount: 2,
          usableCount: 1,
          catalogAssociatedCount: 1,
          pagesFetched: 1,
        },
      ],
      [
        {
          total: 3,
          fetchedCount: 3,
          usableCount: 2,
          catalogAssociatedCount: 2,
          pagesFetched: 2,
        },
      ],
    ]);
  });

  it('rejects a truncated pagination chain when the reported total is larger', async () => {
    const music = jest
      .fn()
      .mockResolvedValueOnce({data: {data: [{id: 'us'}]}})
      .mockResolvedValueOnce({
        data: {
          data: [{attributes: {artistName: 'Artist', name: 'Only Song'}}],
          meta: {total: 2},
        },
      });
    const instance = {
      isAuthorized: true,
      authorize: jest.fn(async () => undefined),
      unauthorize: jest.fn(async () => undefined),
      api: {music},
    };
    (window as Window & {MusicKit?: unknown}).MusicKit = {
      configure: jest.fn(async () => instance),
    };
    const client = await configureAppleMusicClient('developer-token');

    await expect(client.fetchLibrarySongs()).rejects.toMatchObject({
      code: 'malformed_response',
    });
  });

  it.each([
    {
      name: 'unknown total',
      page: {
        data: [{attributes: {artistName: 'Artist', name: 'Song'}}],
      },
      expectedTotal: null,
      expectedFetched: 1,
    },
    {
      name: 'empty library with zero total',
      page: {data: [], meta: {total: 0}},
      expectedTotal: 0,
      expectedFetched: 0,
    },
  ])('accepts a complete scan with $name', async testCase => {
    const music = jest
      .fn()
      .mockResolvedValueOnce({data: {data: [{id: 'us'}]}})
      .mockResolvedValueOnce({data: testCase.page});
    const instance = {
      isAuthorized: true,
      authorize: jest.fn(async () => undefined),
      unauthorize: jest.fn(async () => undefined),
      api: {music},
    };
    (window as Window & {MusicKit?: unknown}).MusicKit = {
      configure: jest.fn(async () => instance),
    };
    const client = await configureAppleMusicClient('developer-token');

    await expect(client.fetchLibrarySongs()).resolves.toMatchObject({
      total: testCase.expectedTotal,
      fetchedCount: testCase.expectedFetched,
    });
  });

  it('deduplicates a failing storefront request but retries it later', async () => {
    const music = jest
      .fn()
      .mockRejectedValueOnce({status: 503})
      .mockResolvedValueOnce({data: {data: [{id: 'us'}]}})
      .mockResolvedValueOnce({data: {data: [], meta: {total: 0}}});
    const instance = {
      isAuthorized: true,
      authorize: jest.fn(async () => undefined),
      unauthorize: jest.fn(async () => undefined),
      api: {music},
    };
    (window as Window & {MusicKit?: unknown}).MusicKit = {
      configure: jest.fn(async () => instance),
    };
    const client = await configureAppleMusicClient('developer-token');

    const failures = await Promise.allSettled([
      client.fetchLibrarySongs(),
      client.fetchLibrarySongs(),
    ]);
    expect(failures).toEqual([
      expect.objectContaining({
        status: 'rejected',
        reason: expect.objectContaining({code: 'transient'}),
      }),
      expect.objectContaining({
        status: 'rejected',
        reason: expect.objectContaining({code: 'transient'}),
      }),
    ]);
    expect(music).toHaveBeenCalledTimes(1);

    await expect(client.fetchLibrarySongs()).resolves.toMatchObject({
      storefront: 'us',
      total: 0,
      fetchedCount: 0,
    });
    expect(music).toHaveBeenCalledTimes(3);
  });

  it('does not issue a subsequent page after cancellation', async () => {
    const controller = new AbortController();
    const music = jest
      .fn()
      .mockResolvedValueOnce({data: {data: [{id: 'us'}]}})
      .mockImplementationOnce(async () => {
        controller.abort();
        return {
          data: {
            data: [{attributes: {artistName: 'Artist', name: 'Song'}}],
            next: '/v1/me/library/songs?offset=1',
          },
        };
      });
    const instance = {
      isAuthorized: true,
      authorize: jest.fn(async () => undefined),
      unauthorize: jest.fn(async () => undefined),
      api: {music},
    };
    (window as Window & {MusicKit?: unknown}).MusicKit = {
      configure: jest.fn(async () => instance),
    };
    const client = await configureAppleMusicClient('developer-token');

    await expect(
      client.fetchLibrarySongs({signal: controller.signal}),
    ).rejects.toMatchObject({code: 'aborted'});
    expect(music).toHaveBeenCalledTimes(2);
  });

  it('caches direct catalog actions in memory and rejects ambiguous search results', async () => {
    const music = jest
      .fn()
      .mockResolvedValueOnce({data: {data: [{id: 'us'}]}})
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              id: 'catalog-1',
              attributes: {
                artistName: 'Artist',
                name: 'Song',
                url: 'https://music.apple.com/us/song/song/1',
                previews: [{url: 'https://audio-ssl.itunes.apple.com/a.m4a'}],
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          results: {
            songs: {
              data: [
                {
                  id: 'a',
                  attributes: {
                    artistName: 'Artist',
                    name: 'Song',
                    url: 'https://music.apple.com/us/song/a/1',
                  },
                },
                {
                  id: 'b',
                  attributes: {
                    artistName: 'Artist',
                    name: 'Song',
                    url: 'https://music.apple.com/us/song/b/2',
                  },
                },
              ],
            },
          },
        },
      });
    const instance = {
      isAuthorized: true,
      authorize: jest.fn(async () => undefined),
      unauthorize: jest.fn(async () => undefined),
      api: {music},
    };
    (window as Window & {MusicKit?: unknown}).MusicKit = {
      configure: jest.fn(async () => instance),
    };
    const client = await configureAppleMusicClient('developer-token');

    await expect(client.resolveCatalogSong('catalog-1')).resolves.toEqual({
      catalogId: 'catalog-1',
      artistName: 'Artist',
      title: 'Song',
      url: 'https://music.apple.com/us/song/song/1',
      previewUrl: 'https://audio-ssl.itunes.apple.com/a.m4a',
    });
    await expect(
      client.resolveCatalogSong('catalog-1'),
    ).resolves.not.toBeNull();
    await expect(
      client.searchCatalogSong({artistName: 'Artist', title: 'Song'}),
    ).resolves.toBeNull();
    await expect(
      client.searchCatalogSong({artistName: 'Artist', title: 'Song'}),
    ).resolves.toBeNull();
    expect(music).toHaveBeenCalledTimes(3);
  });

  it('classifies authorization, rate limit, and malformed pagination failures', () => {
    expect(classifyAppleMusicError({status: 401}).code).toBe('unauthorized');
    expect(classifyAppleMusicError({response: {status: 429}}).code).toBe(
      'rate_limited',
    );
    expect(new AppleMusicError('malformed_response').code).toBe(
      'malformed_response',
    );
  });
});
