import {sql, type Kysely} from 'kysely';

import type {DB} from '../../lib/local-db/types';
import {isDrumType} from '@/lib/chorusChartDb/types';
import type {
  FindMusicChart,
  FindMusicProviderAction,
  FindMusicSong,
  FindMusicStats,
  RadarSong,
} from './types';
import {
  capPerArtist,
  type RadarCandidateSummary,
  sortRadarCandidateSummaries,
} from './model';

const IDENTITY_SEPARATOR = '\u001f';
const DEFAULT_RADAR_LIMIT = 1_200;
const MAX_RADAR_SONGS_PER_ARTIST = 5;

type ChartRow = {
  artist_normalized: string;
  name_normalized: string;
  display_artist: string;
  display_song: string;
  play_count?: number | bigint;
  artist_play_count?: number | bigint;
  saved_library_song_count?: number | bigint;
  in_apple_music_library?: number | bigint | boolean;
  md5: string;
  chart_artist: string;
  chart_name: string;
  charter: string;
  modified_time: string;
  album_art_md5: string | null;
  group_id: number | bigint;
  has_video_background: number | bigint | boolean;
  diff_guitar: number | null;
  diff_bass: number | null;
  diff_keys: number | null;
  diff_drums: number | null;
  has_guitar: number | bigint | boolean;
  has_bass: number | bigint | boolean;
  has_keys: number | bigint | boolean;
  has_drums: number | bigint | boolean;
  has_other_instruments: number | bigint | boolean;
  drum_type: number | null;
  is_installed: number | bigint | boolean;
  is_song_installed: number | bigint | boolean;
};

type EvidenceNameRow = {
  artist_normalized: string;
  name_normalized: string;
  evidence_name: string;
};

type ProviderActionRow = {
  artist_normalized: string;
  name_normalized: string;
  provider: 'appleMusic' | 'spotify';
  provider_id: string;
  artist: string;
  song: string;
};

function identityKey(artistNormalized: string, nameNormalized: string) {
  return `${artistNormalized}${IDENTITY_SEPARATOR}${nameNormalized}`;
}

/**
 * Charts are keyed on md5, so a charter re-uploading a fix leaves both
 * revisions in the mirror sharing one group_id. Only the newest revision of a
 * group is a distinct version to choose between. group_id 0 means Chorus
 * reported no group, so those rows stand alone.
 */
/**
 * Radar scoring and chart hydration must see the same revision of each
 * upload group. Keeping this CTE in one fragment prevents the score from
 * advertising instruments that disappear when the chart rows are hydrated.
 */
function currentChorusChartsCte() {
  return sql`
    current_chorus_charts AS (
      SELECT chart.*
      FROM chorus_charts AS chart
      WHERE chart.group_id = 0
        OR NOT EXISTS (
          SELECT 1
          FROM chorus_charts AS newer
          WHERE newer.group_id = chart.group_id
            AND (
              newer.modified_time > chart.modified_time
              OR (
                newer.modified_time = chart.modified_time
                AND newer.md5 > chart.md5
              )
            )
        )
    )
  `;
}

async function resolveDb(db?: Kysely<DB>): Promise<Kysely<DB>> {
  if (db) return db;
  const {getLocalDb} = await import('../../lib/local-db/client');
  return getLocalDb();
}

function toChart(row: ChartRow): FindMusicChart {
  return {
    md5: row.md5,
    artist: row.chart_artist,
    name: row.chart_name,
    charter: row.charter,
    modifiedTime: row.modified_time,
    albumArtMd5: row.album_art_md5,
    groupId: Number(row.group_id),
    hasVideoBackground: Boolean(row.has_video_background),
    hasOtherInstruments: Boolean(row.has_other_instruments),
    drumType: isDrumType(row.drum_type) ? row.drum_type : null,
    isInstalled: Boolean(row.is_installed),
    instruments: {
      guitar: row.diff_guitar,
      bass: row.diff_bass,
      keys: row.diff_keys,
      drums: row.diff_drums,
    },
    instrumentPresence: {
      guitar: Boolean(row.has_guitar),
      bass: Boolean(row.has_bass),
      keys: Boolean(row.has_keys),
      drums: Boolean(row.has_drums),
    },
  };
}

