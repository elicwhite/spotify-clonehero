import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {RateLimitError, getSpotifySdk} from './ClientInstance';
import {
  PlaylistedTrack,
  SimplifiedPlaylist,
  SpotifyApi,
  Track,
} from '@spotify/web-api-ts-sdk';
import pMap from 'p-map';
import {get, set} from 'idb-keyval';

// Configurable threshold for maximum playlist size to fetch in detail
export const MAX_PLAYLIST_TRACKS_TO_FETCH = 5000;

type CachePlaylistTracks = {
  [snapshotId: string]: TrackResult[];
};

type CachePlaylistMetadata = {
  [snapshotId: string]: {
    name: string;
    collaborative: boolean;
    externalUrl?: string;
    owner?: {
      displayName?: string;
      externalUrl?: string;
    };
  };
};

export type TrackResult = {
  name: string;
  artists: string[];
  preview_url: string | null;
  spotify_url: string;
};

export type PlaylistProgressStatus =
  | 'pending'
  | 'fetching'
  | 'done'
  | 'error'
  | 'skipped';

export type PlaylistProgressItem = {
  id: string;
  name: string;
  snapshotId: string;
  total: number;
  fetched: number;
  status: PlaylistProgressStatus;
  lastError?: string;
  ownerDisplayName?: string;
  collaborative?: boolean;
};

export type RateLimitState = {retryAfterSeconds: number} | null;

const cacheUpdateListeners: Set<() => void> = new Set();

export function onPlaylistCacheUpdated(listener: () => void): () => void {
  cacheUpdateListeners.add(listener);
  return () => {
    cacheUpdateListeners.delete(listener);
  };
}

function emitPlaylistCacheUpdated() {
  cacheUpdateListeners.forEach(listener => {
    try {
      listener();
    } catch (e) {
      // ignore listener errors
    }
  });
}

async function getCachedPlaylistTracks(): Promise<CachePlaylistTracks> {
  const cachedPlaylistTracks = await get('playlistTracks');
  return cachedPlaylistTracks ?? {};
}

async function setCachedPlaylistTracks(
  cachedPlaylistTracks: CachePlaylistTracks,
) {
  await set('playlistTracks', cachedPlaylistTracks);
  emitPlaylistCacheUpdated();
}

async function setCachedPlaylistMetadata(
  cachedPlaylistMetadata: CachePlaylistMetadata,
) {
  await set('playlistMetadata', cachedPlaylistMetadata);
}

async function getCachedPlaylistMetadata(): Promise<CachePlaylistMetadata> {
  const meta = await get('playlistMetadata');
  return meta ?? {};
}

export async function getAllPlaylists(
  sdk: SpotifyApi,
): Promise<SimplifiedPlaylist[]> {
  const playlists: SimplifiedPlaylist[] = [];
  const limit = 50;
  let offset = 0;
  let total = null;
  do {
    const lists = await sdk.currentUser.playlists.playlists(limit, offset);
    if (total == null) {
      total = lists.total;
    }
    playlists.push(...lists.items);
    offset += limit;
  } while (total == null || offset < total);

  return playlists;
}

async function getAllPlaylistTracksWithProgress(
  sdk: SpotifyApi,
  playlistId: string,
  onPage: (
    pageTracks: TrackResult[],
    pageIndex: number,
  ) => Promise<void> | void,
  onRateLimit?: (retryAfterSeconds: number) => void,
  isCancelled?: () => boolean,
  startingOffset: number = 0,
): Promise<TrackResult[]> {
  const tracks: TrackResult[] = [];
  const limit = 50;
  let offset = startingOffset;
  let total: number | null = null;
  let pageIndex = Math.floor(startingOffset / limit);

  do {
    if (isCancelled?.()) {
      break;
    }
    try {
      const items = await sdk.playlists.getPlaylistItems(
        playlistId,
        undefined,
        'total,limit,items(track(type,artists(type,name),name,preview_url, external_urls(spotify)))',
        limit,
        offset,
      );
      if (total == null) {
        total = items.total;
      }
      const filteredTracks = items.items
        .filter(item => item.track?.type === 'track')
        .map((item: PlaylistedTrack): TrackResult => {
          return {
            name: item.track.name,
            artists: (item.track as Track).artists.map(artist => artist.name),
            preview_url: (item.track as Track).preview_url,
            spotify_url: (item.track as Track).external_urls.spotify,
          };
        });
      tracks.push(...filteredTracks);
      await onPage(filteredTracks, pageIndex++);
      offset += limit;
    } catch (error: any) {
      if (error instanceof RateLimitError) {
        const retry = Math.max(1, Math.ceil(error.retryAfter * 2));
        onRateLimit?.(retry);
        await new Promise(resolve => setTimeout(resolve, retry * 1000));
        continue;
      }
      throw error;
    }
  } while (total == null || offset < total);

  return tracks;
}

