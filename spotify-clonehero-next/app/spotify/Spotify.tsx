'use client';

import {useSession, signOut, signIn} from 'next-auth/react';
import {
  PlaylistedTrack,
  SearchResults,
  SimplifiedPlaylist,
  SimplifiedTrack,
  SpotifyApi,
} from '@spotify/web-api-ts-sdk';
import {useCallback, useEffect, useState} from 'react';
import {RateLimitError, useSpotifySdk} from '@/lib/spotify-sdk/ClientInstance';
import pMap from 'p-map';

export default function Spotify() {
  const session = useSession();
  const spotifySdk = useSpotifySdk();

  if (!session || session.status !== 'authenticated' || !spotifySdk) {
    return (
      <div>
        <h1>Spotify Web API Typescript SDK in Next.js</h1>
        <button onClick={() => signIn('spotify')}>Sign in with Spotify</button>
      </div>
    );
  }

  return (
    <div>
      <p>Logged in as {session.data.user?.name}</p>
      <button onClick={() => signOut()}>Sign out</button>
      <LoggedIn sdk={spotifySdk} />
    </div>
  );
}

function LoggedIn({sdk}: {sdk: SpotifyApi}) {
  const [results, setResults] = useState<SearchResults<['artist']>>(
    {} as SearchResults<['artist']>,
  );

  // useEffect(() => {
  //   (async () => {
  //     const results = await sdk.browse.getFeaturedPlaylists();
  //     console.log(results);
  //     // const results = await sdk.search('The Beatles', ['artist']);
  //     // setResults(() => results);
  //   })();
  // }, [sdk]);

  // // generate a table for the results
  // const tableRows = results.artists?.items.map(artist => {
  //   return (
  //     <tr key={artist.id}>
  //       <td>{artist.name}</td>
  //       <td>{artist.popularity}</td>
  //       <td>{artist.followers.total}</td>
  //     </tr>
  //   );
  // });

  // return (
  //   <>
  //     <h1>Spotify Search for The Beatles</h1>
  //     <table>
  //       <thead>
  //         <tr>
  //           <th>Name</th>
  //           <th>Popularity</th>
  //           <th>Followers</th>
  //         </tr>
  //       </thead>
  //       <tbody>{tableRows}</tbody>
  //     </table>
  //   </>
  // );
  const handler = useCallback(async () => {
    // const genreSeeds = await sdk.recommendations.genreSeeds();
    global.sdk = sdk;

    const start = Date.now();
    console.log('start', start);
    const playlists = await getAllPlaylists(sdk);
    console.log(playlists);
    // playlists.forEach(playlist => {
    //   console.log(playlist.name);
    // });

    const playlistTracks = await pMap(
      playlists,
      async playlist => {
        try {
          return await getAllPlaylistTracks(sdk, playlist.id);
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

    console.log(tracks);
    const end = Date.now();
    console.log('end', end);
    console.log('seconds', (end - start) / 1000);
    // playlists.map(async playlist => {
    //   const id = playlist.id;
    // })

    // const playlists =

    // const results = await sdk.browse.getNewReleases();
    // const results = await sdk.browse.getFeaturedPlaylists();
    // console.log(results);
  }, [sdk]);

  return (
    <>
      <button onClick={handler}>Get some data</button>
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

async function getAllPlaylistTracks(
  sdk: SpotifyApi,
  playlistId: string,
): Promise<PlaylistedTrack[]> {
  const tracks: PlaylistedTrack[] = [];
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
      const filteredTracks = items.items.filter(
        item => item.track.type === 'track',
      );
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
