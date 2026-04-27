'use client';

import {Suspense, useCallback, useEffect, useState} from 'react';
import {useChorusChartDb} from '@/lib/chorusChartDb';
import {scanForInstalledCharts} from '@/lib/local-songs-folder';
import {
  getSpotifyDumpArtistTrackPlays,
  processSpotifyDump,
} from '@/lib/spotify-sdk/HistoryDumpParsing';
import SpotifyTableDownloader, {
  SpotifyChartData,
  SpotifyPlaysRecommendations,
} from '../SpotifyTableDownloader';
import {createClient} from '@/lib/supabase/client';
import {Button} from '@/components/ui/button';
import {RxExternalLink} from 'react-icons/rx';
import SupportedBrowserWarning from '../SupportedBrowserWarning';
import {toast} from 'sonner';
import {Icons} from '@/components/icons';
import LocalScanLoaderCard from '../spotify/app/LocalScanLoaderCard';
import UpdateChorusLoaderCard from '../spotify/app/UpdateChorusLoaderCard';
import {getLocalDb} from '@/lib/local-db/client';
import {
  getHistoryRecommendations,
  type PickedChorusChartRow,
} from '@/lib/local-db/spotify-history/queries';

export default function Page() {
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

  const authRedirectUrl = `/auth/callback?next=${encodeURIComponent('/spotifyhistory')}`;

  const auth = !user ? (
    <div>
      <Button
        onClick={async () => {
          const {data, error} = await supabase.auth.signInWithOAuth({
            provider: 'spotify',
            options: {
              redirectTo: `${window.location.origin}${authRedirectUrl}`,
            },
          });
          if (!error && data?.url) {
            window.location.href = data.url;
          }
        }}>
        <Icons.spotify className="h-4 w-4 mr-2" />
        Login with Spotify for Previews
      </Button>
    </div>
  ) : !hasSpotify ? (
    <div className="space-y-4 sm:space-y-0 sm:space-x-4 w-full text-start sm:text-start">
      <Button
        onClick={async () => {
          await supabase.auth.linkIdentity({
            // @ts-ignore
            provider: 'spotify',
            options: {
              redirectTo: `${window.location.origin}${authRedirectUrl}`,
            },
          });
        }}>
        Link Spotify for Previews
      </Button>
    </div>
  ) : null;

  return (
    <>
      {auth}
      <p className="mb-4 text-center">
        This tool scans your Spotify{' '}
        <a
          href="https://www.spotify.com/us/account/privacy/"
          className="text-accent-foreground">
          Extended Streaming History <RxExternalLink className="inline" />
        </a>
        <br />
        and finds all the available charts on Encore for any song you&apos;ve
        ever listened to.
      </p>
      <Suspense fallback={<div>Loading...</div>}>
        <SupportedBrowserWarning>
          <SpotifyHistory authenticated={!!user && hasSpotify} />
        </SupportedBrowserWarning>
      </Suspense>
    </>
  );
}