async function getAllPlaylistTracks(
  sdk: SpotifyApi,
  playlistId: string,
): Promise<TrackResult[]> {
  const tracks: TrackResult[] = [];
  const limit = 50;
  let offset = 0;
  let total = null;

  do {
    try {
      const items = await sdk.playlists.getPlaylistItems(
        playlistId,
        undefined,
        'total,limit,items(track(type,artists(type,name),name,preview_url, external_urls(spotify)))',
        limit,
        offset,
      );

      if (total == null) {
        total = items.total;
      }
      const filteredTracks = items.items
        .filter(item => item.track?.type === 'track')
        .map((item: PlaylistedTrack): TrackResult => {
          return {
            name: item.track.name,
            artists: (item.track as Track).artists.map(artist => artist.name),
            preview_url: (item.track as Track).preview_url,
            spotify_url: (item.track as Track).external_urls.spotify,
          };
        });

      tracks.push(...filteredTracks);
      offset += limit;
    } catch (error: any) {
      if (error instanceof RateLimitError) {
        console.log(
          `Rate limited. Retrying after ${error.retryAfter * 2} seconds...`,
        );
        await new Promise(resolve =>
          setTimeout(resolve, error.retryAfter * 1000 * 2),
        );
        continue;
      }
      throw error;
    }
  } while (total == null || offset < total);

  return tracks;
}

async function getTrackUrls(
  sdk: SpotifyApi,
  artist: string,
  song: string,
): Promise<null | {
  previewUrl: string | null;
  spotifyUrl: string;
}> {
  const track = await sdk.search(
    `track:${song} artist:${artist}`,
    ['track'],
    undefined, // market
    1, // limit
  );

  const item = track?.tracks?.items?.[0];

  const previewUrl = item?.preview_url;
  const spotifyUrl = item?.external_urls.spotify;
  return {
    previewUrl,
    spotifyUrl,
  };
}

export function useTrackUrls(
  artist: string,
  song: string,
): () => Promise<null | {
  previewUrl: string | null;
  spotifyUrl: string;
}> {
  const getPreviewUrl = useCallback(async () => {
    const sdk = await getSpotifySdk();

    if (sdk == null) {
      return null;
    }

    return await getTrackUrls(sdk, artist, song);
  }, [artist, song]);

  return getPreviewUrl;
}

