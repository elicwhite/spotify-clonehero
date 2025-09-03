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
import {
  getSongsDirectoryHandle,
  scanDirectoryForCharts,
} from '@/lib/local-songs-folder';
import {writeFile} from '@/lib/fileSystemHelpers';
import {sendGAEvent} from '@next/third-parties/google';
import chorusChartDb, {
  findMatchingCharts,
  findMatchingChartsExact,
} from '@/lib/chorusChartDb';
import SpotifyTableDownloader, {
  SpotifyChartData,
  SpotifyPlaysRecommendations,
} from '../../SpotifyTableDownloader';
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
import SupportedBrowserWarning from '../../SupportedBrowserWarning';
import {ChartResponseEncore} from '@/lib/chartSelection';
import {Searcher} from 'fast-fuzzy';
import {toast} from 'sonner';
import SpotifyLoaderCard from './SpotifyLoaderCard';
import LocalScanLoaderCard from './LocalScanLoaderCard';
import dynamic from 'next/dynamic';
import {useMemo} from 'react';
import {SupabaseClient, User} from '@supabase/supabase-js';

const SpotifyLoaderMock = dynamic(() => import('./SpotifyLoaderMock'), {
  ssr: false,
});

type Falsy = false | 0 | '' | null | undefined;
const _Boolean = <T extends any>(v: T): v is Exclude<typeof v, Falsy> =>
  Boolean(v);

/* TODO:
- List what Spotify Playlist the song is in
*/

export default function Spotify() {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
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

  if (!user || !hasSpotify) {
    const needsToLink = user != null && !hasSpotify;
    return (
      <SignInWithSpotifyCard
        supabaseClient={supabase}
        needsToLink={needsToLink}
      />
    );
  }

  return (
    <SupportedBrowserWarning>
      <div className="w-full">
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

  const {playlists, updateStatus, rateLimit, prepare, startUpdate, albums} =
    useSpotifyLibraryUpdate();

  const [started, setStarted] = useState(false);

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

  const loaderPlaylists = useMemo(() => {
    return playlists.map(p => {
      const owner = (p.ownerDisplayName || '').trim();
      const creator = owner
        ? owner.toLowerCase() === 'spotify'
          ? 'Spotify'
          : owner
        : 'You';
      return {
        id: p.id,
        name: p.name,
        totalSongs: p.total,
        scannedSongs: p.fetched,
        isScanning: p.status === 'fetching',
        creator,
        isCollaborative: Boolean(p.collaborative),
      };
    });
  }, [playlists]);

  const calculate = useCallback(async () => {
    let directoryHandle: FileSystemDirectoryHandle;
    try {
      directoryHandle = await getSongsDirectoryHandle();
    } catch (err) {
      if (err instanceof Error && err.message == 'User canceled picker') {
        toast.info('Directory picker canceled');
        setStatus({status: 'not-started', songsCounted: 0});
        return;
      }
      toast.error('Error selecting songs folder', {duration: 8000});
      setStatus({status: 'not-started', songsCounted: 0});
      throw err;
    }

    setStarted(true);
    try {
      startUpdate();
    } catch {}

    const fetchDb = chorusChartDb();

    setStatus({status: 'scanning', songsCounted: 0});
    let installedCharts: SongAccumulator[] | undefined;

    try {
      const scanResult = await scanDirectoryForCharts(() => {
        setStatus(prevStatus => ({
          ...prevStatus,
          songsCounted: prevStatus.songsCounted + 1,
        }));
      }, directoryHandle);
      installedCharts = scanResult.installedCharts;
      setStatus(prevStatus => ({...prevStatus, status: 'done-scanning'}));
      await pause();
    } catch (err) {
      toast.error('Error scanning local charts', {duration: 8000});
      setStatus({status: 'not-started', songsCounted: 0});
      throw err;
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
  }, [tracks, update, startUpdate]);

  return (
    <>
      {!started && <ScanLocalFoldersCTACard onClick={calculate} />}

      {started &&
        !(updateStatus === 'complete' && status.status === 'done') && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {useMockLoader ? (
              <SpotifyLoaderMock />
            ) : (
              <SpotifyLoaderCard
                playlists={loaderPlaylists}
                rateLimitCountdown={rateLimit?.retryAfterSeconds ?? 0}
                albums={albums}
                updateStatus={updateStatus}
              />
            )}
            <LocalScanLoaderCard
              count={status.songsCounted}
              isScanning={status.status === 'scanning'}
            />
          </div>
        )}

      {updateStatus === 'complete' && status.status === 'done' && songs && (
        <SpotifyTableDownloader tracks={songs} showPreview={true} />
      )}
    </>
  );
}

function renderStatus(status: Status, scanHandler: () => void) {
  switch (status.status) {
    case 'not-started':
      return <ScanLocalFoldersCTACard onClick={scanHandler} />;
    case 'scanning':
    case 'done-scanning':
      return null;
    case 'fetching-spotify-data':
      return <ProgressMessage message="Scanning your Spotify Library" />;
    case 'songs-from-encore':
      return <ProgressMessage message="Downloading songs from Encore" />;
    case 'finding-matches':
      return <ProgressMessage message="Checking for song matches" />;
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

function SignInWithSpotifyCard({
  supabaseClient,
  needsToLink,
}: {
  needsToLink: boolean;
  supabaseClient: SupabaseClient;
}) {
  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle>
          Sign in with
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
            className="hidden dark:inline px-2"
            priority={true}
            style={{
              width: 'auto',
              height: 'auto',
            }}
            alt="Spotify"
          />
        </CardTitle>
        <CardDescription>
          Sign in with your Spotify account for the tool to scan your playlists
          and find matching charts on Chorus.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={async () => {
            const redirectUrl = `${window.location.origin}/auth/callback?next=${encodeURIComponent('/spotify/app')}`;

            let result;
            if (needsToLink) {
              result = await supabaseClient.auth.linkIdentity({
                provider: 'spotify',
                options: {redirectTo: redirectUrl},
              });
            } else {
              result = await supabaseClient.auth.signInWithOAuth({
                provider: 'spotify',
                options: {redirectTo: redirectUrl},
              });
            }

            const {data, error} = result;

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

function ScanLocalFoldersCTACard({onClick}: {onClick: () => void}) {
  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle>Select Local Songs Folder</CardTitle>
        <CardDescription>
          We scan your local songs folder to find installed charts, enabling you
          to avoid downloading duplicate charts. Downloading a chart installs it
          into this folder, no need to copy from Downloads!
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={onClick} className="w-full">
          Select Songs Folder
        </Button>
      </CardContent>
    </Card>
  );
}

function ProgressMessage({message}: {message: string}) {
  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle>{message}</CardTitle>
      </CardHeader>
    </Card>
  );
}
