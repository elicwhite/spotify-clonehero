import {sql, type Kysely} from 'kysely';
import type {ChorusCharts, DB, SpotifyPlaylists} from '../types';

export type PickedChorusChartRow = Pick<
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

export type PickedSpotifyPlaylistRow = Pick<
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

export type HistoryRecommendationRow = {
  artist: string;
  song: string;
  play_count: number;
  is_any_local_chart_installed: number;
  matching_charts: PickedChorusChartRow[];
  playlist_memberships: PickedSpotifyPlaylistRow[];
};

/**
 * Cross-references the user's Spotify listening history against the Chorus
 * chart catalog and (optionally) the local install + playlist memberships.
 *
 * Returns one row per history song that has at least one matching Chorus
 * chart. `matching_charts` and `playlist_memberships` arrive as parsed JSON
 * arrays (Kysely's ParseJSONResultsPlugin handles json_group_array output).
 */
export async function getHistoryRecommendations(
  db: Kysely<DB>,
): Promise<HistoryRecommendationRow[]> {
  return await db
    // chart_aggregates: one JSON array of charts per history song
    .with('chart_aggregates', qb =>
      qb
        .selectFrom(sub =>
          sub
            .selectFrom('spotify_history as h')
            .innerJoin('chorus_charts as chart', join =>
              join
                .onRef('chart.artist_normalized', '=', 'h.artist_normalized')
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
          sql<PickedChorusChartRow[]>`
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

    // playlist_aggregates: one JSON array of playlists per history song
    .with('playlist_aggregates', qb =>
      qb
        .selectFrom(sub =>
          sub
            .selectFrom('spotify_history as h')
            .innerJoin('spotify_tracks as st', join =>
              join
                .onRef('st.artist_normalized', '=', 'h.artist_normalized')
                .onRef('st.name_normalized', '=', 'h.name_normalized'),
            )
            .innerJoin(
              'spotify_playlist_tracks as plt',
              'plt.track_id',
              'st.id',
            )
            .innerJoin(
              'spotify_playlists as playlist',
              'playlist.id',
              'plt.playlist_id',
            )
            .select([
              'h.artist_normalized',
              'h.name_normalized',
              'playlist.id as playlist_id',
              'playlist.snapshot_id as snapshot_id',
              'playlist.name as name',
              'playlist.collaborative as collaborative',
              'playlist.owner_display_name as owner_display_name',
              'playlist.owner_external_url as owner_external_url',
              'playlist.total_tracks as total_tracks',
              'playlist.updated_at as updated_at',
            ])
            .groupBy([
              'h.artist_normalized',
              'h.name_normalized',
              'playlist.id',
            ])
            .as('deduped_playlists'),
        )
        .select([
          'deduped_playlists.artist_normalized',
          'deduped_playlists.name_normalized',
          sql<PickedSpotifyPlaylistRow[]>`
          json_group_array(
            json_object(
              'id',                ${sql.ref('deduped_playlists.playlist_id')},
              'snapshot_id',       ${sql.ref('deduped_playlists.snapshot_id')},
              'name',              ${sql.ref('deduped_playlists.name')},
              'collaborative',     ${sql.ref('deduped_playlists.collaborative')},
              'owner_display_name',${sql.ref('deduped_playlists.owner_display_name')},
              'owner_external_url',${sql.ref('deduped_playlists.owner_external_url')},
              'total_tracks',      ${sql.ref('deduped_playlists.total_tracks')},
              'updated_at',        ${sql.ref('deduped_playlists.updated_at')}
            )
          )
        `.as('playlist_memberships'),
        ])
        .groupBy([
          'deduped_playlists.artist_normalized',
          'deduped_playlists.name_normalized',
        ]),
    )

    // local_chart_flags: song-level installed flag
    .with('local_chart_flags', qb =>
      qb
        .selectFrom('spotify_history as h')
        .innerJoin('chorus_charts as chart', join =>
          join
            .onRef('chart.artist_normalized', '=', 'h.artist_normalized')
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
        .onRef('chart_data.artist_normalized', '=', 'h.artist_normalized')
        .onRef('chart_data.name_normalized', '=', 'h.name_normalized'),
    )
    .leftJoin('playlist_aggregates as playlist_data', join =>
      join
        .onRef('playlist_data.artist_normalized', '=', 'h.artist_normalized')
        .onRef('playlist_data.name_normalized', '=', 'h.name_normalized'),
    )
    .leftJoin('local_chart_flags as installed_flag', join =>
      join
        .onRef('installed_flag.artist_normalized', '=', 'h.artist_normalized')
        .onRef('installed_flag.name_normalized', '=', 'h.name_normalized'),
    )
    .select([
      'h.artist',
      sql<string>`h.name`.as('song'),
      'h.play_count',
      sql<number>`COALESCE(installed_flag.is_any_local_chart_installed, 0)`.as(
        'is_any_local_chart_installed',
      ),
      sql<PickedChorusChartRow[]>`chart_data.matching_charts`.as(
        'matching_charts',
      ),
      sql<
        PickedSpotifyPlaylistRow[]
      >`COALESCE(playlist_data.playlist_memberships, json('[]'))`.as(
        'playlist_memberships',
      ),
    ])
    .where('h.artist', '!=', '')
    .where('h.name', '!=', '')
    .orderBy('h.play_count', 'desc')
    .execute();
}
