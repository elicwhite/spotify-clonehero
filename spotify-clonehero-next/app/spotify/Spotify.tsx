'use client';

import {useSession, signOut, signIn} from 'next-auth/react';
import {
  PlaylistedTrack,
  SearchResults,
  SimplifiedPlaylist,
  SimplifiedTrack,
  SpotifyApi,
  Track,
} from '@spotify/web-api-ts-sdk';
import {ReactNode, useCallback, useEffect, useState} from 'react';
import {RateLimitError, useSpotifySdk} from '@/lib/spotify-sdk/ClientInstance';
import pMap from 'p-map';

export default function Spotify() {
  const session = useSession();
  const spotifySdk = useSpotifySdk();

  if (!session || session.status !== 'authenticated' || !spotifySdk) {
    return (
      <div>
        <h1>Spotify Web API Typescript SDK in Next.js</h1>
        <Button onClick={() => signIn('spotify')}>Sign in with Spotify</Button>
      </div>
    );
  }

  return (
    <div>
      <div>
        <p>Logged in as {session.data.user?.name}</p>
        <Button onClick={() => signOut()}>Sign out</Button>
      </div>
      <LoggedIn sdk={spotifySdk} />
    </div>
  );
}

type CachePlaylistTracks = {
  [snapshotId: string]: TrackResult[];
};

function getCachedPlaylistTracks(): CachePlaylistTracks {
  const cachedPlaylistTracks = localStorage.getItem('playlistTracks');
  if (cachedPlaylistTracks) {
    return JSON.parse(cachedPlaylistTracks);
  }
  return {};
}

function setCachedPlaylistTracks(cachedPlaylistTracks: CachePlaylistTracks) {
  localStorage.setItem('playlistTracks', JSON.stringify(cachedPlaylistTracks));
}

function LoggedIn({sdk}: {sdk: SpotifyApi}) {
  const handler = useCallback(async () => {
    const start = Date.now();
    console.log('start', start);
    const playlists = await getAllPlaylists(sdk);
    console.log(playlists);
    const cachedPlaylistTracks = getCachedPlaylistTracks();
    const cachedSnapshots = Object.keys(cachedPlaylistTracks);
    const foundSnapshots: string[] = [];

    const playlistTracks = await pMap(
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
          setCachedPlaylistTracks(cachedPlaylistTracks);
          return playlistTracks;
        } catch {
          console.error(
            'Unexpected error fetching tracks for playlist',
            playlist.id,
            'with snapshot',
            playlist.snapshot_id,
          );
          return [];
        }
      },
      {concurrency: 10},
    );
    const tracks = playlistTracks.flat();

    const newCache = foundSnapshots.reduce(
      (acc: {[snapshotId: string]: TrackResult[]}, snapshot: string) => {
        acc[snapshot] = cachedPlaylistTracks[snapshot];
        return acc;
      },
      {},
    );
    setCachedPlaylistTracks(newCache);

    console.log(tracks);
    const end = Date.now();
    console.log('end', end);
    console.log('seconds', (end - start) / 1000);
  }, [sdk]);

  return (
    <>
      <Button onClick={handler}>Refresh Your Saved Tracks from Spotify</Button>
    </>
  );
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

type TrackResult = {
  name: string;
  artists: string[];
};

async function getAllPlaylistTracks(
  sdk: SpotifyApi,
  playlistId: string,
): Promise<TrackResult[]> {
  const tracks: TrackResult[] = [];
  const limit = 50;
  let offset = 0;
  let total = null;
  let retryAfter = 0;
  do {
    try {
      const items = await sdk.playlists.getPlaylistItems(
        playlistId,
        undefined,
        'total,limit,items(track(type,artists(type,name),name))',
        limit,
        offset,
      );

      if (total == null) {
        total = items.total;
      }
      const filteredTracks = items.items
        .filter(item => item.track.type === 'track')
        .map((item: PlaylistedTrack): TrackResult => {
          return {
            name: item.track.name,
            artists: (item.track as Track).artists.map(artist => artist.name),
          };
        });

      tracks.push(...filteredTracks);
      offset += limit;
    } catch (error: any) {
      if (error instanceof RateLimitError) {
        console.log(
          `Rate limited. Retrying after ${error.retryAfter} seconds...`,
        );
        await new Promise(resolve =>
          setTimeout(resolve, error.retryAfter * 1000),
        );
        continue;
      }
      throw error;
    }
  } while (total == null || offset < total);

  return tracks;
}

function Button({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className="bg-blue-500 text-white px-4 py-2 rounded-md transition-all ease-in-out duration-300 hover:bg-blue-600 dark:bg-blue-400 dark:hover:bg-blue-500"
      onClick={onClick}>
      {children}
    </button>
  );
}
