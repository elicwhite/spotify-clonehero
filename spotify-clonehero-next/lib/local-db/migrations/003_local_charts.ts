import type {Kysely, Migration} from 'kysely';

export const migration_003_local_charts: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .createTable('local_charts')
      .ifNotExists()
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('artist', 'text', col => col.notNull())
      .addColumn('song', 'text', col => col.notNull())
      .addColumn('charter', 'text', col => col.notNull())
      .addColumn('modified_time', 'text', col => col.notNull())
      .addColumn('data', 'text', col => col.notNull())
      .addColumn('updated_at', 'text', col => col.notNull())
      .addUniqueConstraint('local_charts_artist_song_charter_unique', [
        'artist',
        'song',
        'charter',
      ])
      .execute();
  },

  async down(db: Kysely<any>) {
    await db.schema.dropTable('local_charts').execute();
  },
};