type Status = {
  status:
    | 'not-started'
    | 'scanning'
    | 'done-scanning'
    | 'processing-spotify-dump'
    | 'fetching-chorus'
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
  const [chorusChartProgress, fetchChorusCharts] = useChorusChartDb(true);

  const handler = useCallback(async () => {
    const abortController = new AbortController();

    // Kick off everything that can start without a user-gesture decision:
    //  - chorus fetch (depends on local DB; triggers init on first call)
    //  - local scan (independent — it'll prompt for the songs directory)
    //  - spotify-dump cache check (DB + OPFS read; result decides whether
    //    we need to prompt the user for a Spotify directory)
    // None of these block each other: the cache check runs concurrently
    // with the scan's parse-sng work and the chorus network round-trip.
    const chorusChartsPromise = fetchChorusCharts(abortController);
    const cachedSpotifyPromise = getSpotifyDumpArtistTrackPlays();

    setStatus({status: 'scanning', songsCounted: 0});
    const scanPromise = scanForInstalledCharts(count => {
      setStatus(prevStatus => ({
        ...prevStatus,
        songsCounted: count,
      }));
    });

    let artistTrackPlays = await cachedSpotifyPromise;
    let spotifyDataHandle;
    if (artistTrackPlays == null) {
      alert(
        'Select the folder containing your extracted Spotify Extended Streaming History',
      );
      try {
        spotifyDataHandle = await window.showDirectoryPicker({
          id: 'spotify-dump',
        });
      } catch {
        toast.info('Directory picker canceled');
        console.log('User canceled picker');
        abortController.abort();
        // Drain the in-flight scan so its rejection (if any) doesn't surface
        // as an unhandled-promise warning.
        scanPromise.catch(() => {});
        return;
      }
    }

    const spotifyDumpPromise = (async () => {
      if (artistTrackPlays != null) return artistTrackPlays;
      if (spotifyDataHandle == null) {
        throw new Error('Spotify data handle is null');
      }
      return await processSpotifyDump(spotifyDataHandle);
    })();

    try {
      await scanPromise;
      setStatus(prevStatus => ({
        ...prevStatus,
        status: 'done-scanning',
      }));
      await pause();
    } catch (err) {
      if (err instanceof Error && err.message == 'User canceled picker') {
        toast.info('Directory picker canceled');
        setStatus({
          status: 'not-started',
          songsCounted: 0,
        });
        abortController.abort();
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

    // Wait for parallel tasks to finish
    try {
      [artistTrackPlays] = await Promise.all([
        spotifyDumpPromise,
        chorusChartsPromise,
      ]);
    } catch (err) {
      setStatus({
        status: 'not-started',
        songsCounted: 0,
      });
      if (err instanceof Error) {
        toast.error(err.message, {duration: 8000});
      }
      return;
    }

    // Query matches from the database
    setStatus(prevStatus => ({
      ...prevStatus,
      status: 'finding-matches',
    }));
    await pause();

    const data = await getHistoryRecommendations(await getLocalDb());

    const results: SpotifyPlaysRecommendations[] = data.map(item => ({
      artist: item.artist,
      song: item.song,
      playCount: item.play_count,
      matchingCharts: (
        item.matching_charts as unknown as PickedChorusChartRow[]
      ).map(
        (chart): SpotifyChartData => ({
          ...chart,
          albumArtMd5: chart.album_art_md5 ?? '',
          hasVideoBackground: chart.has_video_background === 1,
          isInstalled: chart.isInstalled === 1,
          isSongInstalled: item.is_any_local_chart_installed === 1,
          modifiedTime: chart.modified_time,
          file: `https://files.enchor.us/${chart.md5}.sng`,
        }),
      ),
      playlistMemberships: item.playlist_memberships,
    }));

    setStatus(prevStatus => ({
      ...prevStatus,
      status: 'done',
    }));

    if (results.length > 0) {
      setSongs(results);
      console.log(results);
    }
  }, []);

  const isLoading = status.status !== 'not-started' && status.status !== 'done';

  return (
    <>
      {status.status === 'not-started' && (
        <div className="flex justify-center">
          <Button onClick={handler}>Scan Spotify Dump</Button>
        </div>
      )}

      {isLoading && (
        <>
          {status.status === 'processing-spotify-dump' && (
            <div className="flex justify-center">
              Processing Spotify Extended Streaming History
            </div>
          )}
          {status.status === 'finding-matches' && (
            <div className="flex justify-center">Checking for song matches</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <LocalScanLoaderCard count={status.songsCounted} />
            <UpdateChorusLoaderCard progress={chorusChartProgress} />
          </div>
        </>
      )}

      {status.status === 'done' && (
        <div className="flex justify-center">
          <Button onClick={handler}>Rescan</Button>
        </div>
      )}

      {songs && (
        <SpotifyTableDownloader tracks={songs} showPreview={authenticated} />
      )}
    </>
  );
}

async function pause() {
  await new Promise(resolve => {
    setTimeout(resolve, 10);
  });
}
