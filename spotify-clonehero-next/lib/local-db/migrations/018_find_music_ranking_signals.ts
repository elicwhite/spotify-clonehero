import {type Kysely, type Migration} from 'kysely';

export const migration_018_find_music_ranking_signals: Migration = {
  async up(db: Kysely<any>) {
    // When a chart first entered this browser's mirror. Chorus's modified_time
    // moves whenever a charter re-uploads, so it cannot answer "new to the
    // catalog". Existing rows stay null rather than claiming today's date.
    await db.schema
      .alterTable('chorus_charts')
      .addColumn('first_seen', 'text')
      .execute();

    // Playback detail the history parser previously discarded. Captured now so
    // it accrues; no ranking reads it yet.
    await db.schema
      .alterTable('spotify_history')
      .addColumn('last_played_at', 'text')
      .execute();
    await db.schema
      .alterTable('spotify_history')
      .addColumn('first_played_at', 'text')
      .execute();
    await db.schema
      .alterTable('spotify_history')
      .addColumn('total_ms_played', 'integer', column =>
        column.notNull().defaultTo(0),
      )
      .execute();
    await db.schema
      .alterTable('spotify_history')
      .addColumn('skip_count', 'integer', column =>
        column.notNull().defaultTo(0),
      )
      .execute();

    // Negative feedback for the recommendations tab. An empty name_normalized
    // means the whole artist: SQLite treats NULLs as distinct in a unique
    // index, so a sentinel is what actually keeps dismissals unique.
    await db.schema
      .createTable('radar_dismissed')
      .addColumn('artist_normalized', 'text', column => column.notNull())
      .addColumn('name_normalized', 'text', column => column.notNull())
      .addColumn('dismissed_at', 'text', column => column.notNull())
      .execute();
    await db.schema
      .createIndex('idx_radar_dismissed_identity')
      .unique()
      .on('radar_dismissed')
      .columns(['artist_normalized', 'name_normalized'])
      .execute();
  },

  async down(db: Kysely<any>) {
    await db.schema.dropTable('radar_dismissed').execute();
    await db.schema
      .alterTable('spotify_history')
      .dropColumn('skip_count')
      .execute();
    await db.schema
      .alterTable('spotify_history')
      .dropColumn('total_ms_played')
      .execute();
    await db.schema
      .alterTable('spotify_history')
      .dropColumn('first_played_at')
      .execute();
    await db.schema
      .alterTable('spotify_history')
      .dropColumn('last_played_at')
      .execute();
    await db.schema
      .alterTable('chorus_charts')
      .dropColumn('first_seen')
      .execute();
  },
};
