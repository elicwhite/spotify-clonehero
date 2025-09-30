import {type Kysely, type Migration} from 'kysely';
import {recalculateTrackChartMatches} from '../queries';

export const migration_007_add_track_chart_matches: Migration = {
  async up(db: Kysely<any>) {
    // Create the spotify_track_chart_matches table
    await db.schema
      .createTable('spotify_track_chart_matches')
      .ifNotExists()
      .addColumn('spotify_id', 'text', cb => cb.notNull())
      .addColumn('chart_md5', 'text', cb => cb.notNull())
      .addColumn('matched_at', 'integer', cb => cb.notNull().defaultTo(0))
      .addPrimaryKeyConstraint('spotify_track_chart_matches_pk', [
        'spotify_id',
        'chart_md5',
      ])
      .addForeignKeyConstraint(
        'stcm_spotify_id_fk',
        ['spotify_id'],
        'spotify_tracks',
        ['id'],
        cb => cb.onDelete('cascade'),
      )
      .addForeignKeyConstraint(
        'stcm_chart_md5_fk',
        ['chart_md5'],
        'chorus_charts',
        ['md5'],
        cb => cb.onDelete('cascade'),
      )
      .execute();

    // Create indexes for better query performance
    await db.schema
      .createIndex('idx_spotify_track_chart_matches_spotify_id')
      .ifNotExists()
      .on('spotify_track_chart_matches')
      .column('spotify_id')
      .execute();

    await db.schema
      .createIndex('idx_spotify_track_chart_matches_chart_md5')
      .ifNotExists()
      .on('spotify_track_chart_matches')
      .column('chart_md5')
      .execute();

    await db.schema
      .createIndex('idx_spotify_track_chart_matches_matched_at')
      .ifNotExists()
      .on('spotify_track_chart_matches')
      .column('matched_at')
      .execute();

    // Populate the table with existing matches based on normalized artist and name
    await recalculateTrackChartMatches(db);
  },

  async down(db: Kysely<any>) {
    // Drop indexes first
    await db.schema
      .dropIndex('idx_spotify_track_chart_matches_spotify_id')
      .ifExists()
      .execute();

    await db.schema
      .dropIndex('idx_spotify_track_chart_matches_chart_md5')
      .ifExists()
      .execute();

    await db.schema
      .dropIndex('idx_spotify_track_chart_matches_matched_at')
      .ifExists()
      .execute();

    // Drop the table
    await db.schema.dropTable('spotify_track_chart_matches').execute();
  },
};
