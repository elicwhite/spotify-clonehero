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
import {selectChart} from '../chartSelection';
import SpotifyTableDownloader, {
  SpotifyPlaysRecommendations,
} from '../SpotifyTableDownloader';

type Falsy = false | 0 | '' | null | undefined;
const _Boolean = <T extends any>(v: T): v is Exclude<typeof v, Falsy> =>
  Boolean(v);

export default function Spotify() {
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

      <LoggedIn />
    </>
  );
}

function LoggedIn() {
  const [tracks, update] = useSpotifyTracks();
  const [songs, setSongs] = useState<SpotifyPlaysRecommendations[] | null>(
    null,
  );

  const [calculating, setCalculating] = useState(false);

  const calculate = useCallback(async () => {
    setCalculating(true);
    update();
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
      .map(([artist, song, previewUrl]) => {
        const matchingCharts = findMatchingCharts(
          artist,
          song,
          allChorusCharts,
        );

        if (matchingCharts.length == 0) {
          return null;
        }

        const {chart: recommendedChart, reasons} = selectChart(matchingCharts);

        if (recommendedChart == null) {
          return null;
        }

        return {
          artist,
          song,
          previewUrl,
          recommendedChart,
        };
      })
      .filter(_Boolean);

    if (recommendedCharts.length > 0) {
      setSongs(recommendedCharts);
      console.log(recommendedCharts);
    }
    setCalculating(false);
  }, [tracks, update]);

  return (
    <>
      <div className="space-y-4 sm:space-y-0 sm:space-x-4 w-full text-start sm:text-start">
        {calculating ? (
          'Calculating'
        ) : (
          <Button onClick={calculate}>Calculate</Button>
        )}
      </div>

      {songs && <SpotifyTableDownloader tracks={songs} />}
    </>
  );
}

function filterInstalledSongs(
  spotifyTracks: TrackResult[],
  isInstalled: (artist: string, song: string) => boolean,
): [artist: string, song: string, previewUrl: string | null][] {
  const notInstalled: [
    artist: string,
    song: string,
    previewUrl: string | null,
  ][] = [];

  for (const track of spotifyTracks) {
    if (!isInstalled(track.artists[0], track.name)) {
      notInstalled.push([track.artists[0], track.name, track.preview_url]);
    }
  }

  return notInstalled;
}
