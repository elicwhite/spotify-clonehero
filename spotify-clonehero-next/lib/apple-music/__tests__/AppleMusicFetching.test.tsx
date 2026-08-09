/** @jest-environment jsdom */

import {act, renderHook} from '@testing-library/react';

jest.mock('../../local-db/client', () => ({getLocalDb: jest.fn()}));
jest.mock('../../local-db/apple-music', () => ({
  activateAppleMusicScan: jest.fn(),
  beginAppleMusicScan: jest.fn(),
  clearAppleMusicLibrary: jest.fn(),
  discardAppleMusicScan: jest.fn(),
  stageAppleMusicTracks: jest.fn(),
}));

import {AppleMusicError, type AppleMusicLibraryClient} from '..';
import {
  useAppleMusicLibraryUpdate,
  type AppleMusicFetchingDependencies,
} from '../AppleMusicFetching';

const client = (authorized = true): AppleMusicLibraryClient => ({
  isAuthorized: () => authorized,
  authorize: jest.fn(),
  unauthorize: jest.fn(),
  fetchLibrarySongs: jest.fn(async () => ({
    storefront: 'us',
    total: 2,
    fetchedCount: 2,
    usableCount: 1,
    catalogAssociatedCount: 1,
    pagesFetched: 1,
    songs: [{artistName: 'Artist', title: 'Song', catalogId: 'catalog'}],
  })),
  resolveCatalogSong: jest.fn(),
  searchCatalogSong: jest.fn(),
});

function dependencies(configured = client()): AppleMusicFetchingDependencies {
  return {
    activateAppleMusicScan: jest.fn(),
    beginAppleMusicScan: jest.fn(async () => ({
      connectionEpoch: 0,
      scanGeneration: 1,
    })),
    clearAppleMusicLibrary: jest.fn(),
    configureAppleMusicClient: jest.fn(async () => configured),
    discardAppleMusicScan: jest.fn(),
    getLocalDb: jest.fn(async () => ({db: true}) as never),
    loadMusicKitScript: jest.fn(async () => undefined),
    stageAppleMusicTracks: jest.fn(async () => 1),
  };
}

