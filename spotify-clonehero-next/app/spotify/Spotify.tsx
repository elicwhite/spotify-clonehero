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
import chorusChartDb, {findMatchingCharts} from '@/lib/chorusChartDb';
import {selectChart} from '../../lib/chartSelection';
import SpotifyTableDownloader, {
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

type Falsy = false | 0 | '' | null | undefined;
const _Boolean = <T extends any>(v: T): v is Exclude<typeof v, Falsy> =>
  Boolean(v);

/* TODO:
- Add Spotify logos
- Add progress messages for scanning
- Make header prettier?
+ Make table buttons match theme
- List what Spotify Playlist the song is in
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

        return {
          artist,
          song,
          previewUrl,
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
