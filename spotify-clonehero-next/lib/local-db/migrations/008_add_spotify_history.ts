import {type Kysely, type Migration} from 'kysely';

export const migration_008_add_spotify_history: Migration = {
  async up(db: Kysely<any>) {
    // Create the spotify_history table
    await db.schema
      .createTable('spotify_history')
      .ifNotExists()
      .addColumn('artist', 'text', cb => cb.notNull())
      .addColumn('artist_normalized', 'text', cb => cb.notNull())
      .addColumn('name', 'text', cb => cb.notNull())
      .addColumn('name_normalized', 'text', cb => cb.notNull())
      .addColumn('play_count', 'integer', cb => cb.notNull().defaultTo(0))
      .addPrimaryKeyConstraint('spotify_history_pk', ['artist', 'name'])
      .execute();

    // Create indexes for better query performance
    await db.schema
      .createIndex('idx_spotify_history_artist_normalized')
      .ifNotExists()
      .on('spotify_history')
      .column('artist_normalized')
      .execute();

    await db.schema
      .createIndex('idx_spotify_history_name_normalized')
      .ifNotExists()
      .on('spotify_history')
      .column('name_normalized')
      .execute();
  },

  async down(db: Kysely<any>) {
    // Drop indexes first
    await db.schema
      .dropIndex('idx_spotify_history_artist_normalized')
      .ifExists()
      .execute();

    await db.schema
      .dropIndex('idx_spotify_history_name_normalized')
      .ifExists()
      .execute();

    // Drop the table
    await db.schema.dropTable('spotify_history').execute();
  },
};