beforeEach(() => {
  global.fetch = jest.fn(
    async () =>
      ({
        ok: true,
        json: async () => ({
          developerToken: 'developer-token',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      }) as Response,
  );
});

describe('useAppleMusicLibraryUpdate', () => {
  it('configures MusicKit through the developer-token endpoint', async () => {
    const deps = dependencies();
    const {result} = renderHook(() => useAppleMusicLibraryUpdate(deps));

    await act(async () => {
      await result.current.setup();
    });

    expect(deps.loadMusicKitScript).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/apple-music/developer-token',
      {
        cache: 'no-store',
      },
    );
    expect(deps.configureAppleMusicClient).toHaveBeenCalledWith(
      'developer-token',
    );
    expect(result.current.setupState).toBe('authorized');
    expect(result.current.client).not.toBeNull();
  });

  it('stages and atomically activates a successful scan', async () => {
    const deps = dependencies();
    const {result} = renderHook(() => useAppleMusicLibraryUpdate(deps));
    await act(async () => void (await result.current.setup()));

    let refreshResult;
    await act(async () => {
      refreshResult = await result.current.refresh(new AbortController());
    });

    expect(refreshResult).toEqual({status: 'success'});
    expect(deps.beginAppleMusicScan).toHaveBeenCalledTimes(1);
    expect(deps.stageAppleMusicTracks).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      [{artist: 'Artist', name: 'Song', catalogId: 'catalog'}],
    );
    expect(deps.activateAppleMusicScan).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        storefront: 'us',
        reportedTotal: 2,
        fetchedCount: 2,
        usableCount: 1,
        catalogAssociatedCount: 1,
        scanToken: {connectionEpoch: 0, scanGeneration: 1},
      }),
    );
  });

  it('renews a developer token inside the server renewal skew before refresh', async () => {
    const deps = dependencies();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          developerToken: 'near-expiry',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          developerToken: 'renewed',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      });
    const {result} = renderHook(() => useAppleMusicLibraryUpdate(deps));
    await act(async () => void (await result.current.setup()));
    await act(
      async () => void (await result.current.refresh(new AbortController())),
    );

    expect(deps.configureAppleMusicClient).toHaveBeenNthCalledWith(
      2,
      'renewed',
    );
  });

  it('reconfigures once and retries a complete scan after an unauthorized failure', async () => {
    const first = client();
    (first.fetchLibrarySongs as jest.Mock).mockRejectedValue(
      new AppleMusicError('unauthorized'),
    );
    const second = client();
    const deps = dependencies(first);
    (deps.configureAppleMusicClient as jest.Mock)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const {result} = renderHook(() => useAppleMusicLibraryUpdate(deps));
    await act(async () => void (await result.current.setup()));

    await act(async () =>
      expect(result.current.refresh(new AbortController())).resolves.toEqual({
        status: 'success',
      }),
    );
    expect(deps.beginAppleMusicScan).toHaveBeenCalledTimes(2);
    expect(deps.discardAppleMusicScan).toHaveBeenCalledTimes(1);
    expect(deps.configureAppleMusicClient).toHaveBeenCalledTimes(2);
  });

  it('discards staging on cancellation without clearing the previous scan', async () => {
    const configured = client();
    (configured.fetchLibrarySongs as jest.Mock).mockRejectedValue(
      new AppleMusicError('aborted'),
    );
    const deps = dependencies(configured);
    const {result} = renderHook(() => useAppleMusicLibraryUpdate(deps));
    await act(async () => void (await result.current.setup()));

    await act(async () => {
      await expect(
        result.current.refresh(new AbortController()),
      ).resolves.toEqual({
        status: 'aborted',
      });
    });

    expect(deps.discardAppleMusicScan).toHaveBeenCalledTimes(1);
    expect(deps.clearAppleMusicLibrary).not.toHaveBeenCalled();
    expect(deps.activateAppleMusicScan).not.toHaveBeenCalled();
  });

  it('returns a safe actionable diagnostic for local database failures', async () => {
    const deps = dependencies();
    (deps.beginAppleMusicScan as jest.Mock).mockRejectedValue(
      new Error('NOT NULL failed for private song metadata'),
    );
    const {result} = renderHook(() => useAppleMusicLibraryUpdate(deps));
    await act(async () => void (await result.current.setup()));

    await act(async () => {
      await expect(
        result.current.refresh(new AbortController()),
      ).resolves.toEqual({
        status: 'error',
        errorCode: 'local_database:unknown',
        message:
          'Apple Music could not update its local library index. Reload this page and try again. (local_database:unknown)',
      });
    });
    expect(deps.discardAppleMusicScan).toHaveBeenCalledTimes(1);
  });

  it('maps unauthorized setup without starting a scan', async () => {
    const deps = dependencies(client(false));
    const {result} = renderHook(() => useAppleMusicLibraryUpdate(deps));

    await act(async () => {
      await expect(
        result.current.refresh(new AbortController()),
      ).resolves.toEqual({
        status: 'unauthorized',
      });
    });

    expect(result.current.setupState).toBe('unauthorized');
    expect(deps.beginAppleMusicScan).not.toHaveBeenCalled();
  });

  it('unauthorizes and clears local Apple state on disconnect', async () => {
    const configured = client();
    const deps = dependencies(configured);
    const {result} = renderHook(() => useAppleMusicLibraryUpdate(deps));
    await act(async () => void (await result.current.setup()));

    await act(async () => void (await result.current.disconnect()));

    expect(configured.unauthorize).toHaveBeenCalledTimes(1);
    expect(deps.clearAppleMusicLibrary).toHaveBeenCalledWith(expect.anything());
    expect(result.current.setupState).toBe('unauthorized');
    expect(result.current.client).toBeNull();
  });

  it('does not republish a client when disconnect wins a pending setup race', async () => {
    const configured = client();
    let resolveClient!: (value: AppleMusicLibraryClient) => void;
    const deps = dependencies();
    (deps.configureAppleMusicClient as jest.Mock).mockReturnValue(
      new Promise<AppleMusicLibraryClient>(resolve => {
        resolveClient = resolve;
      }),
    );
    const {result} = renderHook(() => useAppleMusicLibraryUpdate(deps));
    let pending!: Promise<AppleMusicLibraryClient | null>;
    act(() => {
      pending = result.current.setup();
    });
    await act(async () => void (await result.current.disconnect()));
    await act(async () => resolveClient(configured));
    await act(async () => expect(pending).resolves.toBeNull());

    expect(configured.unauthorize).toHaveBeenCalledTimes(1);
    expect(result.current.client).toBeNull();
  });
});