/**
 * Returns every Chorus song that has direct evidence in history or an active
 * provider library. Fuzzy identities collapse for Chorus matching, while
 * provider IDs and original version labels remain separate actions.
 */
export async function getFindMusicSongs(
  db?: Kysely<DB>,
): Promise<FindMusicSong[]> {
  const database = await resolveDb(db);

  const chartResult = await sql<ChartRow>`
    WITH ${currentChorusChartsCte()},
    current_spotify_track_ids AS (
      SELECT link.track_id
      FROM spotify_playlist_tracks AS link
      INNER JOIN spotify_playlists AS playlist ON playlist.id = link.playlist_id
      UNION
      SELECT link.track_id
      FROM spotify_album_tracks AS link
      INNER JOIN spotify_albums AS album ON album.id = link.album_id
    ),
    current_spotify_tracks AS (
      SELECT track.*
      FROM current_spotify_track_ids AS current
      INNER JOIN spotify_tracks AS track ON track.id = current.track_id
    ),
    active_apple_tracks AS (
      SELECT track.*
      FROM apple_music_tracks AS track
      INNER JOIN apple_music_library_state AS state
        ON state.id = 1 AND state.active_scan_id = track.scan_id
    ),
    direct_identity_rows AS (
      SELECT
        artist_normalized,
        name_normalized,
        artist,
        name AS song,
        play_count,
        1 AS is_history,
        0 AS is_apple
      FROM spotify_history
      WHERE artist_normalized <> '' AND name_normalized <> ''

      UNION ALL

      SELECT
        artist_normalized,
        name_normalized,
        artist,
        name AS song,
        0 AS play_count,
        0 AS is_history,
        0 AS is_apple
      FROM current_spotify_tracks
      WHERE artist_normalized IS NOT NULL
        AND name_normalized IS NOT NULL
        AND artist_normalized <> ''
        AND name_normalized <> ''

      UNION ALL

      SELECT
        artist_normalized,
        name_normalized,
        artist,
        name AS song,
        0 AS play_count,
        0 AS is_history,
        1 AS is_apple
      FROM active_apple_tracks
      WHERE artist_normalized <> '' AND name_normalized <> ''
    ),
    direct_songs AS (
      SELECT
        artist_normalized,
        name_normalized,
        COALESCE(
          MIN(CASE WHEN is_history = 1 THEN artist END),
          MIN(artist)
        ) AS display_artist,
        COALESCE(
          MIN(CASE WHEN is_history = 1 THEN song END),
          MIN(song)
        ) AS display_song,
        SUM(play_count) AS play_count,
        MAX(is_apple) AS in_apple_music_library
      FROM direct_identity_rows
      GROUP BY artist_normalized, name_normalized
    )
    SELECT
      direct_songs.artist_normalized,
      direct_songs.name_normalized,
      direct_songs.display_artist,
      direct_songs.display_song,
      direct_songs.play_count,
      direct_songs.in_apple_music_library,
      chart.md5,
      chart.artist AS chart_artist,
      chart.name AS chart_name,
      chart.charter,
      chart.modified_time,
      chart.album_art_md5,
      chart.group_id,
      chart.has_video_background,
      chart.diff_guitar,
      chart.diff_bass,
      chart.diff_keys,
      chart.diff_drums,
      chart.has_guitar,
      chart.has_bass,
      chart.has_keys,
      chart.has_drums,
      chart.has_other_instruments,
      chart.drum_type,
      CASE WHEN EXISTS (
        SELECT 1
        FROM local_charts AS local
        WHERE local.artist_normalized = chart.artist_normalized
          AND local.song_normalized = chart.name_normalized
          AND local.charter_normalized = chart.charter_normalized
      ) THEN 1 ELSE 0 END AS is_installed,
      CASE WHEN EXISTS (
        SELECT 1
        FROM local_charts AS local_song
        WHERE local_song.artist_normalized = chart.artist_normalized
          AND local_song.song_normalized = chart.name_normalized
      ) THEN 1 ELSE 0 END AS is_song_installed
    FROM direct_songs
    INNER JOIN current_chorus_charts AS chart
      ON chart.artist_normalized = direct_songs.artist_normalized
      AND chart.name_normalized = direct_songs.name_normalized
    ORDER BY
      direct_songs.play_count DESC,
      direct_songs.display_artist COLLATE NOCASE,
      direct_songs.display_song COLLATE NOCASE,
      chart.modified_time DESC,
      chart.md5
  `.execute(database);

  if (chartResult.rows.length === 0) return [];

  const [playlistResult, albumResult, actionResult] = await Promise.all([
    sql<EvidenceNameRow>`
      SELECT DISTINCT
        track.artist_normalized,
        track.name_normalized,
        playlist.name AS evidence_name
      FROM spotify_tracks AS track
      INNER JOIN spotify_playlist_tracks AS link ON link.track_id = track.id
      INNER JOIN spotify_playlists AS playlist ON playlist.id = link.playlist_id
      WHERE track.artist_normalized IS NOT NULL
        AND track.name_normalized IS NOT NULL
      ORDER BY playlist.name COLLATE NOCASE
    `.execute(database),
    sql<EvidenceNameRow>`
      SELECT DISTINCT
        track.artist_normalized,
        track.name_normalized,
        album.name AS evidence_name
      FROM spotify_tracks AS track
      INNER JOIN spotify_album_tracks AS link ON link.track_id = track.id
      INNER JOIN spotify_albums AS album ON album.id = link.album_id
      WHERE track.artist_normalized IS NOT NULL
        AND track.name_normalized IS NOT NULL
      ORDER BY album.name COLLATE NOCASE
    `.execute(database),
    sql<ProviderActionRow>`
      WITH current_spotify_track_ids AS (
        SELECT link.track_id
        FROM spotify_playlist_tracks AS link
        INNER JOIN spotify_playlists AS playlist ON playlist.id = link.playlist_id
        UNION
        SELECT link.track_id
        FROM spotify_album_tracks AS link
        INNER JOIN spotify_albums AS album ON album.id = link.album_id
      ),
      current_spotify_tracks AS (
        SELECT track.*
        FROM current_spotify_track_ids AS current
        INNER JOIN spotify_tracks AS track ON track.id = current.track_id
      ),
      active_apple_tracks AS (
        SELECT track.*
        FROM apple_music_tracks AS track
        INNER JOIN apple_music_library_state AS state
          ON state.id = 1 AND state.active_scan_id = track.scan_id
      )
      SELECT
        artist_normalized,
        name_normalized,
        'spotify' AS provider,
        id AS provider_id,
        artist,
        name AS song
      FROM current_spotify_tracks
      WHERE artist_normalized IS NOT NULL
        AND name_normalized IS NOT NULL
        AND artist_normalized <> ''
        AND name_normalized <> ''

      UNION ALL

      SELECT
        artist_normalized,
        name_normalized,
        'appleMusic' AS provider,
        catalog_id AS provider_id,
        artist,
        name AS song
      FROM active_apple_tracks
      WHERE catalog_id IS NOT NULL
        AND catalog_id <> ''
        AND artist_normalized <> ''
        AND name_normalized <> ''
      ORDER BY
        artist_normalized,
        name_normalized,
        provider,
        provider_id,
        artist COLLATE NOCASE,
        song COLLATE NOCASE
    `.execute(database),
  ]);

  const playlistsBySong = groupEvidenceNames(playlistResult.rows);
  const albumsBySong = groupEvidenceNames(albumResult.rows);
  const actionsBySong = groupProviderActions(actionResult.rows);
  const songs = new Map<string, FindMusicSong>();

  for (const row of chartResult.rows) {
    const key = identityKey(row.artist_normalized, row.name_normalized);
    let song = songs.get(key);
    if (!song) {
      const providerActions = actionsBySong.get(key) ?? [];
      const spotifyAction = providerActions.find(
        action => action.provider === 'spotify',
      );
      song = {
        key,
        artist: row.display_artist,
        song: row.display_song,
        playCount: Number(row.play_count ?? 0),
        playlists: playlistsBySong.get(key) ?? [],
        albums: albumsBySong.get(key) ?? [],
        spotifyUrl:
          spotifyAction?.provider === 'spotify' ? spotifyAction.url : null,
        providerActions,
        inAppleMusicLibrary: Boolean(row.in_apple_music_library),
        hasInstalledChart: Boolean(row.is_song_installed),
        charts: [],
      };
      songs.set(key, song);
    }
    song.charts.push(toChart(row));
  }

  return [...songs.values()];
}

