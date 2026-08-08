import {sql, type Kysely} from 'kysely';

import type {DB} from '../../lib/local-db/types';
import type {
  FindMusicChart,
  FindMusicSong,
  FindMusicStats,
  RadarSong,
} from './types';

const IDENTITY_SEPARATOR = '\u001f';
const DEFAULT_RADAR_LIMIT = 1_200;

type ChartRow = {
  artist_normalized: string;
  name_normalized: string;
  display_artist: string;
  display_song: string;
  spotify_id?: string | null;
  play_count?: number | bigint;
  artist_play_count?: number | bigint;
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
  diff_drums_real: number | null;
  has_guitar: number | bigint | boolean;
  has_bass: number | bigint | boolean;
  has_keys: number | bigint | boolean;
  has_pro_drums: number | bigint | boolean;
  is_installed: number | bigint | boolean;
  is_song_installed: number | bigint | boolean;
};

type EvidenceNameRow = {
  artist_normalized: string;
  name_normalized: string;
  evidence_name: string;
};

function identityKey(artistNormalized: string, nameNormalized: string) {
  return `${artistNormalized}${IDENTITY_SEPARATOR}${nameNormalized}`;
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
    isInstalled: Boolean(row.is_installed),
    instruments: {
      guitar: row.diff_guitar,
      bass: row.diff_bass,
      keys: row.diff_keys,
      proDrums: row.diff_drums_real,
    },
    instrumentPresence: {
      guitar: Boolean(row.has_guitar),
      bass: Boolean(row.has_bass),
      keys: Boolean(row.has_keys),
      proDrums: Boolean(row.has_pro_drums),
    },
  };
}

/**
 * Returns every Chorus song that has direct evidence in Spotify history or the
 * Spotify library. Identity rows are collapsed before joining charts so play
 * counts are not multiplied by duplicate Spotify IDs or chart variants.
 */
export async function getFindMusicSongs(
  db?: Kysely<DB>,
): Promise<FindMusicSong[]> {
  const database = await resolveDb(db);

  const chartResult = await sql<ChartRow>`
    WITH direct_identity_rows AS (
      SELECT
        artist_normalized,
        name_normalized,
        artist,
        name AS song,
        NULL AS spotify_id,
        play_count,
        1 AS is_history
      FROM spotify_history
      WHERE artist_normalized <> '' AND name_normalized <> ''

      UNION ALL

      SELECT
        artist_normalized,
        name_normalized,
        artist,
        name AS song,
        id AS spotify_id,
        0 AS play_count,
        0 AS is_history
      FROM spotify_tracks
      WHERE artist_normalized IS NOT NULL
        AND name_normalized IS NOT NULL
        AND artist_normalized <> ''
        AND name_normalized <> ''
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
        MIN(spotify_id) AS spotify_id,
        SUM(play_count) AS play_count
      FROM direct_identity_rows
      GROUP BY artist_normalized, name_normalized
    )
    SELECT
      direct_songs.artist_normalized,
      direct_songs.name_normalized,
      direct_songs.display_artist,
      direct_songs.display_song,
      direct_songs.spotify_id,
      direct_songs.play_count,
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
      chart.diff_drums_real,
      chart.has_guitar,
      chart.has_bass,
      chart.has_keys,
      chart.has_pro_drums,
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
    INNER JOIN chorus_charts AS chart
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

  const [playlistResult, albumResult] = await Promise.all([
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
  ]);

  const playlistsBySong = groupEvidenceNames(playlistResult.rows);
  const albumsBySong = groupEvidenceNames(albumResult.rows);
  const songs = new Map<string, FindMusicSong>();

  for (const row of chartResult.rows) {
    const key = identityKey(row.artist_normalized, row.name_normalized);
    let song = songs.get(key);
    if (!song) {
      song = {
        key,
        artist: row.display_artist,
        song: row.display_song,
        playCount: Number(row.play_count ?? 0),
        playlists: playlistsBySong.get(key) ?? [],
        albums: albumsBySong.get(key) ?? [],
        spotifyUrl: row.spotify_id
          ? `https://open.spotify.com/track/${row.spotify_id}`
          : null,
        hasInstalledChart: Boolean(row.is_song_installed),
        charts: [],
      };
      songs.set(key, song);
    }
    song.charts.push(toChart(row));
  }

  return [...songs.values()];
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
 * Suggests charted songs by artists present in listening history, excluding
 * every song already represented by either direct source. The limit applies
 * to song identities, never individual chart variants.
 */
