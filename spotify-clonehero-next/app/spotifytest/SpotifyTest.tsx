'use client';

import {Suspense, useCallback, useEffect, useState} from 'react';
import SpotifyTableDownloader, {
  SpotifyChartData,
  SpotifyPlaysRecommendations,
} from '../SpotifyTableDownloader';
import {createClient} from '@/lib/supabase/client';
import {Button} from '@/components/ui/button';
import SupportedBrowserWarning from '../SupportedBrowserWarning';
import {getLocalDb, runRawSql} from '@/lib/local-db/client';
import {sql} from 'kysely';
import {useData} from '@/lib/suspense-data';
import {SignInWithSpotifyCard} from '../spotify/app/SignInWithSpotifyCard';
import {useChorusChartDb} from '@/lib/chorusChartDb';
import {scanForInstalledCharts} from '@/lib/local-songs-folder';
import {SongAccumulator} from '@/lib/local-songs-folder/scanLocalCharts';
import {useSpotifyLibraryUpdate} from '@/lib/spotify-sdk/SpotifyFetching';
import {toast} from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import SpotifyLoaderMock from '../spotify/app/SpotifyLoaderMock';
import SpotifyLoaderCard from '../spotify/app/SpotifyLoaderCard';
import LocalScanLoaderCard from '../spotify/app/LocalScanLoaderCard';
import UpdateChorusLoaderCard from '../spotify/app/UpdateChorusLoaderCard';
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
import {User} from '@supabase/supabase-js';

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

  // runRawSqlSpotifyQuery();

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
      <LoggedIn />
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