export function useSpotifyTracks(): [
  tracks: TrackResult[],
  updateFromSpotify: () => Promise<void>,
] {
  const [forceUpdate, setForceUpdate] = useState(0);
  const [allTracks, setAllTracks] = useState<TrackResult[]>([]);

  useEffect(() => {
    // use this variable to satisfy eslint
    forceUpdate;

    async function calculate() {
      const sdk = await getSpotifySdk();

      if (sdk == null) {
        return;
      }

      const cachedPlaylistTracks = await getCachedPlaylistTracks();

      const uniqueSongs = Object.values(cachedPlaylistTracks)
        .filter(playlistTracks => playlistTracks.length < 1000)
        .flat()
        .reduce((acc, track) => {
          const key = `${track.name} - ${track.artists.join(
            ', ',
          )}`.toLowerCase();
          if (!acc.has(key)) {
            acc.set(key, track);
          }
          return acc;
        }, new Map<string, TrackResult>());

      const tracks = Array.from(uniqueSongs.values());
      setAllTracks(tracks);
    }
    calculate();
    const unsubscribe = onPlaylistCacheUpdated(() => {
      setForceUpdate(n => n + 1);
    });
    return () => {
      unsubscribe();
    };
  }, [forceUpdate]);

  const update = useCallback(async () => {
    const sdk = await getSpotifySdk();

    if (sdk == null) {
      return;
    }

    const playlists = await getAllPlaylists(sdk);
    const playlistNames = playlists.reduce(
      (acc: CachePlaylistMetadata, playlist) => {
        const snapshot: string = playlist.snapshot_id;
        acc[snapshot] = {
          name: playlist.name,
          collaborative: playlist.collaborative,
          externalUrl: playlist.external_urls.spotify,
          owner: {
            displayName: playlist.owner.display_name,
            externalUrl: playlist.owner.external_urls.spotify,
          },
        };
        return acc;
      },
      {},
    );

    await setCachedPlaylistMetadata(playlistNames);

    const cachedPlaylistTracks = await getCachedPlaylistTracks();
    const cachedSnapshots = Object.keys(cachedPlaylistTracks);
    const foundSnapshots: string[] = [];

    await pMap(
      playlists,
      async playlist => {
        if (cachedSnapshots.includes(playlist.snapshot_id)) {
          foundSnapshots.push(playlist.snapshot_id);
          return cachedPlaylistTracks[playlist.snapshot_id];
        }

        try {
          const playlistTracks = await getAllPlaylistTracks(sdk, playlist.id);
          cachedPlaylistTracks[playlist.snapshot_id] = playlistTracks;
          foundSnapshots.push(playlist.snapshot_id);
          await setCachedPlaylistTracks(cachedPlaylistTracks);
          return playlistTracks;
        } catch (error: any) {
          console.error(
            'Unexpected error fetching tracks for playlist',
            playlist.id,
            'with snapshot',
            playlist.snapshot_id,
            error,
          );
          return [];
        }
      },
      {concurrency: 10},
    );

    const newCache = foundSnapshots.reduce(
      (acc: {[snapshotId: string]: TrackResult[]}, snapshot: string) => {
        acc[snapshot] = cachedPlaylistTracks[snapshot];
        return acc;
      },
      {},
    );
    await setCachedPlaylistTracks(newCache);
    setForceUpdate(n => n + 1);
  }, []);

  return [allTracks, update];
}

