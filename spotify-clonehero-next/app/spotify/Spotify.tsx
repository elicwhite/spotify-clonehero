'use client';

import {signIn, signOut, useSession} from 'next-auth/react';

import {TrackResult, useSpotifyTracks} from '@/lib/spotify-sdk/SpotifyFetching';
import {Button} from '@/components/ui/button';
import {useCallback, useState} from 'react';
import {
  SongAccumulator,
  createIsInstalledFilter,
} from '@/lib/local-songs-folder/scanLocalCharts';
import {scanForInstalledCharts} from '@/lib/local-songs-folder';
import chorusChartDb, {
  findMatchingCharts,
  findMatchingChartsExact,
} from '@/lib/chorusChartDb';
import SpotifyTableDownloader, {
  SpotifyChartData,
  SpotifyPlaysRecommendations,
} from '../SpotifyTableDownloader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {Icons} from '@/components/icons';
import Image from 'next/image';
import spotifyLogoBlack from '@/public/assets/spotify/logo_black.png';
import SupportedBrowserWarning from '../SupportedBrowserWarning';
import {ChartResponseEncore} from '@/lib/chartSelection';
import {Searcher} from 'fast-fuzzy';

type Falsy = false | 0 | '' | null | undefined;
const _Boolean = <T extends any>(v: T): v is Exclude<typeof v, Falsy> =>
  Boolean(v);

/* TODO:
+ Add Spotify logos
- Add progress messages for scanning
- Make header prettier?
+ Make table buttons match theme
- List what Spotify Playlist the song is in
- Make spotify logo light in dark mode
*/

export default function Spotify() {
  const session = useSession();

  if (!session || session.status !== 'authenticated') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sign in with Spotify</CardTitle>
          <CardDescription>
            Sign in with your Spotify account for the tool to scan your
            playlists and find matching charts on Chorus.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={() => signIn('spotify')} className="w-full">
            <Icons.spotify className="h-4 w-4 mr-2" />
            Sign in with Spotify
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <SupportedBrowserWarning>
      <div className="w-full">
        <div className="flex flex-col items-end px-6">
          <h3 className="text-xl">
            All data provided by
            <Image
              src={spotifyLogoBlack}
              sizes="8em"
              className="inline px-2"
              priority={true}
              style={{
                width: 'auto',
                height: 'auto',
              }}
              alt="Spotify"
            />
          </h3>
          <Button onClick={() => signOut()}>Sign out</Button>
        </div>
        <LoggedIn />
      </div>
    </SupportedBrowserWarning>
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

    const fetchDb = chorusChartDb();

    try {
      const scanResult = await scanForInstalledCharts();
      installedCharts = scanResult.installedCharts;
    } catch {
      console.log('User canceled picker');
      return;
    }

    const isInstalled = await createIsInstalledFilter(installedCharts);
    const allChorusCharts = await fetchDb;
    const markedCharts = markInstalledCharts(allChorusCharts, isInstalled);

    const artistSearcher = new Searcher(markedCharts, {
      keySelector: chart => chart.artist,
      threshold: 1,
      useDamerau: false,
      useSellers: false,
    });

    const recommendedCharts = tracks
      .map(({name, artists, preview_url}) => {
        const artist = artists[0];

        const matchingCharts = findMatchingCharts(artist, name, artistSearcher);

        if (
          matchingCharts.length == 0 ||
          !matchingCharts.some(chart => !chart.isInstalled)
        ) {
          return null;
        }

        return {
          artist,
          song: name,
          previewUrl: preview_url,
          matchingCharts,
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
          <Button onClick={calculate}>Select Clone Hero Songs Folder</Button>
        )}
      </div>

      {songs && <SpotifyTableDownloader tracks={songs} showPreview={true} />}
    </>
  );
}

function markInstalledCharts(
  allCharts: ChartResponseEncore[],
  isInstalled: (artist: string, song: string, charter: string) => boolean,
): SpotifyChartData[] {
  return allCharts.map(
    (chart): SpotifyChartData => ({
      ...chart,
      isInstalled: isInstalled(chart.artist, chart.name, chart.charter),
    }),
  );
}
