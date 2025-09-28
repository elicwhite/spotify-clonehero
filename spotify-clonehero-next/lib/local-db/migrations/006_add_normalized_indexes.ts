import {type Kysely, type Migration} from 'kysely';

export const migration_006_add_normalized_indexes: Migration = {
  async up(db: Kysely<any>) {
    // Add index on chorus_charts normalized columns
    await db.schema
      .createIndex('idx_chorus_charts_artist_name_normalized')
      .on('chorus_charts')
      .columns(['artist_normalized', 'name_normalized'])
      .execute();

    // Add index on spotify_tracks normalized columns
    await db.schema
      .createIndex('idx_spotify_tracks_artist_name_normalized')
      .on('spotify_tracks')
      .columns(['artist_normalized', 'name_normalized'])
      .execute();

    // Add index on artist_bucket for both tables for efficient bucketing
    await db.schema
      .createIndex('idx_chorus_charts_artist_bucket')
      .on('chorus_charts')
      .column('artist_bucket')
      .execute();

    await db.schema
      .createIndex('idx_spotify_tracks_artist_bucket')
      .on('spotify_tracks')
      .column('artist_bucket')
      .execute();
  },

  async down(db: Kysely<any>) {
    // Drop indexes
    await db.schema
      .dropIndex('idx_chorus_charts_artist_name_normalized')
      .ifExists()
      .execute();

    await db.schema
      .dropIndex('idx_spotify_tracks_artist_name_normalized')
      .ifExists()
      .execute();

    await db.schema
      .dropIndex('idx_chorus_charts_artist_bucket')
      .ifExists()
      .execute();

    await db.schema
      .dropIndex('idx_spotify_tracks_artist_bucket')
      .ifExists()
      .execute();
  },
};