function groupProviderActions(rows: readonly ProviderActionRow[]) {
  const grouped = new Map<string, FindMusicProviderAction[]>();
  const seenBySong = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = identityKey(row.artist_normalized, row.name_normalized);
    const actionKey = `${row.provider}:${row.provider_id}`;
    const seen = seenBySong.get(key) ?? new Set<string>();
    if (seen.has(actionKey)) continue;
    seen.add(actionKey);
    seenBySong.set(key, seen);
    const actions = grouped.get(key) ?? [];
    actions.push(
      row.provider === 'spotify'
        ? {
            provider: 'spotify',
            trackId: row.provider_id,
            url: `https://open.spotify.com/track/${row.provider_id}`,
            artist: row.artist,
            song: row.song,
          }
        : {
            provider: 'appleMusic',
            catalogId: row.provider_id,
            artist: row.artist,
            song: row.song,
          },
    );
    grouped.set(key, actions);
  }
  return grouped;
}

function groupEvidenceNames(rows: readonly EvidenceNameRow[]) {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const key = identityKey(row.artist_normalized, row.name_normalized);
    const names = grouped.get(key) ?? [];
    if (!names.includes(row.evidence_name)) names.push(row.evidence_name);
    grouped.set(key, names);
  }
  return grouped;
}

/**
 * Suggests charted songs by artists with history or saved-library affinity,
 * excluding every song already represented by a direct source. The limit
 * applies to song identities, never individual chart variants.
 */
