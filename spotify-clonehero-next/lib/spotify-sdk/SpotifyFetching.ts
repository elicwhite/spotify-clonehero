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

type CacheAlbumTracks = {
  [albumId: string]: TrackResult[];
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

type CacheAlbumMetadata = {
  [albumId: string]: {
    id: string;
    name: string;
    externalUrl?: string;
    artistName?: string;
    addedAt: string;
    totalTracks?: number;
  };
};

export type TrackResult = {
  name: string;
  artists: string[];
  preview_url: string | null;
  spotify_url: string;
};

export type PlaylistProgressStatus = 'pending' | 'fetching' | 'done' | 'error';

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

export type SavedAlbumItem = {
  id: string;
  name: string;
  externalUrl?: string;
  artistName?: string;
  addedAt: string; // ISO string
  totalTracks?: number;
  fetched?: number;
  status?: PlaylistProgressStatus; // reuse statuses
};

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

async function getCachedAlbumTracks(): Promise<CacheAlbumTracks> {
  const cached = await get('albumTracks');
  return cached ?? {};
}

async function setCachedAlbumTracks(cachedAlbumTracks: CacheAlbumTracks) {
  await set('albumTracks', cachedAlbumTracks);
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

async function setCachedAlbumMetadata(cachedAlbumMetadata: CacheAlbumMetadata) {
  await set('albumMetadata', cachedAlbumMetadata);
}

async function getCachedAlbumMetadata(): Promise<CacheAlbumMetadata> {
  const meta = await get('albumMetadata');
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

async function getAllSavedAlbums(sdk: SpotifyApi) {
  const items: import('@spotify/web-api-ts-sdk').SavedAlbum[] = [];
  const limit = 50;
  let offset = 0;
  let total: number | null = null;
  do {
    // @ts-ignore sdk typing for currentUser saved albums
    const page = await sdk.currentUser.albums.savedAlbums(limit, offset);
    if (total == null) total = page.total;
    items.push(...page.items);
    offset += limit;
  } while (total == null || offset < total);

  return items;
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

async function getAllAlbumTracks(
  sdk: SpotifyApi,
  albumId: string,
): Promise<TrackResult[]> {
  const tracks: TrackResult[] = [];
  const limit = 50;
  let offset = 0;
  let total: number | null = null;
  do {
    try {
      // @ts-ignore albums.tracks not in typed surface
      const market = undefined;
      const page = await sdk.albums.tracks(albumId, market, limit, offset);
      if (total == null) total = page.total;
      const mapped: TrackResult[] = page.items.map((t: any) => ({
        name: t.name,
        artists: (t.artists || []).map((a: any) => a.name),
        preview_url: t.preview_url ?? null,
        spotify_url: t.external_urls.spotify,
      }));
      tracks.push(...mapped);
      offset += limit;
    } catch (error: any) {
      if (error instanceof RateLimitError) {
        const retry = Math.max(1, Math.ceil(error.retryAfter * 2));
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

  const item = track.tracks.items[0];

  const previewUrl = item.preview_url;
  const spotifyUrl = item.external_urls.spotify;
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
      const cachedAlbumTracks = await getCachedAlbumTracks();

      const uniqueSongs = [
        ...Object.values(cachedPlaylistTracks)
          .filter(playlistTracks => {
            if (playlistTracks?.length == null) {
              debugger;
            }
            return playlistTracks.length < MAX_PLAYLIST_TRACKS_TO_FETCH;
          })
          .flat(),
        ...Object.values(cachedAlbumTracks).flat(),
      ].reduce((acc, track) => {
        const key = `${track.name} - ${track.artists.join(', ')}`.toLowerCase();
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
          if (playlistTracks == null) {
            console.error('Trying to cache null playlist tracks', playlist.id);
            return [];
          }
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
  updateStatus: 'idle' | 'fetching' | 'complete';
  rateLimit: RateLimitState;
  prepare: () => Promise<void>;
  startUpdate: (options?: {
    concurrency?: number;
    forceRefresh?: boolean;
  }) => Promise<void>;
  cancel: () => void;
  albums: SavedAlbumItem[];
} {
  const [playlists, setPlaylists] = useState<PlaylistProgressItem[]>([]);
  const [updateStatus, setUpdateStatus] = useState<
    'idle' | 'fetching' | 'complete'
  >('idle');
  const [rateLimit, setRateLimit] = useState<RateLimitState>(null);
  const cancelledRef = useRef(false);
  const [currentUserDisplayName, setCurrentUserDisplayName] = useState<
    string | undefined
  >(undefined);
  const [albums, setAlbums] = useState<SavedAlbumItem[]>([]);

  const prepare = useCallback(async () => {
    const sdk = await getSpotifySdk();
    if (sdk == null) {
      return;
    }
    const lists = await getAllPlaylists(sdk);
    const savedAlbums = await getAllSavedAlbums(sdk);
    const names = lists.reduce((acc: CachePlaylistMetadata, p) => {
      const snapshot: string = p.snapshot_id;
      acc[snapshot] = {
        name: p.name,
        collaborative: p.collaborative,
        externalUrl: p.external_urls.spotify,
        owner: {
          displayName: p.owner.display_name,
          externalUrl: p.owner.external_urls.spotify,
        },
      };
      return acc;
    }, {} as CachePlaylistMetadata);
    await setCachedPlaylistMetadata(names);

    // Persist albums metadata
    const albumMeta = savedAlbums.reduce((acc: CacheAlbumMetadata, s) => {
      acc[s.album.id] = {
        id: s.album.id,
        name: s.album.name,
        externalUrl: s.album.external_urls.spotify,
        artistName: s.album.artists[0].name,
        addedAt: s.added_at,
        totalTracks: s.album.total_tracks,
      };
      return acc;
    }, {} as CacheAlbumMetadata);
    await setCachedAlbumMetadata(albumMeta);

    const me = await (async () => {
      try {
        const profile = await sdk.currentUser.profile();
        return profile.display_name;
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
          ? 'done'
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

    const cachedAlbums = await getCachedAlbumMetadata();
    const cachedAlbumTracks = await getCachedAlbumTracks();
    const albumsList: SavedAlbumItem[] = Object.values(cachedAlbums)
      .map(a => {
        const fetched = cachedAlbumTracks[a.id]?.length ?? 0;
        const total = a.totalTracks ?? 0;
        const status: PlaylistProgressStatus =
          total === 0
            ? 'done'
            : fetched >= total && total > 0
              ? 'done'
              : 'pending';
        return {
          id: a.id,
          name: a.name,
          externalUrl: a.externalUrl,
          artistName: a.artistName,
          addedAt: a.addedAt,
          totalTracks: total,
          fetched,
          status,
        };
      })
      .sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
    setAlbums(albumsList);
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
      setUpdateStatus('fetching');

      const cached = await getCachedPlaylistTracks();
      const cachedAlbum = await getCachedAlbumTracks();
      const foundSnapshots: string[] = [];

      const lists = await getAllPlaylists(sdk);
      const savedAlbums = await getAllSavedAlbums(sdk);

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
                        status: 'done',
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
                  ? {...pl, total, fetched: 0, status: 'done'}
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

      // Fetch saved album tracks
      await pMap(
        savedAlbums,
        async s => {
          if (cancelledRef.current) return;
          const albumId = s.album.id;
          const total = s.album.total_tracks ?? 0;
          if (cachedAlbum[albumId] && !forceRefresh) {
            setAlbums(prev =>
              prev.map(a =>
                a.id === albumId
                  ? {
                      ...a,
                      totalTracks: total,
                      fetched: cachedAlbum[albumId]?.length ?? 0,
                      status:
                        (cachedAlbum[albumId]?.length ?? 0) >= total &&
                        total > 0
                          ? 'done'
                          : 'pending',
                    }
                  : a,
              ),
            );
            return;
          }
          setAlbums(prev =>
            prev.map(a => (a.id === albumId ? {...a, status: 'fetching'} : a)),
          );
          try {
            const tracks = await getAllAlbumTracks(sdk, albumId);
            cachedAlbum[albumId] = tracks;
            await setCachedAlbumTracks(cachedAlbum);
            setAlbums(prev =>
              prev.map(a =>
                a.id === albumId
                  ? {
                      ...a,
                      fetched: tracks.length,
                      totalTracks: total,
                      status: 'done',
                    }
                  : a,
              ),
            );
          } catch (e) {
            console.error('Error fetching album tracks', albumId, e);
            setAlbums(prev =>
              prev.map(a => (a.id === albumId ? {...a, status: 'error'} : a)),
            );
          }
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
      setUpdateStatus('complete');
    },
    [],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  return {
    playlists,
    updateStatus,
    rateLimit,
    prepare,
    startUpdate,
    cancel,
    albums,
  };
}
