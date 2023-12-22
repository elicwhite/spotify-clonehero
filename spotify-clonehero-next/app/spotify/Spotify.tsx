'use client';

import {signIn, signOut, useSession} from 'next-auth/react';

import {TrackResult, useSpotifyTracks} from '@/lib/spotify-sdk/SpotifyFetching';
import Button from '@/components/Button';
import {useCallback, useState} from 'react';
import {
  SongAccumulator,
  createIsInstalledFilter,
} from '@/lib/local-songs-folder/scanLocalCharts';
import {scanForInstalledCharts} from '@/lib/local-songs-folder';
import chorusChartDb, {findMatchingCharts} from '@/lib/chorusChartDb';
import {ChartResponse, selectChart} from '../chartSelection';
import SpotifyTableDownloader from '../SpotifyTableDownloader';

type Falsy = false | 0 | '' | null | undefined;
const _Boolean = <T extends any>(v: T): v is Exclude<typeof v, Falsy> =>
  Boolean(v);

export default function Spotify() {
  const session = useSession();

  if (!session || session.status !== 'authenticated') {
    return (
      <div>
        <h1>Spotify Web API Typescript SDK in Next.js</h1>
        <Button onClick={() => signIn('spotify')}>Sign in with Spotify</Button>
      </div>
    );
  }

  return (
    <>
      <div>
        <p>Logged in as {session.data.user?.name}</p>
        <Button onClick={() => signOut()}>Sign out</Button>
      </div>
      <LoggedIn />
    </>
  );
}

type SpotifyPlaysRecommendations = {
  artist: string;
  song: string;
  recommendedChart: ChartResponse;
};

function LoggedIn() {
  const [tracks, update] = useSpotifyTracks();
  const [songs, setSongs] = useState<SpotifyPlaysRecommendations[] | null>(
    null,
  );

  const calculate = useCallback(async () => {
    let installedCharts: SongAccumulator[] | undefined;

    alert('Select your Clone Hero songs directory');
    try {
      const scanResult = await scanForInstalledCharts();
      installedCharts = scanResult.installedCharts;
    } catch {
      console.log('User canceled picker');
      return;
    }

    const isInstalled = await createIsInstalledFilter(installedCharts);
    const notInstalledSongs = filterInstalledSongs(tracks, isInstalled);

    const allChorusCharts = await chorusChartDb();

    const recommendedCharts = notInstalledSongs
      .map(([artist, song]) => {
        const matchingCharts = findMatchingCharts(
          artist,
          song,
          allChorusCharts,
        );

        const recommendedChart: ChartResponse | undefined = selectChart(
          matchingCharts
            // .filter(chart => chart.diff_drums_real > 0 || chart.diff_drums > 0)
            .map(chart => ({
              ...chart,
              uploadedAt: chart.modifiedTime,
              lastModified: chart.modifiedTime,
              file: `https://files.enchor.us/${chart.md5}.sng`,
            })),
        );

        if (recommendedChart == null) {
          return null;
        }

        return {
          artist,
          song,
          recommendedChart,
        };
      })
      .filter(_Boolean);

    if (recommendedCharts.length > 0) {
      setSongs(recommendedCharts);
      console.log(recommendedCharts);
    }
  }, [tracks]);

  return (
    <>
      <Button onClick={update}>Refresh Your Saved Tracks from Spotify</Button>
      <Button onClick={calculate}>Calculate</Button>
      {songs && <SpotifyTableDownloader tracks={songs} />}
    </>
  );
}

function filterInstalledSongs(
  spotifyTracks: TrackResult[],
  isInstalled: (artist: string, song: string) => boolean,
): [artist: string, song: string][] {
  const notInstalled: [artist: string, song: string][] = [];

  for (const track of spotifyTracks) {
    if (!isInstalled(track.artists[0], track.name)) {
      notInstalled.push([track.artists[0], track.name]);
    }
  }

  return notInstalled;
}