type RadarCandidateSummaryRow = {
  artist_normalized: string;
  name_normalized: string;
  display_artist: string;
  display_song: string;
  artist_play_count: number | bigint;
  saved_library_song_count: number | bigint;
  chart_count: number | bigint;
  available_instrument_count: number | bigint;
};

type RankedRadarCandidate = RadarCandidateSummary & {
  artistNormalized: string;
  nameNormalized: string;
};

export async function getRadarSongs(
  db?: Kysely<DB>,
  limit = DEFAULT_RADAR_LIMIT,
): Promise<RadarSong[]> {
  const database = await resolveDb(db);
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (safeLimit === 0) return [];

  const candidateResult = await sql<RadarCandidateSummaryRow>`
    WITH ${currentChorusChartsCte()},
    current_spotify_track_ids AS (
      SELECT link.track_id
      FROM spotify_playlist_tracks AS link
      INNER JOIN spotify_playlists AS playlist ON playlist.id = link.playlist_id
      UNION
      SELECT link.track_id
      FROM spotify_album_tracks AS link
      INNER JOIN spotify_albums AS album ON album.id = link.album_id
    ),
    current_spotify_tracks AS (
      SELECT track.*
      FROM current_spotify_track_ids AS current
      INNER JOIN spotify_tracks AS track ON track.id = current.track_id
    ),
    active_apple_tracks AS (
      SELECT track.*
      FROM apple_music_tracks AS track
      INNER JOIN apple_music_library_state AS state
        ON state.id = 1 AND state.active_scan_id = track.scan_id
    ),
    history_artist_affinity AS (
      SELECT artist_normalized, SUM(play_count) AS artist_play_count
      FROM spotify_history
      WHERE artist_normalized <> ''
      GROUP BY artist_normalized
    ),
    saved_library_songs AS (
      SELECT artist_normalized, name_normalized
      FROM current_spotify_tracks
      WHERE artist_normalized IS NOT NULL
        AND name_normalized IS NOT NULL
        AND artist_normalized <> ''
        AND name_normalized <> ''

      UNION

      SELECT artist_normalized, name_normalized
      FROM active_apple_tracks
      WHERE artist_normalized <> '' AND name_normalized <> ''
    ),
    saved_library_affinity AS (
      SELECT artist_normalized, COUNT(*) AS saved_library_song_count
      FROM saved_library_songs
      GROUP BY artist_normalized
    ),
    eligible_artists AS (
      SELECT artist_normalized FROM history_artist_affinity
      UNION
      SELECT artist_normalized FROM saved_library_affinity
    ),
    artist_signals AS (
      SELECT
        eligible.artist_normalized,
        COALESCE(history.artist_play_count, 0) AS artist_play_count,
        COALESCE(saved.saved_library_song_count, 0) AS saved_library_song_count
      FROM eligible_artists AS eligible
      LEFT JOIN history_artist_affinity AS history
        ON history.artist_normalized = eligible.artist_normalized
      LEFT JOIN saved_library_affinity AS saved
        ON saved.artist_normalized = eligible.artist_normalized
    ),
    direct_songs AS (
      SELECT artist_normalized, name_normalized
      FROM spotify_history
      WHERE artist_normalized <> '' AND name_normalized <> ''

      UNION

      SELECT artist_normalized, name_normalized
      FROM current_spotify_tracks
      WHERE artist_normalized IS NOT NULL
        AND name_normalized IS NOT NULL
        AND artist_normalized <> ''
        AND name_normalized <> ''

      UNION

      SELECT artist_normalized, name_normalized
      FROM active_apple_tracks
      WHERE artist_normalized <> '' AND name_normalized <> ''

      UNION

      SELECT artist_normalized, song_normalized AS name_normalized
      FROM local_charts
      WHERE artist_normalized IS NOT NULL
        AND song_normalized IS NOT NULL
        AND artist_normalized <> ''
        AND song_normalized <> ''
    )
    SELECT
      chart.artist_normalized,
      chart.name_normalized,
      MIN(chart.artist) AS display_artist,
      MIN(chart.name) AS display_song,
      signals.artist_play_count,
      signals.saved_library_song_count,
      COUNT(DISTINCT CASE
        WHEN chart.group_id = 0 THEN 'md5:' || chart.md5
        ELSE 'group:' || chart.group_id
      END) AS chart_count,
      (
        MAX(CASE WHEN chart.has_guitar = 1
          THEN 1 ELSE 0 END) +
        MAX(CASE WHEN chart.has_bass = 1
          THEN 1 ELSE 0 END) +
        MAX(CASE WHEN chart.has_keys = 1
          THEN 1 ELSE 0 END) +
        MAX(CASE WHEN chart.has_drums = 1
          THEN 1 ELSE 0 END)
      ) AS available_instrument_count,
      MAX(CASE
        WHEN chart.modified_time GLOB '[0-9][0-9][0-9][0-9]-*'
          THEN CAST(SUBSTR(chart.modified_time, 1, 4) AS INTEGER)
        ELSE 0
      END) AS newest_chart_year
    FROM current_chorus_charts AS chart
    INNER JOIN artist_signals AS signals
      ON signals.artist_normalized = chart.artist_normalized
    WHERE chart.name_normalized IS NOT NULL
      AND chart.artist_normalized IS NOT NULL
      AND chart.name_normalized <> ''
      AND chart.artist_normalized <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM direct_songs AS direct
        WHERE direct.artist_normalized = chart.artist_normalized
          AND direct.name_normalized = chart.name_normalized
      )
      AND NOT EXISTS (
        SELECT 1
        FROM radar_dismissed AS dismissed
        WHERE dismissed.artist_normalized = chart.artist_normalized
          AND (
            dismissed.name_normalized = ''
            OR dismissed.name_normalized = chart.name_normalized
          )
      )
    GROUP BY
      chart.artist_normalized,
      chart.name_normalized,
      signals.artist_play_count,
      signals.saved_library_song_count
  `.execute(database);

  const candidates: RankedRadarCandidate[] = candidateResult.rows.map(row => ({
    key: identityKey(row.artist_normalized, row.name_normalized),
    artist: row.display_artist,
    song: row.display_song,
    artistPlayCount: Number(row.artist_play_count ?? 0),
    savedLibrarySongCount: Number(row.saved_library_song_count ?? 0),
    chartCount: Number(row.chart_count ?? 0),
    availableInstrumentCount: Number(row.available_instrument_count ?? 0),
    artistNormalized: row.artist_normalized,
    nameNormalized: row.name_normalized,
  }));
  const winners = capPerArtist(
    sortRadarCandidateSummaries(candidates),
    MAX_RADAR_SONGS_PER_ARTIST,
    candidate => candidate.artistNormalized,
  ).slice(0, safeLimit);
  if (winners.length === 0) return [];

  const chartRows: ChartRow[] = [];
  const winnerBatchSize = 400;
  for (let offset = 0; offset < winners.length; offset += winnerBatchSize) {
    const winnerBatch = winners.slice(offset, offset + winnerBatchSize);
    const winnerValues = sql.join(
      winnerBatch.map(
        candidate =>
          sql`(${candidate.artistNormalized}, ${candidate.nameNormalized})`,
      ),
      sql`, `,
    );
    const chartResult = await sql<ChartRow>`
      WITH ${currentChorusChartsCte()},
      winning_songs(artist_normalized, name_normalized) AS (
        VALUES ${winnerValues}
      )
      SELECT
        winner.artist_normalized,
        winner.name_normalized,
        chart.md5,
        chart.artist AS chart_artist,
        chart.name AS chart_name,
        chart.charter,
        chart.modified_time,
        chart.album_art_md5,
        chart.group_id,
        chart.has_video_background,
        chart.diff_guitar,
        chart.diff_bass,
        chart.diff_keys,
        chart.diff_drums,
        chart.has_guitar,
        chart.has_bass,
        chart.has_keys,
        chart.has_drums,
        chart.has_other_instruments,
        chart.drum_type,
        CASE WHEN EXISTS (
          SELECT 1
          FROM local_charts AS local
          WHERE local.artist_normalized = chart.artist_normalized
            AND local.song_normalized = chart.name_normalized
            AND local.charter_normalized = chart.charter_normalized
        ) THEN 1 ELSE 0 END AS is_installed,
        CASE WHEN EXISTS (
          SELECT 1
          FROM local_charts AS local_song
          WHERE local_song.artist_normalized = chart.artist_normalized
            AND local_song.song_normalized = chart.name_normalized
        ) THEN 1 ELSE 0 END AS is_song_installed
      FROM winning_songs AS winner
      INNER JOIN current_chorus_charts AS chart
        ON chart.artist_normalized = winner.artist_normalized
        AND chart.name_normalized = winner.name_normalized
      ORDER BY
        winner.artist_normalized,
        winner.name_normalized,
        chart.modified_time DESC,
        chart.md5
    `.execute(database);
    chartRows.push(...chartResult.rows);
  }

  const songs = new Map<string, RadarSong>(
    winners.map(candidate => [
      candidate.key,
      {
        key: candidate.key,
        artist: candidate.artist,
        song: candidate.song,
        artistPlayCount: candidate.artistPlayCount,
        savedLibrarySongCount: candidate.savedLibrarySongCount,
        chartCount: candidate.chartCount,
        availableInstrumentCount: candidate.availableInstrumentCount,
        spotifyUrl: null,
        hasInstalledChart: false,
        charts: [],
      },
    ]),
  );
  for (const row of chartRows) {
    const key = identityKey(row.artist_normalized, row.name_normalized);
    const song = songs.get(key);
    if (!song) continue;
    song.hasInstalledChart ||= Boolean(row.is_song_installed);
    song.charts.push(toChart(row));
  }

  return winners.map(candidate => songs.get(candidate.key)!);
}

