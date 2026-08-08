/** @jest-environment jsdom */

import {act, renderHook, waitFor} from '@testing-library/react';
import {useSpotifyLibraryUpdate} from '../SpotifyFetching';
import {SpotifyUnavailableError} from '../ClientInstance';

const mockGetSpotifySdk = jest.fn();
const mockGetKeyval = jest.fn();
const mockSetKeyval = jest.fn<Promise<void>, [string, unknown]>(
  async () => undefined,
);
const mockDeleteMissingAlbums = jest.fn<Promise<void>, [string[]]>(
  async () => undefined,
);
const mockDeleteMissingPlaylists = jest.fn<Promise<void>, [string[]]>(
  async () => undefined,
);
const mockGetPlaylistTracks = jest.fn(async () => ({}));
const mockUpsertAlbums = jest.fn<Promise<void>, [unknown[]]>(
  async () => undefined,
);
const mockUpsertPlaylists = jest.fn<Promise<void>, [unknown[]]>(
  async () => undefined,
);

jest.mock('../ClientInstance', () => ({
  RateLimitError: class RateLimitError extends Error {},
  SpotifyUnavailableError: class SpotifyUnavailableError extends Error {},
  getSpotifySdk: () => mockGetSpotifySdk(),
}));

jest.mock('idb-keyval', () => ({
  get: (key: string) => mockGetKeyval(key),
  set: (key: string, value: unknown) => mockSetKeyval(key, value),
}));

jest.mock('../../local-db/spotify', () => ({
  appendPlaylistTracks: jest.fn(async () => undefined),
  deleteMissingAlbums: (albumIds: string[]) =>
    mockDeleteMissingAlbums(albumIds),
  deleteMissingPlaylistsBySnapshot: (snapshotIds: string[]) =>
    mockDeleteMissingPlaylists(snapshotIds),
  getAlbumMetadataMap: jest.fn(async () => ({})),
  getAlbumTracksMap: jest.fn(async () => ({})),
  getPlaylistMetadataMapBySnapshot: jest.fn(async () => ({})),
  getPlaylistTracksBySnapshot: () => mockGetPlaylistTracks(),
  replaceAlbumTracks: jest.fn(async () => undefined),
  upsertAlbums: (albums: unknown[]) => mockUpsertAlbums(albums),
  upsertPlaylists: (playlists: unknown[]) => mockUpsertPlaylists(playlists),
}));