export function useSpotifyLibraryUpdate(): {
  playlists: PlaylistProgressItem[];
  isUpdating: boolean;
  rateLimit: RateLimitState;
  prepare: () => Promise<void>;
  startUpdate: (options?: {
    concurrency?: number;
    forceRefresh?: boolean;
  }) => Promise<void>;
  cancel: () => void;
} {
  const [playlists, setPlaylists] = useState<PlaylistProgressItem[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);
  const [rateLimit, setRateLimit] = useState<RateLimitState>(null);
  const cancelledRef = useRef(false);
  const [currentUserDisplayName, setCurrentUserDisplayName] = useState<
    string | undefined
  >(undefined);

  const prepare = useCallback(async () => {
    const sdk = await getSpotifySdk();
    if (sdk == null) {
      return;
    }
    const lists = await getAllPlaylists(sdk);
    const names = lists.reduce((acc: CachePlaylistMetadata, p) => {
      const snapshot: string = p.snapshot_id;
      acc[snapshot] = {
        name: p.name,
        collaborative: p?.collaborative,
        externalUrl: p?.external_urls?.spotify,
        owner: {
          displayName: p?.owner?.display_name,
          externalUrl: p?.owner?.external_urls?.spotify,
        },
      };
      return acc;
    }, {} as CachePlaylistMetadata);
    await setCachedPlaylistMetadata(names);

    const me = await (async () => {
      try {
        const profile = await sdk.currentUser.profile();
        return profile?.display_name as string | undefined;
      } catch {
        return undefined;
      }
    })();
    setCurrentUserDisplayName(me);

    const cached = await getCachedPlaylistTracks();
    const cachedMeta = await getCachedPlaylistMetadata();
    const initial: PlaylistProgressItem[] = lists.map(p => {
      const total = p?.tracks?.total ?? 0;
      const fetched = cached[p.snapshot_id]?.length ?? 0;
      const status: PlaylistProgressStatus =
        total > MAX_PLAYLIST_TRACKS_TO_FETCH
          ? 'skipped'
          : total === 0
            ? 'done'
            : fetched >= total
              ? 'done'
              : 'pending';
      const meta = cachedMeta[p.snapshot_id];
      return {
        id: p.id,
        name: p.name,
        snapshotId: p.snapshot_id,
        total,
        fetched,
        status,
        collaborative: meta?.collaborative ?? p?.collaborative,
        ownerDisplayName: meta?.owner?.displayName ?? p?.owner?.display_name,
      };
    });
    setPlaylists(initial);
  }, []);

  const startUpdate = useCallback(
    async (options?: {concurrency?: number; forceRefresh?: boolean}) => {
      const concurrency = options?.concurrency ?? 2;
      const forceRefresh = options?.forceRefresh ?? false;
      cancelledRef.current = false;
      const sdk = await getSpotifySdk();
      if (sdk == null) {
        return;
      }
      setIsUpdating(true);

      const cached = await getCachedPlaylistTracks();
      const foundSnapshots: string[] = [];

      const lists = await getAllPlaylists(sdk);

      console.log(
        '[Spotify] Integrity check starting for',
        lists.length,
        'playlists',
      );
      const integrity = {total: lists.length, complete: 0, resume: 0, fresh: 0};

      await pMap(
        lists,
        async p => {
          if (cancelledRef.current) return;
          const snapshot = p.snapshot_id;
          foundSnapshots.push(snapshot);
          const alreadyCached = cached[snapshot];
          const total = p?.tracks?.total ?? 0;
          const cachedLen = alreadyCached?.length ?? 0;

          // Integrity check & control flow
          if (alreadyCached && !forceRefresh) {
            if (total > MAX_PLAYLIST_TRACKS_TO_FETCH) {
              // Skip long playlists
              setPlaylists(prev =>
                prev.map(pl =>
                  pl.snapshotId === snapshot
                    ? {
                        ...pl,
                        total,
                        fetched: 0,
                        status: 'skipped',
                      }
                    : pl,
                ),
              );
              integrity.complete += 1;
              return;
            }
            if (total === 0) {
              // Nothing to fetch; mark complete immediately
              setPlaylists(prev =>
                prev.map(pl =>
                  pl.snapshotId === snapshot
                    ? {
                        ...pl,
                        total: 0,
                        fetched: 0,
                        status: 'done',
                      }
                    : pl,
                ),
              );
              integrity.complete += 1;
              return;
            }
            if (total > 0 && cachedLen >= total) {
              // Cache is complete: mark done and skip
              setPlaylists(prev =>
                prev.map(pl =>
                  pl.snapshotId === snapshot
                    ? {
                        ...pl,
                        total,
                        fetched: cachedLen,
                        status: 'done',
                      }
                    : pl,
                ),
              );
              integrity.complete += 1;
              return;
            }

            // Cache incomplete or total unknown: resume fetching from current length
            setPlaylists(prev =>
              prev.map(pl =>
                pl.snapshotId === snapshot
                  ? {
                      ...pl,
                      total,
                      fetched: cachedLen,
                      status: 'fetching',
                    }
                  : pl,
              ),
            );

            if (total > 0 && cachedLen !== total) {
              console.log(
                '[Spotify] Playlist cache incomplete:',
                p.name,
                `${cachedLen}/${total}`,
              );
            }

            try {
              await getAllPlaylistTracksWithProgress(
                sdk,
                p.id,
                async (pageTracks, _pageIndex) => {
                  if (cancelledRef.current) return;
                  const current = cached[snapshot] ?? [];
                  cached[snapshot] = current.concat(pageTracks);
                  await setCachedPlaylistTracks(cached);
                  const fetched = cached[snapshot].length;
                  setPlaylists(prev =>
                    prev.map(pl =>
                      pl.snapshotId === snapshot ? {...pl, fetched} : pl,
                    ),
                  );
                },
                retryAfterSeconds => setRateLimit({retryAfterSeconds}),
                () => cancelledRef.current,
                cachedLen,
              );
              const finalFetched = cached[snapshot]?.length ?? cachedLen;
              setPlaylists(prev =>
                prev.map(pl =>
                  pl.snapshotId === snapshot
                    ? {
                        ...pl,
                        status: 'done',
                        fetched: finalFetched,
                        total: finalFetched,
                      }
                    : pl,
                ),
              );
              setRateLimit(null);
            } catch (e: any) {
              console.error('Error resuming playlist', p.id, e);
              setPlaylists(prev =>
                prev.map(pl =>
                  pl.snapshotId === snapshot
                    ? {
                        ...pl,
                        status: 'error',
                        lastError: String(e?.message ?? e),
                      }
                    : pl,
                ),
              );
            }
            integrity.resume += 1;
            return;
          }

          // Fresh fetch (no cache or forceRefresh)
          setPlaylists(prev =>
            prev.map(pl =>
              pl.snapshotId === snapshot ? {...pl, status: 'fetching'} : pl,
            ),
          );

          if (total > MAX_PLAYLIST_TRACKS_TO_FETCH) {
            setPlaylists(prev =>
              prev.map(pl =>
                pl.snapshotId === snapshot
                  ? {...pl, total, fetched: 0, status: 'skipped'}
                  : pl,
              ),
            );
            integrity.complete += 1;
            return;
          }

          if (total === 0) {
            // Nothing to fetch
            setPlaylists(prev =>
              prev.map(pl =>
                pl.snapshotId === snapshot
                  ? {...pl, total: 0, fetched: 0, status: 'done'}
                  : pl,
              ),
            );
            integrity.complete += 1;
            return;
          }

          if (forceRefresh || !alreadyCached) {
            cached[snapshot] = [];
            await setCachedPlaylistTracks(cached);
          }

          try {
            await getAllPlaylistTracksWithProgress(
              sdk,
              p.id,
              async (pageTracks, _pageIndex) => {
                if (cancelledRef.current) return;
                const current = cached[snapshot] ?? [];
                cached[snapshot] = current.concat(pageTracks);
                await setCachedPlaylistTracks(cached);
                const fetched = cached[snapshot].length;
                setPlaylists(prev =>
                  prev.map(pl =>
                    pl.snapshotId === snapshot ? {...pl, fetched} : pl,
                  ),
                );
              },
              retryAfterSeconds => setRateLimit({retryAfterSeconds}),
              () => cancelledRef.current,
              0,
            );
            const finalFetched = cached[snapshot]?.length ?? 0;
            setPlaylists(prev =>
              prev.map(pl =>
                pl.snapshotId === snapshot
                  ? {
                      ...pl,
                      status: 'done',
                      fetched: finalFetched,
                      total: finalFetched,
                    }
                  : pl,
              ),
            );
            setRateLimit(null);
          } catch (e: any) {
            console.error('Error fetching playlist', p.id, e);
            setPlaylists(prev =>
              prev.map(pl =>
                pl.snapshotId === snapshot
                  ? {...pl, status: 'error', lastError: String(e?.message ?? e)}
                  : pl,
              ),
            );
          }
          integrity.fresh += 1;
        },
        {concurrency},
      );

      console.log(
        '[Spotify] Integrity check result:',
        `total=${integrity.total}`,
        `complete=${integrity.complete}`,
        `resume=${integrity.resume}`,
        `fresh=${integrity.fresh}`,
      );

      // Compact cache to only include found snapshots
      const newCache = foundSnapshots.reduce(
        (acc: {[snapshotId: string]: TrackResult[]}, snapshot: string) => {
          acc[snapshot] = cached[snapshot];
          return acc;
        },
        {},
      );
      await setCachedPlaylistTracks(newCache);
      setIsUpdating(false);
    },
    [],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  return {playlists, isUpdating, rateLimit, prepare, startUpdate, cancel};
}