/**
 * Recommendations are ordered deterministically, so without negative feedback
 * the same rows sit at the top of the list forever. A dismissal with no song
 * covers the whole artist.
 */
export async function dismissRadarSong(
  key: string,
  scope: 'song' | 'artist',
  db?: Kysely<DB>,
): Promise<void> {
  const [artistNormalized, nameNormalized] = key.split(IDENTITY_SEPARATOR);
  if (!artistNormalized) return;
  const database = await resolveDb(db);
  await database
    .insertInto('radar_dismissed')
    .values({
      artist_normalized: artistNormalized,
      name_normalized: scope === 'artist' ? '' : (nameNormalized ?? ''),
      dismissed_at: new Date().toISOString(),
    })
    .onConflict(oc =>
      oc.columns(['artist_normalized', 'name_normalized']).doNothing(),
    )
    .execute();
}

type StatsRow = {
  history_songs: number | bigint;
  playlists: number | bigint;
  albums: number | bigint;
  library_tracks: number | bigint;
  spotify_library_tracks: number | bigint;
  apple_music_library_tracks: number | bigint;
  chorus_charts: number | bigint;
  local_charts: number | bigint;
  library_updated_at: string | null;
  spotify_library_updated_at: string | null;
  apple_music_library_updated_at: string | null;
  apple_music_storefront: string | null;
  local_updated_at: string | null;
};

