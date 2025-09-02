'use client';

import {createClient} from '@/lib/supabase/client';

import {
  useSpotifyTracks,
  useSpotifyLibraryUpdate,
} from '@/lib/spotify-sdk/SpotifyFetching';
import {Button} from '@/components/ui/button';
import {useCallback, useEffect, useState} from 'react';
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
import spotifyLogoWhite from '@/public/assets/spotify/logo_white.png';
import SupportedBrowserWarning from '../SupportedBrowserWarning';
import {ChartResponseEncore} from '@/lib/chartSelection';
import {Searcher} from 'fast-fuzzy';
import {toast} from 'sonner';
import SpotifyLoaderCard from './SpotifyLoaderCard';
import dynamic from 'next/dynamic';
import {useMemo} from 'react';

const SpotifyLoaderMock = dynamic(() => import('./SpotifyLoaderMock'), {
  ssr: false,
});

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
  const supabase = createClient();
  const [user, setUser] = useState<any>(null);
  const [hasSpotify, setHasSpotify] = useState(false);

  useEffect(() => {
    (async () => {
      const {data} = await supabase.auth.getUser();
      setUser(data?.user ?? null);
      const isLinked = data?.user?.identities?.some(
        (i: any) => i.provider === 'spotify',
      );
      setHasSpotify(!!isLinked);
    })();
  }, [supabase]);

  if (!user) {
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
          <Button
            onClick={async () => {
              const redirectUrl = `${window.location.origin}/auth/callback?next=${encodeURIComponent('/spotify')}`;
              const {data, error} = await supabase.auth.signInWithOAuth({
                provider: 'spotify',
                options: {redirectTo: redirectUrl},
              });
              if (!error && data?.url) {
                window.location.href = data.url;
              }
            }}
            className="w-full">
            <Icons.spotify className="h-4 w-4 mr-2" />
            Login with Spotify
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
              className="inline dark:hidden px-2"
              priority={true}
              style={{
                width: 'auto',
                height: 'auto',
              }}
              alt="Spotify"
            />
            <Image
              src={spotifyLogoWhite}
              sizes="8em"
              className="dark:inline px-2"
              priority={true}
              style={{
                width: 'auto',
                height: 'auto',
              }}
              alt="Spotify"
            />
          </h3>
          {hasSpotify ? null : (
            <Button
              onClick={async () => {
                const redirectUrl = `${window.location.origin}/auth/callback?next=${encodeURIComponent('/spotify')}`;
                await supabase.auth.linkIdentity({
                  provider: 'spotify',
                  options: {redirectTo: redirectUrl},
                });
              }}>
              Link Spotify
            </Button>
          )}
        </div>
        <LoggedIn />
      </div>
    </SupportedBrowserWarning>
  );
}

type Status = {
  status:
    | 'not-started'
    | 'scanning'
    | 'done-scanning'
    | 'fetching-spotify-data'
    | 'songs-from-encore'
    | 'finding-matches'
    | 'done';
  songsCounted: number;
};

function LoggedIn() {
  const [tracks, update] = useSpotifyTracks();
  const [songs, setSongs] = useState<SpotifyPlaysRecommendations[] | null>(
    null,
  );

  const [status, setStatus] = useState<Status>({
    status: 'not-started',
    songsCounted: 0,
  });

  const [calculating, setCalculating] = useState(false);

  const {playlists, isUpdating, rateLimit, prepare, startUpdate} =
    useSpotifyLibraryUpdate();

  useEffect(() => {
    prepare();
  }, [prepare]);

  const [useMockLoader, setUseMockLoader] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      setUseMockLoader(false);
      return;
    }
    try {
      const url = new URL(window.location.href);
      const fromQuery = url.searchParams.get('mockLoader') === '1';
      const fromStorage = localStorage.getItem('spotifyLoaderMock') === '1';
      setUseMockLoader(Boolean(fromQuery || fromStorage));
    } catch {}
  }, []);

  const calculate = useCallback(async () => {
    const fetchDb = chorusChartDb();

    setCalculating(true);
    const updatePromise = startUpdate({concurrency: 2});
    setStatus(prev => ({...prev, status: 'fetching-spotify-data'}));
    let installedCharts: SongAccumulator[] | undefined;

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
      // Yield to React to let it update State
      await pause();
    } catch (err) {
      if (err instanceof Error && err.message == 'User canceled picker') {
        toast.info('Directory picker canceled');
        setStatus({
          status: 'not-started',
          songsCounted: 0,
        });
        return;
      } else {
        toast.error('Error scanning local charts', {duration: 8000});
        setStatus({
          status: 'not-started',
          songsCounted: 0,
        });
        throw err;
      }
    }

    const isInstalled = await createIsInstalledFilter(installedCharts);
    setStatus(prevStatus => ({
      ...prevStatus,
      status: 'songs-from-encore',
    }));
    const allChorusCharts = await fetchDb;
    const markedCharts = markInstalledCharts(allChorusCharts, isInstalled);

    setStatus(prevStatus => ({
      ...prevStatus,
      status: 'finding-matches',
    }));
    const artistSearcher = new Searcher(markedCharts, {
      keySelector: chart => chart.artist,
      threshold: 1,
      useDamerau: false,
      useSellers: false,
    });

    const recommendedCharts = tracks
      .map(({name, artists, spotify_url, preview_url}) => {
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
          spotifyUrl: spotify_url,
          previewUrl: preview_url,
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
    setCalculating(false);
  }, [tracks, update]);

  return (
    <>
      {useMockLoader ? (
        <SpotifyLoaderMock />
      ) : (
        <SpotifyLoaderCard
          playlists={useMemo(
            () =>
              playlists.map(p => ({
                id: p.id,
                name: p.name,
                totalSongs: p.total,
                scannedSongs: p.fetched,
                isScanning: p.status === 'fetching',
              })),
            [playlists],
          )}
          rateLimitCountdown={rateLimit?.retryAfterSeconds ?? 0}
        />
      )}
      <div className="flex justify-center">
        {renderStatus(status, calculate)}
      </div>

      {songs && <SpotifyTableDownloader tracks={songs} showPreview={true} />}
    </>
  );
}

function renderStatus(status: Status, scanHandler: () => void) {
  switch (status.status) {
    case 'not-started':
      return (
        <Button onClick={scanHandler}>Select Clone Hero Songs Folder</Button>
      );
    case 'scanning':
    case 'done-scanning':
      return `${status.songsCounted} songs scanned`;
    case 'fetching-spotify-data':
      return 'Scanning your Spotify Library';
    case 'songs-from-encore':
      return 'Downloading songs from Encore';
    case 'finding-matches':
      return 'Checking for song matches';
    case 'done':
      return <Button onClick={scanHandler}>Rescan</Button>;
  }
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

async function pause() {
  // Yield to React to let it update State
  await new Promise(resolve => {
    setTimeout(resolve, 10);
  });
}
