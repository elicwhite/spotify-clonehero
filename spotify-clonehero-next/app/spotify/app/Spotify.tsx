'use client';

import {Suspense, useCallback, useEffect, useState} from 'react';
import SpotifyTableDownloader, {
  SpotifyChartData,
  SpotifyPlaysRecommendations,
} from '../../SpotifyTableDownloader';
import {createClient} from '@/lib/supabase/client';
import {Button} from '@/components/ui/button';
import SupportedBrowserWarning from '../../SupportedBrowserWarning';
import {getLocalDb} from '@/lib/local-db/client';
import {sql} from 'kysely';
import {useData} from '@/lib/suspense-data';
import {SignInWithSpotifyCard} from './SignInWithSpotifyCard';
import {useChorusChartDb} from '@/lib/chorusChartDb';
import {scanForInstalledCharts} from '@/lib/local-songs-folder';
import {useSpotifyLibraryUpdate} from '@/lib/spotify-sdk/SpotifyFetching';
import {toast} from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import SpotifyLoaderCard from './SpotifyLoaderCard';
import LocalScanLoaderCard from './LocalScanLoaderCard';
import UpdateChorusLoaderCard from './UpdateChorusLoaderCard';
import {
  ChorusCharts,
  SpotifyAlbums,
  SpotifyPlaylists,
} from '@/lib/local-db/types';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {FileMusic} from 'lucide-react';
import dynamic from 'next/dynamic';
import {User} from '@supabase/supabase-js';

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
        redirectPath="/spotify/app"
      />
    );
  }

  return (
    <SupportedBrowserWarning>
      <div className="flex flex-1 flex-col w-full overflow-y-hidden">
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
  const [status, setStatus] = useState<Status>({
    status: 'not-started',
    songsCounted: 0,
  });

  const [spotifyLibraryProgress, updateSpotifyLibrary] =
    useSpotifyLibraryUpdate();
  const [chorusChartProgress, fetchChorusCharts] = useChorusChartDb(
    true /* force database */,
  );

  const [started, setStarted] = useState(false);

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
    const abortController = new AbortController();

    setStarted(true);

    const updateSpotifyLibraryPromise = updateSpotifyLibrary(abortController, {
      concurrency: 3,
    });

    const chorusChartsPromise = fetchChorusCharts(abortController);

    setStatus({status: 'scanning', songsCounted: 0});

    try {
      await scanForInstalledCharts(() => {
        setStatus(prevStatus => ({
          ...prevStatus,
          songsCounted: prevStatus.songsCounted + 1,
        }));
      });
      setStatus(prevStatus => ({...prevStatus, status: 'done-scanning'}));
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

    const [allChorusCharts, updateSpotifyLibraryResult] = await Promise.all([
      chorusChartsPromise,
      updateSpotifyLibraryPromise,
    ]);

    setStatus(prevStatus => ({
      ...prevStatus,
      status: 'done',
    }));
  }, []);

  return (
    <>
      {!started && <ScanLocalFoldersCTACard onClick={calculate} />}

      {started &&
        !(
          spotifyLibraryProgress.updateStatus === 'complete' &&
          status.status === 'done'
        ) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {useMockLoader ? (
              <SpotifyLoaderMock />
            ) : (
              <SpotifyLoaderCard progress={spotifyLibraryProgress} />
            )}
            <div className="space-y-4">
              <LocalScanLoaderCard
                count={status.songsCounted}
                isScanning={status.status === 'scanning'}
              />
              <UpdateChorusLoaderCard progress={chorusChartProgress} />
            </div>
          </div>
        )}

      {status.status === 'done' && (
        <Suspense fallback={<div>Loading...</div>}>
          <SupportedBrowserWarning>
            <SpotifyHistory />
          </SupportedBrowserWarning>
        </Suspense>
      )}
    </>
  );
}

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

type PickedSpotifyPlaylists = Pick<
  SpotifyPlaylists,
  | 'id'
  | 'snapshot_id'
  | 'name'
  | 'collaborative'
  | 'owner_display_name'
  | 'owner_external_url'
  | 'total_tracks'
  | 'updated_at'
>;

type PickedSpotifyAlbums = Pick<
  SpotifyAlbums,
  'id' | 'name' | 'artist_name' | 'total_tracks' | 'updated_at'
>;