export async function getRadarSongs(
  db?: Kysely<DB>,
  limit = DEFAULT_RADAR_LIMIT,
): Promise<RadarSong[]> {
  const database = await resolveDb(db);
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) return [];

  const result = await sql<ChartRow>`
    WITH history_artist_affinity AS (
      SELECT artist_normalized, SUM(play_count) AS artist_play_count
      FROM spotify_history
      WHERE artist_normalized <> ''
      GROUP BY artist_normalized
    ),
    direct_songs AS (
      SELECT artist_normalized, name_normalized
      FROM spotify_history
      WHERE artist_normalized <> '' AND name_normalized <> ''

      UNION

      SELECT artist_normalized, name_normalized
      FROM spotify_tracks
      WHERE artist_normalized IS NOT NULL
        AND name_normalized IS NOT NULL
        AND artist_normalized <> ''
        AND name_normalized <> ''
    ),
    candidate_songs AS (
      SELECT
        chart.artist_normalized,
        chart.name_normalized,
        MIN(chart.artist) AS display_artist,
        MIN(chart.name) AS display_song,
        affinity.artist_play_count,
        COUNT(*) AS chart_count,
        MAX(chart.has_pro_drums) AS has_pro_drums,
        MAX(
          chart.has_guitar +
          chart.has_bass +
          chart.has_keys +
          chart.has_pro_drums
        ) AS instrument_coverage,
        MAX(chart.modified_time) AS latest_chart
      FROM chorus_charts AS chart
      INNER JOIN history_artist_affinity AS affinity
        ON affinity.artist_normalized = chart.artist_normalized
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
      GROUP BY
        chart.artist_normalized,
        chart.name_normalized,
        affinity.artist_play_count
    ),
    ranked_candidates AS (
      SELECT *
      FROM candidate_songs
      ORDER BY
        artist_play_count DESC,
        chart_count DESC,
        has_pro_drums DESC,
        instrument_coverage DESC,
        latest_chart DESC,
        display_artist COLLATE NOCASE,
        display_song COLLATE NOCASE
      LIMIT ${safeLimit}
    )
    SELECT
      candidate.artist_normalized,
      candidate.name_normalized,
      candidate.display_artist,
      candidate.display_song,
      candidate.artist_play_count,
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
      chart.diff_drums_real,
      chart.has_guitar,
      chart.has_bass,
      chart.has_keys,
      chart.has_pro_drums,
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
    FROM ranked_candidates AS candidate
    INNER JOIN chorus_charts AS chart
      ON chart.artist_normalized = candidate.artist_normalized
      AND chart.name_normalized = candidate.name_normalized
    ORDER BY
      candidate.artist_play_count DESC,
      candidate.chart_count DESC,
      candidate.has_pro_drums DESC,
      candidate.instrument_coverage DESC,
      candidate.latest_chart DESC,
      candidate.display_artist COLLATE NOCASE,
      candidate.display_song COLLATE NOCASE,
      chart.modified_time DESC,
      chart.md5
  `.execute(database);

  const songs = new Map<string, RadarSong>();
  for (const row of result.rows) {
    const key = identityKey(row.artist_normalized, row.name_normalized);
    let song = songs.get(key);
    if (!song) {
      song = {
        key,
        artist: row.display_artist,
        song: row.display_song,
        artistPlayCount: Number(row.artist_play_count ?? 0),
        spotifyUrl: null,
        hasInstalledChart: Boolean(row.is_song_installed),
        charts: [],
      };
      songs.set(key, song);
    }
    song.charts.push(toChart(row));
  }

  return [...songs.values()];
}

type StatsRow = {
  history_songs: number | bigint;
  playlists: number | bigint;
  albums: number | bigint;
  library_tracks: number | bigint;
  chorus_charts: number | bigint;
  local_charts: number | bigint;
  library_updated_at: string | null;
  local_updated_at: string | null;
};

export async function getFindMusicStats(
  db?: Kysely<DB>,
): Promise<FindMusicStats> {
  const database = await resolveDb(db);
  const queryResult = await sql<StatsRow>`
    SELECT
      (SELECT COUNT(*) FROM spotify_history) AS history_songs,
      (SELECT COUNT(*) FROM spotify_playlists) AS playlists,
      (SELECT COUNT(*) FROM spotify_albums) AS albums,
      (SELECT COUNT(*) FROM spotify_tracks) AS library_tracks,
      (SELECT COUNT(*) FROM chorus_charts) AS chorus_charts,
      (SELECT COUNT(*) FROM local_charts) AS local_charts,
      (
        SELECT MAX(updated_at) FROM (
          SELECT updated_at FROM spotify_tracks
          UNION ALL SELECT updated_at FROM spotify_playlists
          UNION ALL SELECT updated_at FROM spotify_albums
        )
      ) AS library_updated_at,
      (SELECT MAX(updated_at) FROM local_charts) AS local_updated_at
  `.execute(database);
  const result = queryResult.rows[0];

  return {
    historySongs: Number(result?.history_songs ?? 0),
    playlists: Number(result?.playlists ?? 0),
    albums: Number(result?.albums ?? 0),
    libraryTracks: Number(result?.library_tracks ?? 0),
    chorusCharts: Number(result?.chorus_charts ?? 0),
    localCharts: Number(result?.local_charts ?? 0),
    // The current history table deliberately has no ingestion timestamp.
    historyUpdatedAt: null,
    libraryUpdatedAt: result?.library_updated_at ?? null,
    localUpdatedAt: result?.local_updated_at ?? null,
  };
}