async function runRawSqlSpotifyQuery() {
  console.log('running sql');
  const rawResult = await runRawSql(`
    WITH
-- 1) Canonical key space: any song that has either a chart match (via tracks) or appears in history
keys AS (
  SELECT DISTINCT st.artist_normalized, st.name_normalized
  FROM spotify_track_chart_matches link
  JOIN spotify_tracks st ON st.id = link.spotify_id
  UNION
  SELECT DISTINCT h.artist_normalized, h.name_normalized
  FROM spotify_history h
),

-- 2) All chart rows reachable either via track matches or via history → mapped to keys
combined_chart_rows AS (
  SELECT
    st.artist_normalized,
    st.name_normalized,
    c.md5            AS chart_md5,
    c.name           AS chart_name,
    c.artist         AS chart_artist_name,
    c.charter        AS chart_charter_name,
    c.diff_drums     AS difficulty_drums,
    c.diff_guitar    AS difficulty_guitar,
    c.diff_bass      AS difficulty_bass,
    c.diff_keys      AS difficulty_keys,
    c.diff_drums_real AS difficulty_drums_real,
    c.modified_time  AS chart_modified_time,
    c.song_length    AS chart_song_length,
    c.has_video_background,
    c.album_art_md5,
    c.group_id       AS chart_group_id
  FROM spotify_track_chart_matches link
  JOIN chorus_charts c ON c.md5 = link.chart_md5
  JOIN spotify_tracks st ON st.id = link.spotify_id

  UNION ALL

  SELECT
    h.artist_normalized,
    h.name_normalized,
    c.md5, c.name, c.artist, c.charter,
    c.diff_drums, c.diff_guitar, c.diff_bass, c.diff_keys, c.diff_drums_real,
    c.modified_time, c.song_length, c.has_video_background, c.album_art_md5, c.group_id
  FROM spotify_history h
  JOIN chorus_charts c
    ON c.artist_normalized = h.artist_normalized
   AND c.name_normalized   = h.name_normalized
),

-- 3) Distinct local chart keys once (robust isInstalled without row multiplication)
local_keys AS (
  SELECT DISTINCT
    artist_normalized AS la,
    song_normalized   AS ls,
    charter_normalized AS lc
  FROM local_charts
),

-- 4) Charts per key, dedup by (key, md5), and compute isInstalled via LEFT JOIN to local_keys
chart_aggregates_by_key AS (
  SELECT
    d.artist_normalized,
    d.name_normalized,
    json_group_array(
      json_object(
        'md5',               d.chart_md5,
        'name',              d.chart_name,
        'artist',            d.chart_artist_name,
        'charter',           d.chart_charter_name,
        'diff_drums',        d.difficulty_drums,
        'diff_guitar',       d.difficulty_guitar,
        'diff_bass',         d.difficulty_bass,
        'diff_keys',         d.difficulty_keys,
        'diff_drums_real',   d.difficulty_drums_real,
        'modified_time',     d.chart_modified_time,
        'song_length',       d.chart_song_length,
        'hasVideoBackground',d.has_video_background,
        'albumArtMd5',       d.album_art_md5,
        'group_id',          d.chart_group_id,
        'isInstalled',       CASE WHEN lk.la IS NULL THEN 0 ELSE 1 END
      )
    ) AS matching_charts
  FROM (
    SELECT
      r.artist_normalized,
      r.name_normalized,
      r.chart_md5,
      MIN(r.chart_name)           AS chart_name,
      MIN(r.chart_artist_name)    AS chart_artist_name,
      MIN(r.chart_charter_name)   AS chart_charter_name,
      MIN(r.difficulty_drums)     AS difficulty_drums,
      MIN(r.difficulty_guitar)    AS difficulty_guitar,
      MIN(r.difficulty_bass)      AS difficulty_bass,
      MIN(r.difficulty_keys)      AS difficulty_keys,
      MIN(r.difficulty_drums_real) AS difficulty_drums_real,
      MIN(r.chart_modified_time)  AS chart_modified_time,
      MIN(r.chart_song_length)    AS chart_song_length,
      MIN(r.has_video_background) AS has_video_background,
      MIN(r.album_art_md5)        AS album_art_md5,
      MIN(r.chart_group_id)       AS chart_group_id
    FROM combined_chart_rows r
    GROUP BY r.artist_normalized, r.name_normalized, r.chart_md5
  ) AS d
  LEFT JOIN local_keys lk
    ON lk.la = d.artist_normalized
   AND lk.ls = d.name_normalized
   AND lk.lc = d.chart_charter_name
  GROUP BY d.artist_normalized, d.name_normalized
),

-- 5) Track metadata per key (if the same key maps to multiple track ids, keep a stable one)
track_info_by_key AS (
  SELECT
    st.artist_normalized,
    st.name_normalized,
    MIN(st.id)    AS spotify_track_id,
    MIN(st.name)  AS spotify_track_name,
    MIN(st.artist) AS spotify_artist_name
  FROM spotify_tracks st
  JOIN spotify_track_chart_matches m ON m.spotify_id = st.id
  GROUP BY st.artist_normalized, st.name_normalized
),

-- 6) Playlist memberships per key (distinct container per key to avoid dup objects)
playlist_aggregates_by_key AS (
  SELECT
    st.artist_normalized,
    st.name_normalized,
    json_group_array(
      json_object(
        'id',                p.id,
        'snapshot_id',       p.snapshot_id,
        'name',              p.name,
        'collaborative',     p.collaborative,
        'owner_display_name',p.owner_display_name,
        'owner_external_url',p.owner_external_url,
        'total_tracks',      p.total_tracks,
        'updated_at',        p.updated_at
      )
    ) AS playlist_memberships
  FROM (
    SELECT DISTINCT plt.track_id, plt.playlist_id
    FROM spotify_playlist_tracks plt
  ) dplt
  JOIN spotify_tracks st ON st.id = dplt.track_id
  JOIN spotify_playlists p ON p.id = dplt.playlist_id
  GROUP BY st.artist_normalized, st.name_normalized
),

-- 7) Album memberships per key
album_aggregates_by_key AS (
  SELECT
    st.artist_normalized,
    st.name_normalized,
    json_group_array(
      json_object(
        'id',           a.id,
        'name',         a.name,
        'artist_name',  a.artist_name,
        'total_tracks', a.total_tracks,
        'updated_at',   a.updated_at
      )
    ) AS album_memberships
  FROM (
    SELECT DISTINCT at.track_id, at.album_id
    FROM spotify_album_tracks at
  ) dat
  JOIN spotify_tracks st ON st.id = dat.track_id
  JOIN spotify_albums a ON a.id = dat.album_id
  GROUP BY st.artist_normalized, st.name_normalized
),

-- 8) History aggregates per key
history_by_key AS (
  SELECT
    h.artist_normalized,
    h.name_normalized,
    MIN(h.artist) AS artist,
    MIN(h.name)   AS name,
    SUM(h.play_count) AS play_count
  FROM spotify_history h
  GROUP BY h.artist_normalized, h.name_normalized
),

-- 9) Any key that actually has charts (this guarantees only songs with charts come out)
keys_with_charts AS (
  SELECT artist_normalized, name_normalized
  FROM chart_aggregates_by_key
)

SELECT
  COALESCE(t.spotify_track_id, '')                                      AS spotify_track_id,
  COALESCE(t.spotify_track_name, hb.name, '')                           AS spotify_track_name,
  COALESCE(t.spotify_artist_name, hb.artist, '')                        AS spotify_artist_name,
  COALESCE(cabk.matching_charts, json('[]'))                            AS matching_charts,
  COALESCE(pabk.playlist_memberships, json('[]'))                       AS playlist_memberships,
  COALESCE(aabk.album_memberships, json('[]'))                          AS album_memberships,
  hb.play_count                                                         AS spotify_history_play_count
FROM keys_with_charts k
LEFT JOIN track_info_by_key        t    ON t.artist_normalized = k.artist_normalized AND t.name_normalized = k.name_normalized
LEFT JOIN chart_aggregates_by_key  cabk ON cabk.artist_normalized = k.artist_normalized AND cabk.name_normalized = k.name_normalized
LEFT JOIN playlist_aggregates_by_key pabk ON pabk.artist_normalized = k.artist_normalized AND pabk.name_normalized = k.name_normalized
LEFT JOIN album_aggregates_by_key  aabk ON aabk.artist_normalized = k.artist_normalized AND aabk.name_normalized = k.name_normalized
LEFT JOIN history_by_key           hb   ON hb.artist_normalized  = k.artist_normalized AND hb.name_normalized  = k.name_normalized
WHERE COALESCE(t.spotify_track_name, hb.name, '')   <> ''
  AND COALESCE(t.spotify_artist_name, hb.artist, '') <> ''
ORDER BY LOWER(COALESCE(t.spotify_artist_name, hb.artist, '')),
         LOWER(COALESCE(t.spotify_track_name,  hb.name,   ''));
    `);

  console.log(rawResult);
}

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
          <div className="w-full">
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
          </div>
        )}

      {status.status === 'done' && (
        <div className="flex flex-1 flex-col w-full overflow-y-hidden">
          <Suspense fallback={<div>Loading...</div>}>
            <SupportedBrowserWarning>
              <SpotifyHistory />
            </SupportedBrowserWarning>
          </Suspense>
        </div>
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

  const withCtes = db
    .with('spotify_tracks_with_matching_charts', qb =>
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
          // normalized keys for deduping with history
          'track.artist_normalized as artist_normalized',
          'track.name_normalized as name_normalized',
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

    // history_by_key: aggregate plays by normalized keys to avoid duplicate joins
    .with('history_by_key', qb =>
      qb
        .selectFrom('spotify_history as h')
        .select([
          'h.artist_normalized as artist_normalized',
          'h.name_normalized as name_normalized',
          sql<string>`min(h.artist)`.as('artist'),
          sql<string>`min(h.name)`.as('name'),
          sql<number>`sum(h.play_count)`.as('play_count'),
        ])
        .groupBy(['h.artist_normalized', 'h.name_normalized']),
    )

    // history_chart_aggregates: charts matched from spotify_history by normalized keys
    .with('history_chart_aggregates', qb =>
      qb
        .selectFrom(sub =>
          sub
            .selectFrom('spotify_history as history')
            .innerJoin('chorus_charts as chart', join =>
              join
                .onRef(
                  'chart.artist_normalized',
                  '=',
                  'history.artist_normalized',
                )
                .onRef('chart.name_normalized', '=', 'history.name_normalized'),
            )
            .select([
              'history.artist_normalized as artist_normalized',
              'history.name_normalized as name_normalized',
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
            .groupBy([
              'history.artist_normalized',
              'history.name_normalized',
              'chart.md5',
            ])
            .as('deduped_history_charts'),
        )
        .select([
          'deduped_history_charts.artist_normalized',
          'deduped_history_charts.name_normalized',
          sql<PickedChorusCharts[]>`
            json_group_array(
              json_object(
                'md5',               ${sql.ref('deduped_history_charts.chart_md5')},
                'name',              ${sql.ref('deduped_history_charts.chart_name')},
                'artist',            ${sql.ref('deduped_history_charts.chart_artist_name')},
                'charter',           ${sql.ref('deduped_history_charts.chart_charter_name')},
                'diff_drums',        ${sql.ref('deduped_history_charts.difficulty_drums')},
                'diff_guitar',       ${sql.ref('deduped_history_charts.difficulty_guitar')},
                'diff_bass',         ${sql.ref('deduped_history_charts.difficulty_bass')},
                'diff_keys',         ${sql.ref('deduped_history_charts.difficulty_keys')},
                'diff_drums_real',   ${sql.ref('deduped_history_charts.difficulty_drums_real')},
                'modified_time',     ${sql.ref('deduped_history_charts.chart_modified_time')},
                'song_length',       ${sql.ref('deduped_history_charts.chart_song_length')},
                'hasVideoBackground',${sql.ref('deduped_history_charts.has_video_background')},
                'albumArtMd5',       ${sql.ref('deduped_history_charts.album_art_md5')},
                'group_id',          ${sql.ref('deduped_history_charts.chart_group_id')},
                'isInstalled',       ${sql.ref('deduped_history_charts.isInstalled')}
              )
            )
          `.as('matching_charts'),
        ])
        .groupBy([
          'deduped_history_charts.artist_normalized',
          'deduped_history_charts.name_normalized',
        ]),
    )

    // history_local_chart_flags: installed flag per (artist_norm, name_norm)
    .with('history_local_chart_flags', qb =>
      qb
        .selectFrom('spotify_history as history')
        .innerJoin('chorus_charts as chart', join =>
          join
            .onRef('chart.artist_normalized', '=', 'history.artist_normalized')
            .onRef('chart.name_normalized', '=', 'history.name_normalized'),
        )
        .innerJoin('local_charts as local', join =>
          join
            .onRef('local.artist_normalized', '=', 'chart.artist_normalized')
            .onRef('local.song_normalized', '=', 'chart.name_normalized')
            .onRef('local.charter_normalized', '=', 'chart.charter_normalized'),
        )
        .select([
          'history.artist_normalized as artist_normalized',
          'history.name_normalized as name_normalized',
          sql<number>`1`.as('is_any_local_chart_installed'),
        ])
        .groupBy(['history.artist_normalized', 'history.name_normalized'])
        .distinct(),
    );

  // Build FULL OUTER JOIN behavior via key union + left joins
  const result = await withCtes
    // Combine chart rows from spotify matches and history matches, keyed by normalized
    .with('combined_chart_rows', qb =>
      qb
        .selectFrom('spotify_track_chart_matches as link')
        .innerJoin('chorus_charts as chart', 'chart.md5', 'link.chart_md5')
        .innerJoin('spotify_tracks as st', 'st.id', 'link.spotify_id')
        .select([
          'st.artist_normalized as artist_normalized',
          'st.name_normalized as name_normalized',
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
        ])
        .unionAll(qb2 =>
          qb2
            .selectFrom('spotify_history as history')
            .innerJoin('chorus_charts as chart', join =>
              join
                .onRef(
                  'chart.artist_normalized',
                  '=',
                  'history.artist_normalized',
                )
                .onRef('chart.name_normalized', '=', 'history.name_normalized'),
            )
            .select([
              'history.artist_normalized as artist_normalized',
              'history.name_normalized as name_normalized',
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
            ]),
        ),
    )
    // Aggregate charts by key, deduping by md5
    .with('chart_aggregates_by_key', qb =>
      qb
        .selectFrom(sub =>
          sub
            .selectFrom('combined_chart_rows as r')
            .select([
              'r.artist_normalized',
              'r.name_normalized',
              'r.chart_md5',
              'r.chart_name',
              'r.chart_artist_name',
              'r.chart_charter_name',
              'r.difficulty_drums',
              'r.difficulty_guitar',
              'r.difficulty_bass',
              'r.difficulty_keys',
              'r.difficulty_drums_real',
              'r.chart_modified_time',
              'r.chart_song_length',
              'r.has_video_background',
              'r.album_art_md5',
              'r.chart_group_id',
              sql<number>`
                CASE WHEN EXISTS (
                  SELECT 1
                  FROM local_charts lc
                  WHERE lc.artist_normalized  = r.artist_normalized
                    AND lc.song_normalized    = r.name_normalized
                    AND lc.charter_normalized = r.chart_charter_name
                ) THEN 1 ELSE 0 END
              `.as('isInstalled'),
            ])
            .groupBy([
              'r.artist_normalized',
              'r.name_normalized',
              'r.chart_md5',
            ])
            .as('deduped'),
        )
        .select([
          'deduped.artist_normalized',
          'deduped.name_normalized',
          sql<PickedChorusCharts[]>`
          json_group_array(
            json_object(
              'md5',               ${sql.ref('deduped.chart_md5')},
              'name',              ${sql.ref('deduped.chart_name')},
              'artist',            ${sql.ref('deduped.chart_artist_name')},
              'charter',           ${sql.ref('deduped.chart_charter_name')},
              'diff_drums',        ${sql.ref('deduped.difficulty_drums')},
              'diff_guitar',       ${sql.ref('deduped.difficulty_guitar')},
              'diff_bass',         ${sql.ref('deduped.difficulty_bass')},
              'diff_keys',         ${sql.ref('deduped.difficulty_keys')},
              'diff_drums_real',   ${sql.ref('deduped.difficulty_drums_real')},
              'modified_time',     ${sql.ref('deduped.chart_modified_time')},
              'song_length',       ${sql.ref('deduped.chart_song_length')},
              'hasVideoBackground',${sql.ref('deduped.has_video_background')},
              'albumArtMd5',       ${sql.ref('deduped.album_art_md5')},
              'group_id',          ${sql.ref('deduped.chart_group_id')},
              'isInstalled',       ${sql.ref('deduped.isInstalled')}
            )
          )
        `.as('matching_charts'),
        ])
        .groupBy(['deduped.artist_normalized', 'deduped.name_normalized']),
    )
    // playlist aggregates by key
    .with('playlist_aggregates_by_key', qb =>
      qb
        .selectFrom('spotify_playlist_tracks as playlist_link')
        .innerJoin(
          'spotify_playlists as playlist',
          'playlist.id',
          'playlist_link.playlist_id',
        )
        .innerJoin('spotify_tracks as st', 'st.id', 'playlist_link.track_id')
        .select([
          'st.artist_normalized as artist_normalized',
          'st.name_normalized as name_normalized',
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
        .groupBy(['st.artist_normalized', 'st.name_normalized']),
    )
    // album aggregates by key
    .with('album_aggregates_by_key', qb =>
      qb
        .selectFrom('spotify_album_tracks as album_link')
        .innerJoin('spotify_albums as album', 'album.id', 'album_link.album_id')
        .innerJoin('spotify_tracks as st', 'st.id', 'album_link.track_id')
        .select([
          'st.artist_normalized as artist_normalized',
          'st.name_normalized as name_normalized',
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
        .groupBy(['st.artist_normalized', 'st.name_normalized']),
    )
    // local installed flag by key using combined charts
    .with('local_chart_flags_by_key', qb =>
      qb
        .selectFrom('combined_chart_rows as r')
        .innerJoin('local_charts as local', join =>
          join
            .onRef('local.artist_normalized', '=', 'r.artist_normalized')
            .onRef('local.song_normalized', '=', 'r.name_normalized')
            .onRef('local.charter_normalized', '=', 'r.chart_charter_name'),
        )
        .select([
          'r.artist_normalized as artist_normalized',
          'r.name_normalized as name_normalized',
          sql<number>`1`.as('is_any_local_chart_installed'),
        ])
        .groupBy(['r.artist_normalized', 'r.name_normalized'])
        .distinct(),
    )
    // track info by key (from spotify side), deduping multiple track ids per key
    .with('track_info_by_key', qb =>
      qb
        .selectFrom('spotify_tracks as st')
        .innerJoin('spotify_track_chart_matches as m', 'm.spotify_id', 'st.id')
        .select([
          'st.artist_normalized as artist_normalized',
          'st.name_normalized as name_normalized',
          sql<string>`min(st.id)`.as('spotify_track_id'),
          sql<string>`min(st.name)`.as('spotify_track_name'),
          sql<string>`min(st.artist)`.as('spotify_artist_name'),
        ])
        .groupBy(['st.artist_normalized', 'st.name_normalized']),
    )
    // keys from any side that actually have matching charts
    .with('keys_with_charts', qb =>
      qb
        .selectFrom('chart_aggregates_by_key as c')
        .select(['c.artist_normalized', 'c.name_normalized'])
        .distinct(),
    )
    // final merged select
    .selectFrom('keys_with_charts as k')
    .leftJoin('track_info_by_key as t', join =>
      join
        .onRef('t.artist_normalized', '=', 'k.artist_normalized')
        .onRef('t.name_normalized', '=', 'k.name_normalized'),
    )
    .leftJoin('chart_aggregates_by_key as chart_data', join =>
      join
        .onRef('chart_data.artist_normalized', '=', 'k.artist_normalized')
        .onRef('chart_data.name_normalized', '=', 'k.name_normalized'),
    )
    .leftJoin('playlist_aggregates_by_key as playlist_data', join =>
      join
        .onRef('playlist_data.artist_normalized', '=', 'k.artist_normalized')
        .onRef('playlist_data.name_normalized', '=', 'k.name_normalized'),
    )
    .leftJoin('album_aggregates_by_key as album_data', join =>
      join
        .onRef('album_data.artist_normalized', '=', 'k.artist_normalized')
        .onRef('album_data.name_normalized', '=', 'k.name_normalized'),
    )
    .leftJoin('history_by_key as hist', join =>
      join
        .onRef('hist.artist_normalized', '=', 'k.artist_normalized')
        .onRef('hist.name_normalized', '=', 'k.name_normalized'),
    )
    .leftJoin('local_chart_flags_by_key as installed_flag', join =>
      join
        .onRef('installed_flag.artist_normalized', '=', 'k.artist_normalized')
        .onRef('installed_flag.name_normalized', '=', 'k.name_normalized'),
    )
    .select([
      't.spotify_track_id',
      sql<string>`COALESCE(t.spotify_track_name, hist.name, '')`.as(
        'spotify_track_name',
      ),
      sql<string>`COALESCE(t.spotify_artist_name, hist.artist, '')`.as(
        'spotify_artist_name',
      ),
      sql<number>`COALESCE(installed_flag.is_any_local_chart_installed, 0)`.as(
        'is_any_local_chart_installed',
      ),
      sql<
        PickedChorusCharts[]
      >`COALESCE(chart_data.matching_charts, json('[]'))`.as('matching_charts'),
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
      sql<number | null>`hist.play_count`.as('spotify_history_play_count'),
    ])
    .where(sql<boolean>`COALESCE(t.spotify_track_name, hist.name, '') <> ''`)
    .where(sql<boolean>`COALESCE(t.spotify_artist_name, hist.artist, '') <> ''`)
    .orderBy(sql`lower(COALESCE(t.spotify_artist_name, hist.artist, ''))`)
    .orderBy(sql`lower(COALESCE(t.spotify_track_name, hist.name, ''))`)
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
      ...(item.spotify_track_id != null
        ? {
            spotifyUrl: `https://open.spotify.com/track/${item.spotify_track_id}`,
          }
        : {}),
      playlistMemberships: item.playlist_memberships,
      albumMemberships: item.album_memberships,

      // Add this back in once the table doesn't just look at the first song
      // to see if they all have a playcount.
      // Instead it should look at the spotify_history table and see if there are any rows
      // If there are, then it should render playcount (which could be empty), otherwise don't render the column
      ...(item.spotify_history_play_count != null
        ? {playCount: item.spotify_history_play_count}
        : {}),
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
