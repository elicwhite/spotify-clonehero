/** @jest-environment jsdom */

import {act, renderHook, waitFor} from '@testing-library/react';
import {useSpotifyLibraryUpdate} from '../SpotifyFetching';

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

jest.mock('../ClientInstance', () => ({
  RateLimitError: class RateLimitError extends Error {},
  getSpotifySdk: () => mockGetSpotifySdk(),
  withSpotifyAvailabilityFallback: async <T,>(request: () => Promise<T>) =>
    request(),
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
  upsertAlbums: jest.fn(async () => undefined),
  upsertPlaylists: jest.fn(async () => undefined),
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
      playlistMetadata: {
        'snapshot-1': {id: 'playlist-1', name: 'Road Trip'},
      },
      albumMetadata: {},
    });
  });

  it('settles the returned promise when refresh setup fails', async () => {
    mockGetSpotifySdk.mockRejectedValue(new Error('token endpoint failed'));

    const {result} = renderHook(() => useSpotifyLibraryUpdate());
    await waitFor(() => expect(mockGetPlaylistTracks).toHaveBeenCalled());

    const refreshPromise = result.current[1](new AbortController(), {});

    await expect(refreshPromise).rejects.toThrow('token endpoint failed');
  });
});
