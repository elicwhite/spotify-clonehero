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
    id: string;
    name: string;
    collaborative: boolean;
    externalUrl: string;
    owner: {
      displayName: string;
      externalUrl: string;
    };
    total: number;
  };
};

type CacheAlbumMetadata = {
  [albumId: string]: {
    id: string;
    name: string;
    externalUrl: string;
    artistName: string;
    addedAt: string;
    totalTracks: number;
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
  status?: PlaylistProgressStatus;
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
  abortSignal: AbortController,
  onRateLimit?: (retryAfterSeconds: number) => void,
  startingOffset: number = 0,
): Promise<TrackResult[]> {
  const tracks: TrackResult[] = [];
  const limit = 50;
  let offset = startingOffset;
  let total: number | null = null;
  let pageIndex = Math.floor(startingOffset / limit);

  do {
    if (abortSignal.signal.aborted) {
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

export type SpotifyLibraryUpdateProgress = {
  playlists: PlaylistProgressItem[];
  albums: SavedAlbumItem[];
  rateLimitCountdown?: RateLimitState;
  updateStatus?: 'idle' | 'fetching' | 'complete' | 'error';
};

export function useSpotifyLibraryUpdate(): [
  progress: SpotifyLibraryUpdateProgress,
  run: (
    abort: AbortController,
    options: {concurrency?: number},
  ) => Promise<TrackResult[]>,
] {
  const [progress, setProgress] = useState<SpotifyLibraryUpdateProgress>({
    playlists: [],
    albums: [],
    rateLimitCountdown: null,
    updateStatus: 'idle',
  });

  useEffect(() => {
    async function loadFromCache() {
      const cachedPlaylistTracks = await getCachedPlaylistTracks();
      const cachedPlaylistMetadata = await getCachedPlaylistMetadata();

      const cachedAlbumTracks = await getCachedAlbumTracks();
      const cachedAlbumMetadata = await getCachedAlbumMetadata();

      const initialPlaylistProgress: PlaylistProgressItem[] = Object.entries(
        cachedPlaylistMetadata,
      ).map(([snapshotId, playlistMetadata]) => {
        const tracks = cachedPlaylistTracks[snapshotId] || [];

        const total = playlistMetadata.total ?? 0;
        const fetched = tracks.length ?? 0;

        const status: PlaylistProgressStatus =
          total > MAX_PLAYLIST_TRACKS_TO_FETCH
            ? 'done'
            : total === 0
              ? 'done'
              : fetched >= total
                ? 'done'
                : 'pending';

        return {
          id: playlistMetadata.id ?? snapshotId,
          snapshotId: snapshotId,
          name: playlistMetadata.name,
          total,
          fetched,
          status,
          collaborative: playlistMetadata.collaborative,
          ownerDisplayName: playlistMetadata.owner?.displayName,
        };
      });

      const initialAlbumProgress: SavedAlbumItem[] = Object.entries(
        cachedAlbumMetadata,
      )
        .map(([albumId, albumMetadata]) => {
          const tracks = cachedAlbumTracks[albumId] || [];
          const total = albumMetadata.totalTracks ?? 0;
          const fetched = tracks.length ?? 0;
          const status: PlaylistProgressStatus =
            total === 0 ? 'done' : fetched >= total ? 'done' : 'pending';
          return {
            id: albumId,
            name: albumMetadata.name,
            totalTracks: total,
            fetched,
            status,
            addedAt: albumMetadata.addedAt,
            externalUrl: albumMetadata.externalUrl,
            artistName: albumMetadata.artistName,
          };
        })
        .sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));

      setProgress({
        playlists: initialPlaylistProgress,
        albums: initialAlbumProgress,
        rateLimitCountdown: null,
        updateStatus: 'idle',
      });
    }
    loadFromCache();
  }, []);

  const run = useCallback(
    (
      abortController: AbortController,
      options: {concurrency?: number},
    ): Promise<TrackResult[]> => {
      return new Promise(async (resolve, reject) => {
        const sdk = await getSpotifySdk();
        if (sdk == null) {
          reject(new Error('Spotify SDK not found'));
          return;
        }

        const [cachedPlaylistsTracks, cachedAlbumsTracks] = await Promise.all([
          getCachedPlaylistTracks(),
          getCachedAlbumTracks(),
        ]);

        setProgress(progress => ({
          ...progress,
          updateStatus: 'fetching',
        }));

        const [playlists, savedAlbums] = await Promise.all([
          getAllPlaylists(sdk),
          getAllSavedAlbums(sdk),
        ]);
        const playlistMetadata = playlists.reduce(
          (acc: CachePlaylistMetadata, p) => {
            const snapshot: string = p.snapshot_id;
            acc[snapshot] = {
              id: p.id,
              name: p.name,
              collaborative: p.collaborative,
              externalUrl: p.external_urls.spotify,
              owner: {
                displayName: p.owner.display_name,
                externalUrl: p.owner.external_urls.spotify,
              },
              total: p.tracks?.total ?? 0,
            };
            return acc;
          },
          {} as CachePlaylistMetadata,
        );
        await setCachedPlaylistMetadata(playlistMetadata);

        // Persist albums metadata
        const albumMetadata = savedAlbums.reduce(
          (acc: CacheAlbumMetadata, s) => {
            acc[s.album.id] = {
              id: s.album.id,
              name: s.album.name,
              externalUrl: s.album.external_urls.spotify,
              artistName: s.album.artists[0].name,
              addedAt: s.added_at,
              totalTracks: s.album.total_tracks,
            };
            return acc;
          },
          {} as CacheAlbumMetadata,
        );
        await setCachedAlbumMetadata(albumMetadata);

        /* Set the progress to the new playlists and albums */
        setProgress(prev => ({
          ...prev,
          playlists: Object.entries(playlistMetadata).map(
            ([snapshotId, p]) => ({
              ...p,
              owner: p.owner.displayName,
              snapshotId,
              fetched: 0,
              status: 'pending',
            }),
          ),
          albums: Object.values(albumMetadata).map(album => ({
            ...album,
            fetched: 0,
            status: 'pending',
          })),
          rateLimitCountdown: null,
          updateStatus: 'idle',
        }));

        console.log(
          '[Spotify] Integrity check starting for',
          playlists.length,
          'playlists',
        );
        const integrity = {
          total: playlists.length,
          complete: 0,
          resume: 0,
          fresh: 0,
        };

        const foundSnapshots: string[] = [];
        const foundAlbums: string[] = [];

        await pMap(
          playlists,
          async p => {
            if (abortController.signal.aborted) return;

            const snapshot = p.snapshot_id;
            foundSnapshots.push(snapshot);
            const cachedPlaylistTracks = cachedPlaylistsTracks[snapshot];

            const total = p?.tracks?.total ?? 0;
            const cachedLen = cachedPlaylistTracks?.length ?? 0;

            // Integrity check & control flow
            if (cachedPlaylistTracks != null) {
              if (total > MAX_PLAYLIST_TRACKS_TO_FETCH) {
                // Skip long playlists
                setProgress(prev => ({
                  ...prev,
                  playlists: prev.playlists.map(pl =>
                    pl.snapshotId === snapshot
                      ? {
                          ...pl,
                          total,
                          fetched: 0,
                          status: 'done',
                        }
                      : pl,
                  ),
                }));
                integrity.complete += 1;
                return;
              }
              if (total === 0) {
                // Nothing to fetch; mark complete immediately
                setProgress(prev => ({
                  ...prev,
                  playlists: prev.playlists.map(pl =>
                    pl.snapshotId === snapshot
                      ? {
                          ...pl,
                          total: 0,
                          fetched: 0,
                          status: 'done',
                        }
                      : pl,
                  ),
                }));
                integrity.complete += 1;
                return;
              }
              if (total > 0 && cachedLen >= total) {
                // Cache is complete: mark done and skip

                setProgress(prev => ({
                  ...prev,
                  playlists: prev.playlists.map(pl =>
                    pl.snapshotId === snapshot
                      ? {
                          ...pl,
                          total,
                          fetched: cachedLen,
                          status: 'done',
                        }
                      : pl,
                  ),
                }));
                integrity.complete += 1;
                return;
              }

              // Cache incomplete or total unknown: resume fetching from current length
              setProgress(prev => ({
                ...prev,
                playlists: prev.playlists.map(pl =>
                  pl.snapshotId === snapshot
                    ? {
                        ...pl,
                        total,
                        fetched: cachedLen,
                        status: 'fetching',
                      }
                    : pl,
                ),
              }));

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
                    cachedPlaylistsTracks[snapshot] =
                      cachedPlaylistsTracks[snapshot].concat(pageTracks);
                    await setCachedPlaylistTracks(cachedPlaylistsTracks);

                    const fetched = cachedPlaylistsTracks[snapshot].length;
                    setProgress(prev => ({
                      ...prev,
                      playlists: prev.playlists.map(pl =>
                        pl.snapshotId === snapshot ? {...pl, fetched} : pl,
                      ),
                    }));
                  },
                  abortController,
                  retryAfterSeconds => {
                    setProgress(prev => ({
                      ...prev,
                      rateLimitCountdown: {retryAfterSeconds},
                    }));
                  },
                  cachedLen,
                );
              } catch (e: any) {
                console.error('Error resuming playlist', p.id, e);
                setProgress(prev => ({
                  ...prev,
                  playlists: prev.playlists.map(pl =>
                    pl.snapshotId === snapshot
                      ? {
                          ...pl,
                          status: 'error',
                          lastError: String(e?.message ?? e),
                        }
                      : pl,
                  ),
                }));
              }

              const finalFetched =
                cachedPlaylistsTracks[snapshot]?.length ?? cachedLen;

              setProgress(prev => ({
                ...prev,
                playlists: prev.playlists.map(pl =>
                  pl.snapshotId === snapshot
                    ? {
                        ...pl,
                        status: 'done',
                        fetched: finalFetched,
                        total: finalFetched,
                      }
                    : pl,
                ),
              }));
              setProgress(prev => ({
                ...prev,
                rateLimitCountdown: null,
              }));

              integrity.resume += 1;
              return;
            }

            // Fresh fetch (no cache)
            setProgress(prev => ({
              ...prev,
              playlists: prev.playlists.map(pl =>
                pl.snapshotId === snapshot ? {...pl, status: 'fetching'} : pl,
              ),
            }));

            if (total > MAX_PLAYLIST_TRACKS_TO_FETCH) {
              setProgress(prev => ({
                ...prev,
                playlists: prev.playlists.map(pl =>
                  pl.snapshotId === snapshot
                    ? {...pl, total, fetched: 0, status: 'done'}
                    : pl,
                ),
              }));
              integrity.complete += 1;
              return;
            }

            if (total === 0) {
              // Nothing to fetch
              setProgress(prev => ({
                ...prev,
                playlists: prev.playlists.map(pl =>
                  pl.snapshotId === snapshot
                    ? {...pl, total: 0, fetched: 0, status: 'done'}
                    : pl,
                ),
              }));
              integrity.complete += 1;
              return;
            }

            if (cachedPlaylistsTracks[snapshot] == null) {
              cachedPlaylistsTracks[snapshot] = [];
              await setCachedPlaylistTracks(cachedPlaylistsTracks);
            }

            try {
              await getAllPlaylistTracksWithProgress(
                sdk,
                p.id,
                async (pageTracks, _pageIndex) => {
                  cachedPlaylistsTracks[snapshot] =
                    cachedPlaylistsTracks[snapshot].concat(pageTracks);
                  await setCachedPlaylistTracks(cachedPlaylistsTracks);

                  const fetched = cachedPlaylistsTracks[snapshot].length;
                  setProgress(prev => ({
                    ...prev,
                    playlists: prev.playlists.map(pl =>
                      pl.snapshotId === snapshot ? {...pl, fetched} : pl,
                    ),
                  }));
                },
                abortController,
                retryAfterSeconds => {
                  setProgress(prev => ({
                    ...prev,
                    rateLimitCountdown: {retryAfterSeconds},
                  }));
                },
                0,
              );
            } catch (e: any) {
              console.error('Error fetching playlist', p.id, e);
              setProgress(prev => ({
                ...prev,
                playlists: prev.playlists.map(pl =>
                  pl.snapshotId === snapshot
                    ? {
                        ...pl,
                        status: 'error',
                        lastError: String(e?.message ?? e),
                      }
                    : pl,
                ),
              }));
            }

            const finalFetched =
              cachedPlaylistsTracks[snapshot]?.length ?? cachedLen;

            setProgress(prev => ({
              ...prev,
              playlists: prev.playlists.map(pl =>
                pl.snapshotId === snapshot
                  ? {
                      ...pl,
                      status: 'done',
                      fetched: finalFetched,
                      total: finalFetched,
                    }
                  : pl,
              ),
            }));
            setProgress(prev => ({
              ...prev,
              rateLimitCountdown: null,
            }));

            integrity.fresh += 1;
          },
          {concurrency: options.concurrency ?? 3},
        );

        // Fetch saved album tracks
        await pMap(
          savedAlbums,
          async s => {
            if (abortController.signal.aborted) return;

            const albumId = s.album.id;
            foundAlbums.push(albumId);
            const total = s.album.total_tracks;
            const cachedAlbumTracks = cachedAlbumsTracks[albumId];
            if (cachedAlbumTracks) {
              setProgress(prev => ({
                ...prev,
                albums: prev.albums.map(a =>
                  a.id === albumId
                    ? {
                        ...a,
                        totalTracks: total,
                        fetched: cachedAlbumTracks.length,
                        status:
                          cachedAlbumTracks.length >= total && total > 0
                            ? 'done'
                            : 'pending',
                      }
                    : a,
                ),
              }));
              return;
            }
            setProgress(prev => ({
              ...prev,
              albums: prev.albums.map(a =>
                a.id === albumId ? {...a, status: 'fetching'} : a,
              ),
            }));

            try {
              const tracks = await getAllAlbumTracks(sdk, albumId);
              cachedAlbumsTracks[albumId] = tracks;
              await setCachedAlbumTracks(cachedAlbumsTracks);

              setProgress(prev => ({
                ...prev,
                albums: prev.albums.map(a =>
                  a.id === albumId
                    ? {
                        ...a,
                        fetched: tracks.length,
                        totalTracks: total,
                        status: 'done',
                      }
                    : a,
                ),
              }));
            } catch (e) {
              console.error('Error fetching album tracks', albumId, e);
              setProgress(prev => ({
                ...prev,
                albums: prev.albums.map(a =>
                  a.id === albumId ? {...a, status: 'error'} : a,
                ),
              }));
            }
          },
          {concurrency: options.concurrency ?? 3},
        );

        console.log(
          '[Spotify] Integrity check result:',
          `total=${integrity.total}`,
          `complete=${integrity.complete}`,
          `resume=${integrity.resume}`,
          `fresh=${integrity.fresh}`,
        );

        // We want to remove all snapshots and albums from the cache that are not in the foundSnapshots and foundAlbums arrays
        const newPlaylistCache = foundSnapshots.reduce(
          (acc: {[snapshotId: string]: TrackResult[]}, snapshot: string) => {
            acc[snapshot] = cachedPlaylistsTracks[snapshot];
            return acc;
          },
          {},
        );
        await setCachedPlaylistTracks(newPlaylistCache);

        const newAlbumCache = foundAlbums.reduce(
          (acc: {[albumId: string]: TrackResult[]}, albumId: string) => {
            acc[albumId] = cachedAlbumsTracks[albumId];
            return acc;
          },
          {},
        );
        await setCachedAlbumTracks(newAlbumCache);
        setProgress(prev => ({
          ...prev,
          updateStatus: 'complete',
        }));

        const uniqueSongs = [
          ...Object.values(newPlaylistCache)
            .filter(playlistTracks => {
              if (playlistTracks?.length == null) {
                return false;
              }
              return playlistTracks.length < MAX_PLAYLIST_TRACKS_TO_FETCH;
            })
            .flat(),
          ...Object.values(newAlbumCache).flat(),
        ].reduce((acc, track) => {
          const key =
            `${track.name} - ${track.artists.join(', ')}`.toLowerCase();
          if (!acc.has(key)) {
            acc.set(key, track);
          }
          return acc;
        }, new Map<string, TrackResult>());

        const tracks = Array.from(uniqueSongs.values());

        resolve(tracks);
      });
    },
    [],
  );

  return [progress, run];
}