export async function getFindMusicStats(
  db?: Kysely<DB>,
): Promise<FindMusicStats> {
  const database = await resolveDb(db);
  const queryResult = await sql<StatsRow>`
    WITH current_spotify_track_ids AS (
      SELECT link.track_id
      FROM spotify_playlist_tracks AS link
      INNER JOIN spotify_playlists AS playlist ON playlist.id = link.playlist_id
      UNION
      SELECT link.track_id
      FROM spotify_album_tracks AS link
      INNER JOIN spotify_albums AS album ON album.id = link.album_id
    ),
    current_spotify_tracks AS (
      SELECT track.*
      FROM current_spotify_track_ids AS current
      INNER JOIN spotify_tracks AS track ON track.id = current.track_id
    ),
    active_apple_tracks AS (
      SELECT track.*
      FROM apple_music_tracks AS track
      INNER JOIN apple_music_library_state AS state
        ON state.id = 1 AND state.active_scan_id = track.scan_id
    ),
    provider_stats AS (
      SELECT
        (SELECT COUNT(*) FROM current_spotify_tracks) AS spotify_library_tracks,
        (SELECT COUNT(*) FROM active_apple_tracks) AS apple_music_library_tracks,
        (
          SELECT MAX(updated_at) FROM (
            SELECT updated_at FROM current_spotify_tracks
            UNION ALL SELECT updated_at FROM spotify_playlists
            UNION ALL SELECT updated_at FROM spotify_albums
          )
        ) AS spotify_library_updated_at,
        (
          SELECT updated_at
          FROM apple_music_library_state
          WHERE id = 1
        ) AS apple_music_library_updated_at,
        (
          SELECT storefront
          FROM apple_music_library_state
          WHERE id = 1
        ) AS apple_music_storefront
    )
    SELECT
      (SELECT COUNT(*) FROM spotify_history) AS history_songs,
      (SELECT COUNT(*) FROM spotify_playlists) AS playlists,
      (SELECT COUNT(*) FROM spotify_albums) AS albums,
      spotify_library_tracks + apple_music_library_tracks AS library_tracks,
      spotify_library_tracks,
      apple_music_library_tracks,
      (SELECT COUNT(*) FROM chorus_charts) AS chorus_charts,
      (SELECT COUNT(*) FROM local_charts) AS local_charts,
      (
        SELECT MAX(updated_at) FROM (
          SELECT spotify_library_updated_at AS updated_at
          UNION ALL SELECT apple_music_library_updated_at
        )
      ) AS library_updated_at,
      spotify_library_updated_at,
      apple_music_library_updated_at,
      apple_music_storefront,
      (SELECT MAX(updated_at) FROM local_charts) AS local_updated_at
    FROM provider_stats
  `.execute(database);
  const result = queryResult.rows[0];

  return {
    historySongs: Number(result?.history_songs ?? 0),
    playlists: Number(result?.playlists ?? 0),
    albums: Number(result?.albums ?? 0),
    libraryTracks: Number(result?.library_tracks ?? 0),
    spotifyLibraryTracks: Number(result?.spotify_library_tracks ?? 0),
    appleMusicLibraryTracks: Number(result?.apple_music_library_tracks ?? 0),
    chorusCharts: Number(result?.chorus_charts ?? 0),
    localCharts: Number(result?.local_charts ?? 0),
    // The current history table deliberately has no ingestion timestamp.
    historyUpdatedAt: null,
    libraryUpdatedAt: result?.library_updated_at ?? null,
    spotifyLibraryUpdatedAt: result?.spotify_library_updated_at ?? null,
    appleMusicLibraryUpdatedAt: result?.apple_music_library_updated_at ?? null,
    appleMusicStorefront: result?.apple_music_storefront ?? null,
    localUpdatedAt: result?.local_updated_at ?? null,
  };
}
