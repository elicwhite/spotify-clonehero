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
import {sql} from 'kysely';
import {ChorusCharts} from '@/lib/local-db/types';

type PickedChorusCharts = Pick<
  ChorusCharts,
  | 'md5'
  | 'name'
  | 'artist'
  | 'charter'
  | 'diff_drums'
  | 'diff_guitar'
  | 'diff_bass'
  | 'diff_keys'
  | 'diff_drums_real'
  | 'modified_time'
  | 'song_length'
  | 'has_video_background'
  | 'album_art_md5'
  | 'group_id'
> & {
  isInstalled: number;
};

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

    let artistTrackPlays = await getSpotifyDumpArtistTrackPlays();
    let spotifyDataHandle;
    if (artistTrackPlays == null) {
      alert(
        'Select the folder containing your extracted Spotify Extended Streaming History',
      );
      try {
        spotifyDataHandle = await window.showDirectoryPicker({
          id: 'spotify-dump',
        });
      } catch (err) {
        toast.info('Directory picker canceled');
        console.log('User canceled picker');
        return;
      }
    }

    // Kick off chorus chart fetch and spotify dump processing in parallel
    const chorusChartsPromise = fetchChorusCharts(abortController);

    const spotifyDumpPromise = (async () => {
      if (artistTrackPlays != null) return artistTrackPlays;
      if (spotifyDataHandle == null) {
        throw new Error('Spotify data handle is null');
      }
      return await processSpotifyDump(spotifyDataHandle);
    })();

    // Scan local charts in parallel with the above
    setStatus({status: 'scanning', songsCounted: 0});

    try {
      await scanForInstalledCharts(() => {
        setStatus(prevStatus => ({
          ...prevStatus,
          songsCounted: prevStatus.songsCounted + 1,
        }));
      });
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

    const data = await getHistoryData();

    const results: SpotifyPlaysRecommendations[] = data.map(item => ({
      artist: item.artist,
      song: item.song,
      playCount: item.play_count,
      matchingCharts: (item.matching_charts as unknown as PickedChorusCharts[]).map(
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

  const isLoading =
    status.status !== 'not-started' && status.status !== 'done';

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
            <div className="flex justify-center">
              Checking for song matches
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <LocalScanLoaderCard
              count={status.songsCounted}
              isScanning={status.status === 'scanning'}
            />
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


async function getHistoryData() {
  const db = await getLocalDb();

  const result = await db
    // chart_aggregates: one JSON array of charts per history song
    .with('chart_aggregates', qb =>
      qb
        .selectFrom(sub =>
          sub
            .selectFrom('spotify_history as h')
            .innerJoin('chorus_charts as chart', join =>
              join
                .onRef(
                  'chart.artist_normalized',
                  '=',
                  'h.artist_normalized',
                )
                .onRef('chart.name_normalized', '=', 'h.name_normalized'),
            )
            .select([
              'h.artist_normalized',
              'h.name_normalized',
              'chart.md5 as chart_md5',
              'chart.name as chart_name',
              'chart.artist as chart_artist_name',
              'chart.charter as chart_charter_name',
              'chart.diff_drums as difficulty_drums',
              'chart.diff_guitar as difficulty_guitar',
              'chart.diff_bass as difficulty_bass',
              'chart.diff_keys as difficulty_keys',
              'chart.diff_drums_real as difficulty_drums_real',
              'chart.modified_time as chart_modified_time',
              'chart.song_length as chart_song_length',
              'chart.has_video_background as has_video_background',
              'chart.album_art_md5 as album_art_md5',
              'chart.group_id as chart_group_id',
              sql<number>`
                CASE WHEN EXISTS (
                  SELECT 1
                  FROM local_charts lc
                  WHERE lc.artist_normalized  = chart.artist_normalized
                    AND lc.song_normalized    = chart.name_normalized
                    AND lc.charter_normalized = chart.charter_normalized
                ) THEN 1 ELSE 0 END
              `.as('isInstalled'),
            ])
            .groupBy(['h.artist_normalized', 'h.name_normalized', 'chart.md5'])
            .as('deduped_charts'),
        )
        .select([
          'deduped_charts.artist_normalized',
          'deduped_charts.name_normalized',
          sql<PickedChorusCharts[]>`
          json_group_array(
            json_object(
              'md5',               ${sql.ref('deduped_charts.chart_md5')},
              'name',              ${sql.ref('deduped_charts.chart_name')},
              'artist',            ${sql.ref('deduped_charts.chart_artist_name')},
              'charter',           ${sql.ref('deduped_charts.chart_charter_name')},
              'diff_drums',        ${sql.ref('deduped_charts.difficulty_drums')},
              'diff_guitar',       ${sql.ref('deduped_charts.difficulty_guitar')},
              'diff_bass',         ${sql.ref('deduped_charts.difficulty_bass')},
              'diff_keys',         ${sql.ref('deduped_charts.difficulty_keys')},
              'diff_drums_real',   ${sql.ref('deduped_charts.difficulty_drums_real')},
              'modified_time',     ${sql.ref('deduped_charts.chart_modified_time')},
              'song_length',       ${sql.ref('deduped_charts.chart_song_length')},
              'hasVideoBackground',${sql.ref('deduped_charts.has_video_background')},
              'albumArtMd5',       ${sql.ref('deduped_charts.album_art_md5')},
              'group_id',          ${sql.ref('deduped_charts.chart_group_id')},
              'isInstalled',       ${sql.ref('deduped_charts.isInstalled')}
            )
          )
        `.as('matching_charts'),
        ])
        .groupBy([
          'deduped_charts.artist_normalized',
          'deduped_charts.name_normalized',
        ]),
    )

    // local_chart_flags: song-level installed flag
    .with('local_chart_flags', qb =>
      qb
        .selectFrom('spotify_history as h')
        .innerJoin('chorus_charts as chart', join =>
          join
            .onRef(
              'chart.artist_normalized',
              '=',
              'h.artist_normalized',
            )
            .onRef('chart.name_normalized', '=', 'h.name_normalized'),
        )
        .innerJoin('local_charts as local', join =>
          join
            .onRef('local.artist_normalized', '=', 'chart.artist_normalized')
            .onRef('local.song_normalized', '=', 'chart.name_normalized'),
        )
        .select([
          'h.artist_normalized',
          'h.name_normalized',
          sql<number>`1`.as('is_any_local_chart_installed'),
        ])
        .groupBy(['h.artist_normalized', 'h.name_normalized'])
        .distinct(),
    )

    // Final select: join history with chart aggregates and install flags
    .selectFrom('spotify_history as h')
    .innerJoin('chart_aggregates as chart_data', join =>
      join
        .onRef(
          'chart_data.artist_normalized',
          '=',
          'h.artist_normalized',
        )
        .onRef('chart_data.name_normalized', '=', 'h.name_normalized'),
    )
    .leftJoin('local_chart_flags as installed_flag', join =>
      join
        .onRef(
          'installed_flag.artist_normalized',
          '=',
          'h.artist_normalized',
        )
        .onRef(
          'installed_flag.name_normalized',
          '=',
          'h.name_normalized',
        ),
    )
    .select([
      'h.artist',
      sql<string>`h.name`.as('song'),
      'h.play_count',
      sql<number>`COALESCE(installed_flag.is_any_local_chart_installed, 0)`.as(
        'is_any_local_chart_installed',
      ),
      sql<PickedChorusCharts[]>`chart_data.matching_charts`.as(
        'matching_charts',
      ),
    ])
    .where('h.artist', '!=', '')
    .where('h.name', '!=', '')
    .orderBy('h.play_count', 'desc')
    .execute();

  return result;
}

async function pause() {
  await new Promise(resolve => {
    setTimeout(resolve, 10);
  });
}