async function getData() {
  const db = await getLocalDb();

  const before = performance.now();

  const result = await db
    // matched_tracks: Spotify tracks that appear in chart matches
    .with('matched_tracks', qb =>
      qb
        .selectFrom('spotify_track_chart_matches as track_chart_link')
        .innerJoin(
          'spotify_tracks as track',
          'track.id',
          'track_chart_link.spotify_id',
        )
        .select([
          'track.id as spotify_track_id',
          'track.name as spotify_track_name',
          'track.artist as spotify_artist_name',
        ])
        .distinct(),
    )

    // chart_aggregates: one JSON array of ChorusChart objects per Spotify track
    .with('chart_aggregates', qb =>
      qb
        .selectFrom(sub =>
          sub
            .selectFrom('spotify_track_chart_matches as link')
            .innerJoin('chorus_charts as chart', 'chart.md5', 'link.chart_md5')
            .select([
              'link.spotify_id as spotify_track_id',
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
              // per-chart installed flag without multiplying rows
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
            .groupBy(['link.spotify_id', 'chart.md5'])
            .as('deduped_charts'),
        )
        .select([
          'deduped_charts.spotify_track_id',
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
        .groupBy('deduped_charts.spotify_track_id'),
    )

    // playlist_aggregates: one JSON array of SpotifyPlaylist objects per track
    .with('playlist_aggregates', qb =>
      qb
        .selectFrom('spotify_playlist_tracks as playlist_link')
        .innerJoin(
          'spotify_playlists as playlist',
          'playlist.id',
          'playlist_link.playlist_id',
        )
        .select([
          'playlist_link.track_id as spotify_track_id',
          sql<PickedSpotifyPlaylists[]>`
          json_group_array(
            json_object(
              'id',                ${sql.ref('playlist.id')},
              'snapshot_id',       ${sql.ref('playlist.snapshot_id')},
              'name',              ${sql.ref('playlist.name')},
              'collaborative',     ${sql.ref('playlist.collaborative')},
              'owner_display_name',${sql.ref('playlist.owner_display_name')},
              'owner_external_url',${sql.ref('playlist.owner_external_url')},
              'total_tracks',      ${sql.ref('playlist.total_tracks')},
              'updated_at',        ${sql.ref('playlist.updated_at')}
            )
          )
        `.as('playlist_memberships'),
        ])
        .groupBy('playlist_link.track_id'),
    )

    // album_aggregates: one JSON array of SpotifyAlbum objects per track
    .with('album_aggregates', qb =>
      qb
        .selectFrom('spotify_album_tracks as album_link')
        .innerJoin('spotify_albums as album', 'album.id', 'album_link.album_id')
        .select([
          'album_link.track_id as spotify_track_id',
          sql<PickedSpotifyAlbums[]>`
          json_group_array(
            json_object(
              'id',           ${sql.ref('album.id')},
              'name',         ${sql.ref('album.name')},
              'artist_name',  ${sql.ref('album.artist_name')},
              'total_tracks', ${sql.ref('album.total_tracks')},
              'updated_at',   ${sql.ref('album.updated_at')}
            )
          )
        `.as('album_memberships'),
        ])
        .groupBy('album_link.track_id'),
    )

    // local_chart_flags: one boolean flag per track
    .with('local_chart_flags', qb =>
      qb
        .selectFrom('spotify_track_chart_matches as link')
        .innerJoin('chorus_charts as chart', 'chart.md5', 'link.chart_md5')
        .innerJoin('local_charts as local', join =>
          join
            .onRef('local.artist_normalized', '=', 'chart.artist_normalized')
            .onRef('local.song_normalized', '=', 'chart.name_normalized')
            .onRef('local.charter_normalized', '=', 'chart.charter_normalized'),
        )
        .select([
          'link.spotify_id as spotify_track_id',
          sql<number>`1`.as('is_any_local_chart_installed'),
        ])
        .groupBy('link.spotify_id')
        .distinct(),
    )

    // Final: only include tracks that have matching charts
    .selectFrom('chart_aggregates as chart_data')
    .innerJoin(
      'matched_tracks as track',
      'track.spotify_track_id',
      'chart_data.spotify_track_id',
    )
    .leftJoin(
      'playlist_aggregates as playlist_data',
      'playlist_data.spotify_track_id',
      'chart_data.spotify_track_id',
    )
    .leftJoin(
      'album_aggregates as album_data',
      'album_data.spotify_track_id',
      'chart_data.spotify_track_id',
    )
    .leftJoin(
      'local_chart_flags as installed_flag',
      'installed_flag.spotify_track_id',
      'chart_data.spotify_track_id',
    )
    .select([
      'track.spotify_track_id',
      'track.spotify_track_name',
      'track.spotify_artist_name',
      sql<number>`COALESCE(installed_flag.is_any_local_chart_installed, 0)`.as(
        'is_any_local_chart_installed',
      ),
      sql<PickedChorusCharts[]>`chart_data.matching_charts`.as(
        'matching_charts',
      ),
      sql<
        PickedSpotifyPlaylists[]
      >`COALESCE(playlist_data.playlist_memberships, json('[]'))`.as(
        'playlist_memberships',
      ),
      sql<
        PickedSpotifyAlbums[]
      >`COALESCE(album_data.album_memberships, json('[]'))`.as(
        'album_memberships',
      ),
    ])
    .where('spotify_track_name', '!=', '')
    .where('spotify_artist_name', '!=', '')
    .orderBy('track.spotify_artist_name')
    .orderBy('track.spotify_track_name')
    .execute();

  const after = performance.now();
  console.log('query time', after - before, 'ms');
  return result;
}

function SpotifyHistory() {
  const {data} = useData({
    key: 'spotify-history-tracks-data',
    fn: getData,
  });

  const songs: SpotifyPlaysRecommendations[] = data.map(item => {
    return {
      spotifyTrackId: item.spotify_track_id,
      artist: item.spotify_artist_name,
      song: item.spotify_track_name,
      isAnyInstalled: item.is_any_local_chart_installed === 1,
      matchingCharts: item.matching_charts.map((chart): SpotifyChartData => {
        return {
          ...chart,
          albumArtMd5: chart.album_art_md5 ?? '',
          hasVideoBackground: chart.has_video_background === 1,
          isInstalled: chart.isInstalled === 1,
          modifiedTime: chart.modified_time,
          file: `https://files.enchor.us/${chart.md5}.sng`,
        };
      }),
      playlistMemberships: item.playlist_memberships,
      albumMemberships: item.album_memberships,
    };
  });

  console.log(songs);

  return (
    <>
      {songs.length === 0 ? (
        <NoMatches />
      ) : (
        <SpotifyTableDownloader tracks={songs} showPreview={true} />
      )}
    </>
  );
}

async function pause() {
  // Yield to React to let it update State
  await new Promise(resolve => {
    setTimeout(resolve, 10);
  });
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

export function NoMatches() {
  return (
    <div className="flex justify-center">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileMusic />
          </EmptyMedia>
          <EmptyTitle>No Matching Charts</EmptyTitle>
          <EmptyDescription>
            We couldn&apos;t find any matching charts for your Spotify library.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}>
            Retry
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
