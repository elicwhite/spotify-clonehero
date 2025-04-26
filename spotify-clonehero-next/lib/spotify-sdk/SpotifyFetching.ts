import {useCallback, useEffect, useMemo, useState} from 'react';
import {RateLimitError, useSpotifySdk} from './ClientInstance';
import {
  PlaylistedTrack,
  SimplifiedPlaylist,
  SpotifyApi,
  Track,
} from '@spotify/web-api-ts-sdk';
import pMap from 'p-map';
import {get, set} from 'idb-keyval';

type CachePlaylistTracks = {
  [snapshotId: string]: TrackResult[];
};

type CachePlaylistNames = {
  [snapshotId: string]: string;
};

export type TrackResult = {
  name: string;
  artists: string[];
  preview_url: string | null;
  spotify_url: string;
};

async function getCachedPlaylistTracks(): Promise<CachePlaylistTracks> {
  const cachedPlaylistTracks = await get('playlistTracks');
  return cachedPlaylistTracks ?? {};
}

async function setCachedPlaylistTracks(
  cachedPlaylistTracks: CachePlaylistTracks,
) {
  await set('playlistTracks', cachedPlaylistTracks);
}

async function setCachedPlaylistNames(cachedPlaylistNames: CachePlaylistNames) {
  await set('playlistNames', cachedPlaylistNames);
}

async function getAllPlaylists(sdk: SpotifyApi): Promise<SimplifiedPlaylist[]> {
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
  const sdk = useSpotifySdk();

  const getPreviewUrl = useCallback(async () => {
    if (sdk == null) {
      return null;
    }

    return await getTrackUrls(sdk, artist, song);
  }, [sdk, artist, song]);

  return getPreviewUrl;
}

export function useSpotifyTracks(): [
  tracks: TrackResult[],
  updateFromSpotify: () => Promise<void>,
] {
  const sdk = useSpotifySdk();
  const [forceUpdate, setForceUpdate] = useState(0);
  const [allTracks, setAllTracks] = useState<TrackResult[]>([]);

  useEffect(() => {
    if (sdk == null) {
      return;
    }

    // use this variable to satisfy eslint
    forceUpdate;

    async function calculate() {
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
  }, [sdk, forceUpdate]);

  const update = useCallback(async () => {
    if (sdk == null) {
      return;
    }

    const playlists = await getAllPlaylists(sdk);
    const playlistNames = playlists.reduce(
      (acc: CachePlaylistNames, playlist) => {
        const snapshot: string = playlist.snapshot_id;
        acc[snapshot] = playlist.name;
        return acc;
      },
      {},
    );

    await setCachedPlaylistNames(playlistNames);

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
            error
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
  }, [sdk]);

  return [allTracks, update];
}
