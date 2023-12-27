'use client';

import {
  SongAccumulator,
  createIsInstalledFilter,
} from '@/lib/local-songs-folder/scanLocalCharts';
import {useCallback, useState} from 'react';
import chorusChartDb, {findMatchingCharts} from '@/lib/chorusChartDb';
import {selectChart} from '../chartSelection';
import {scanForInstalledCharts} from '@/lib/local-songs-folder';
import {
  getSpotifyDumpArtistTrackPlays,
  processSpotifyDump,
} from '@/lib/spotify-sdk/HistoryDumpParsing';
import SpotifyTableDownloader, {
  SpotifyPlaysRecommendations,
} from '../SpotifyTableDownloader';
import {signIn, signOut, useSession} from 'next-auth/react';
import Button from '@/components/Button';

type Falsy = false | 0 | '' | null | undefined;
const _Boolean = <T extends any>(v: T): v is Exclude<typeof v, Falsy> =>
  Boolean(v);

export default function Page() {
  const session = useSession();

  if (!session || session.status !== 'authenticated') {
    return (
      <div>
        <Button onClick={() => signIn('spotify')}>Sign in with Spotify</Button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4 sm:space-y-0 sm:space-x-4 w-full text-start sm:text-start">
        <span>Logged in as {session.data.user?.name}</span>
        <Button onClick={() => signOut()}>Sign out</Button>
      </div>

      <SpotifyHistory />
    </>
  );
}

function SpotifyHistory() {
  const [songs, setSongs] = useState<SpotifyPlaysRecommendations[] | null>(
    null,
  );
  const handler = useCallback(async () => {
    let installedCharts: SongAccumulator[] | undefined;

    alert('Select your Clone Hero songs directory');
    console.log('scan local charts');
    try {
      const scanResult = await scanForInstalledCharts();
      installedCharts = scanResult.installedCharts;
    } catch {
      console.log('User canceled picker');
      return;
    }

    console.log('get spotify listens');
    let artistTrackPlays = await getSpotifyDumpArtistTrackPlays();
    if (artistTrackPlays == null) {
      let spotifyDataHandle;

      try {
        spotifyDataHandle = await window.showDirectoryPicker({
          id: 'spotify-dump',
        });
      } catch {
        console.log('User canceled picker');
        return;
      }

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
    const allChorusCharts = await chorusChartDb();

    const recommendedCharts = notInstalledSongs
      .map(([artist, song, playCount]) => {
        const matchingCharts = findMatchingCharts(
          artist,
          song,
          allChorusCharts,
        );

        const {chart: recommendedChart, reasons} = selectChart(matchingCharts);

        if (recommendedChart == null) {
          return null;
        }

        return {
          artist,
          song,
          playCount,
          recommendedChart,
        };
      })
      .filter(_Boolean);

    if (recommendedCharts.length > 0) {
      setSongs(recommendedCharts);
      console.log(recommendedCharts);
    }
  }, []);

  return (
    <>
      <div className="flex justify-center">
        <button
          className="bg-blue-500 text-white px-4 py-2 rounded-md transition-all ease-in-out duration-300 hover:bg-blue-600 dark:bg-blue-400 dark:hover:bg-blue-500"
          onClick={handler}>
          Scan Spotify Dump
        </button>
      </div>

      {songs && <SpotifyTableDownloader tracks={songs} />}
    </>
  );
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
