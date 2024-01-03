'use client';

import {
  SongAccumulator,
  createIsInstalledFilter,
} from '@/lib/local-songs-folder/scanLocalCharts';
import {useCallback, useState} from 'react';
import chorusChartDb, {findMatchingCharts} from '@/lib/chorusChartDb';
import {scanForInstalledCharts} from '@/lib/local-songs-folder';
import {
  getSpotifyDumpArtistTrackPlays,
  processSpotifyDump,
} from '@/lib/spotify-sdk/HistoryDumpParsing';
import SpotifyTableDownloader, {
  SpotifyPlaysRecommendations,
} from '../SpotifyTableDownloader';
import {signIn, signOut, useSession} from 'next-auth/react';
import {Button} from '@/components/ui/button';

type Falsy = false | 0 | '' | null | undefined;
const _Boolean = <T extends any>(v: T): v is Exclude<typeof v, Falsy> =>
  Boolean(v);

export default function Page() {
  let auth = null;
  const session = useSession();

  // if (process.env.NODE_ENV === 'development') {
  //   auth =
  //     !session || session.status !== 'authenticated' ? (
  //       <div>
  //         <Button onClick={() => signIn('spotify')}>
  //           Sign in with Spotify
  //         </Button>
  //       </div>
  //     ) : (
  //       <div className="space-y-4 sm:space-y-0 sm:space-x-4 w-full text-start sm:text-start">
  //         <span>Logged in as {session.data.user?.name}</span>
  //         <Button onClick={() => signOut()}>Sign out</Button>
  //       </div>
  //     );
  // }

  return (
    <>
      {auth}

      <SpotifyHistory authenticated={session.status === 'authenticated'} />
    </>
  );
}

type Status = {
  status:
    | 'not-started'
    | 'scanning'
    | 'done-scanning'
    | 'processing-spotify-dump'
    | 'songs-from-encore'
    | 'finding-matches'
    | 'done';
  songsCounted: number;
};

function SpotifyHistory({authenticated}: {authenticated: boolean}) {
  const [songs, setSongs] = useState<SpotifyPlaysRecommendations[] | null>(
    null,
  );
  const [status, setStatus] = useState<Status>({
    status: 'not-started',
    songsCounted: 0,
  });

  const handler = useCallback(async () => {
    let installedCharts: SongAccumulator[] | undefined;

    const fetchChorusDb = chorusChartDb();

    console.log('scan local charts');
    try {
      setStatus({
        status: 'scanning',
        songsCounted: 0,
      });

      const scanResult = await scanForInstalledCharts(() => {
        setStatus(prevStatus => ({
          ...prevStatus,
          songsCounted: prevStatus.songsCounted + 1,
        }));
      });
      installedCharts = scanResult.installedCharts;
      setStatus(prevStatus => ({
        ...prevStatus,
        status: 'done-scanning',
      }));
    } catch {
      console.log('User canceled picker');
      return;
    }

    console.log('get spotify listens');
    let artistTrackPlays = await getSpotifyDumpArtistTrackPlays();
    if (artistTrackPlays == null) {
      let spotifyDataHandle;

      alert(
        'Select the folder containing your extracted Spotify Extended Streaming History',
      );
      try {
        spotifyDataHandle = await window.showDirectoryPicker({
          id: 'spotify-dump',
        });
      } catch {
        console.log('User canceled picker');
        return;
      }

      setStatus(prevStatus => ({
        ...prevStatus,
        status: 'processing-spotify-dump',
      }));
      artistTrackPlays = await processSpotifyDump(spotifyDataHandle);
    }

    console.log('create installed filter');
    const isInstalled = await createIsInstalledFilter(installedCharts);
    console.log('filter songs');
    const notInstalledSongs = filterInstalledSongs(
      artistTrackPlays,
      isInstalled,
    );
    console.log('done filtering songs');
    setStatus(prevStatus => ({
      ...prevStatus,
      status: 'songs-from-encore',
    }));

    // Yield to React to let it update State
    await new Promise(resolve => {
      setTimeout(resolve, 10);
    });

    const allChorusCharts = await fetchChorusDb;

    // Yield to React to let it update State
    await new Promise(resolve => {
      setTimeout(resolve, 10);
    });

    console.log('finding matches');
    setStatus(prevStatus => ({
      ...prevStatus,
      status: 'finding-matches',
    }));

    // Yield to React to let it update State
    await new Promise(resolve => {
      setTimeout(resolve, 100);
    });

    const recommendedCharts = notInstalledSongs
      .map(([artist, song, playCount]) => {
        const matchingCharts = findMatchingCharts(
          artist,
          song,
          allChorusCharts,
        );

        if (matchingCharts.length == 0) {
          return null;
        }

        return {
          artist,
          song,
          playCount,
          matchingCharts,
        };
      })
      .filter(_Boolean);

    setStatus(prevStatus => ({
      ...prevStatus,
      status: 'done',
    }));

    if (recommendedCharts.length > 0) {
      setSongs(recommendedCharts);
      console.log(recommendedCharts);
    }
  }, []);

  return (
    <>
      <div className="flex justify-center">{renderStatus(status, handler)}</div>

      {songs && (
        <SpotifyTableDownloader tracks={songs} showPreview={authenticated} />
      )}
    </>
  );
}

function renderStatus(status: Status, scanHandler: () => void) {
  switch (status.status) {
    case 'not-started':
      return <Button onClick={scanHandler}>Scan Spotify Dump</Button>;
    case 'scanning':
    case 'done-scanning':
      return `${status.songsCounted} songs scanned`;
    case 'processing-spotify-dump':
      return 'Processing Spotify Extended Streaming History';
    case 'songs-from-encore':
      return 'Downloading songs from Encore';
    case 'finding-matches':
      return 'Checking for song matches';
    case 'done':
      return <Button onClick={scanHandler}>Rescan</Button>;
  }
}

function filterInstalledSongs(
  spotifySongs: Map<string, Map<string, number>>,
  isInstalled: (artist: string, song: string) => boolean,
): [artist: string, song: string, playCount: number][] {
  const filtered: Map<string, Map<string, number>> = new Map();

  console.log('add to set');
  // SLOW
  for (const [artist, songs] of spotifySongs.entries()) {
    for (const [song, playCount] of songs.entries()) {
      if (!isInstalled(artist, song)) {
        if (filtered.get(artist) == null) {
          filtered.set(artist, new Map());
        }

        filtered.get(artist)!.set(song, playCount);
      }
    }
  }

  console.log('sort');
  const artistsSortedByListens = [...filtered.entries()]
    .toSorted((a, b) => {
      const aTotal = [...a[1].values()].reduce((a, b) => a + b, 0);
      const bTotal = [...b[1].values()].reduce((a, b) => a + b, 0);

      return bTotal - aTotal;
    })
    .map(([artist]) => artist);

  console.log('artists', artistsSortedByListens.length);

  const results: [artist: string, song: string, playCount: number][] = [];

  // SLOW
  for (const [artist, songs] of spotifySongs.entries()) {
    for (const [song, playCount] of songs.entries()) {
      if (!isInstalled(artist, song)) {
        results.push([artist, song, playCount]);
      }
    }
  }

  console.log('push results');

  results.sort((a, b) => {
    return b[2] - a[2];
  });

  console.log('sort results');

  return results;
}