jest.mock('../../local-db/client', () => ({
  getLocalDb: jest.fn(async () => ({
    fn: {
      count: jest.fn(() => ({as: jest.fn(() => 'count')})),
    },
    selectFrom: jest.fn(() => ({
      select: jest.fn(() => ({
        executeTakeFirst: jest.fn(async () => ({count: 1})),
      })),
    })),
  })),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

function createSdk(
  playlistsPage: Promise<{
    total: number;
    items: Array<Record<string, unknown>>;
  }>,
) {
  return {
    currentUser: {
      playlists: {playlists: jest.fn(() => playlistsPage)},
      albums: {
        savedAlbums: jest.fn(async () => ({total: 0, items: []})),
      },
    },
    playlists: {getPlaylistItems: jest.fn()},
    albums: {tracks: jest.fn()},
  };
}

function mockCachedLibrary() {
  mockGetKeyval.mockImplementation(async key => {
    if (key === 'playlistMetadata') {
      return {
        'cached-snapshot': {
          id: 'cached-playlist',
          name: 'Cached playlist',
          externalUrl: 'https://open.spotify.com/playlist/cached',
          total: 1,
          owner: {displayName: 'Listener', externalUrl: ''},
          collaborative: false,
        },
      };
    }
    if (key === 'playlistTracks') {
      return {
        'cached-snapshot': [
          {id: 'cached-track', name: 'Cached track', artists: ['Artist']},
        ],
      };
    }
    return {};
  });
}

describe('useSpotifyLibraryUpdate async contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetKeyval.mockResolvedValue({});
  });

  it('returns live work immediately, emits progress, and can be awaited later', async () => {
    const playlistsPage = deferred<{
      total: number;
      items: Array<Record<string, unknown>>;
    }>();
    mockGetSpotifySdk.mockResolvedValue(createSdk(playlistsPage.promise));

    const {result} = renderHook(() => useSpotifyLibraryUpdate());
    await waitFor(() => expect(mockGetPlaylistTracks).toHaveBeenCalled());

    const events: string[] = [];
    let refreshPromise!: ReturnType<(typeof result.current)[1]>;
    act(() => {
      events.push('before-run');
      refreshPromise = result.current[1](new AbortController(), {
        concurrency: 2,
      });
      refreshPromise.then(() => events.push('refresh-complete'));
      events.push('caller-continued');
    });

    expect(refreshPromise).toBeInstanceOf(Promise);
    expect(events).toEqual(['before-run', 'caller-continued']);
    await waitFor(() =>
      expect(result.current[0].updateStatus).toBe('fetching'),
    );
    expect(events).not.toContain('refresh-complete');

    playlistsPage.resolve({
      total: 1,
      items: [
        {
          id: 'playlist-1',
          snapshot_id: 'snapshot-1',
          name: 'Road Trip',
          collaborative: false,
          external_urls: {spotify: 'https://open.spotify.com/playlist/1'},
          owner: {
            display_name: 'Listener',
            external_urls: {spotify: 'https://open.spotify.com/user/1'},
          },
          tracks: {total: 0},
        },
      ],
    });

    let library;
    await act(async () => {
      library = await refreshPromise;
    });

    expect(events).toEqual([
      'before-run',
      'caller-continued',
      'refresh-complete',
    ]);
    expect(result.current[0].updateStatus).toBe('complete');
    expect(library).toMatchObject({
      status: 'refreshed',
      library: {
        playlistMetadata: {
          'snapshot-1': {id: 'playlist-1', name: 'Road Trip'},
        },
        albumMetadata: {},
      },
    });
  });

  it('settles the returned promise when refresh setup fails', async () => {
    mockGetSpotifySdk.mockRejectedValue(new Error('token endpoint failed'));

    const {result} = renderHook(() => useSpotifyLibraryUpdate());
    await waitFor(() => expect(mockGetPlaylistTracks).toHaveBeenCalled());

    const refreshPromise = result.current[1](new AbortController(), {});

    await act(async () => {
      await expect(refreshPromise).rejects.toThrow('token endpoint failed');
    });
    expect(result.current[0].updateStatus).toBe('error');
  });

  it('does not persist or prune when authentication is missing', async () => {
    mockGetSpotifySdk.mockResolvedValue(null);
    mockCachedLibrary();

    const {result} = renderHook(() => useSpotifyLibraryUpdate());
    await waitFor(() =>
      expect(result.current[0].playlists['cached-snapshot']).toBeDefined(),
    );

    let refreshResult;
    await act(async () => {
      refreshResult = await result.current[1](new AbortController(), {});
    });

    expect(refreshResult).toEqual({status: 'unauthenticated'});
    expect(result.current[0].updateStatus).toBe('complete');
    expect(result.current[0].playlists['cached-snapshot']).toBeDefined();
    expect(mockUpsertPlaylists).not.toHaveBeenCalled();
    expect(mockUpsertAlbums).not.toHaveBeenCalled();
    expect(mockDeleteMissingPlaylists).not.toHaveBeenCalled();
    expect(mockDeleteMissingAlbums).not.toHaveBeenCalled();
  });

  it('preserves cached progress and storage when Spotify is unavailable', async () => {
    const playlistsPage = deferred<{
      total: number;
      items: Array<Record<string, unknown>>;
    }>();
    mockGetSpotifySdk.mockResolvedValue(createSdk(playlistsPage.promise));
    mockCachedLibrary();

    const {result} = renderHook(() => useSpotifyLibraryUpdate());
    await waitFor(() =>
      expect(result.current[0].playlists['cached-snapshot']).toBeDefined(),
    );

    let refreshPromise!: ReturnType<(typeof result.current)[1]>;
    act(() => {
      refreshPromise = result.current[1](new AbortController(), {});
    });
    await waitFor(() =>
      expect(result.current[0].updateStatus).toBe('fetching'),
    );

    let refreshResult;
    await act(async () => {
      playlistsPage.reject(new SpotifyUnavailableError());
      refreshResult = await refreshPromise;
    });

    expect(refreshResult).toEqual({status: 'unavailable'});
    expect(result.current[0].updateStatus).toBe('complete');
    expect(result.current[0].playlists['cached-snapshot']).toBeDefined();
    expect(mockSetKeyval).not.toHaveBeenCalled();
    expect(mockUpsertPlaylists).not.toHaveBeenCalled();
    expect(mockUpsertAlbums).not.toHaveBeenCalled();
    expect(mockDeleteMissingPlaylists).not.toHaveBeenCalled();
    expect(mockDeleteMissingAlbums).not.toHaveBeenCalled();
  });

  it('does not prune caches when Spotify becomes unavailable during track loading', async () => {
    const sdk = createSdk(
      Promise.resolve({
        total: 1,
        items: [
          {
            id: 'playlist-1',
            snapshot_id: 'snapshot-1',
            name: 'Road Trip',
            collaborative: false,
            external_urls: {spotify: 'https://open.spotify.com/playlist/1'},
            owner: {
              display_name: 'Listener',
              external_urls: {spotify: 'https://open.spotify.com/user/1'},
            },
            tracks: {total: 1},
          },
        ],
      }),
    );
    sdk.playlists.getPlaylistItems.mockRejectedValue(
      new SpotifyUnavailableError(),
    );
    mockGetSpotifySdk.mockResolvedValue(sdk);
    mockCachedLibrary();

    const {result} = renderHook(() => useSpotifyLibraryUpdate());
    await waitFor(() =>
      expect(result.current[0].playlists['cached-snapshot']).toBeDefined(),
    );

    let refreshResult;
    await act(async () => {
      refreshResult = await result.current[1](new AbortController(), {});
    });

    expect(refreshResult).toEqual({status: 'unavailable'});
    expect(mockDeleteMissingPlaylists).not.toHaveBeenCalled();
    expect(mockDeleteMissingAlbums).not.toHaveBeenCalled();

    const playlistTrackWrites = mockSetKeyval.mock.calls.filter(
      ([key]) => key === 'playlistTracks',
    );
    expect(playlistTrackWrites.length).toBeGreaterThan(0);
    for (const [, cache] of playlistTrackWrites) {
      expect(cache).toHaveProperty('cached-snapshot');
    }
  });
});
