import {sql, type Kysely, type Migration} from 'kysely';

export const migration_016_apple_music_library: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .createTable('apple_music_tracks')
      .addColumn('id', 'integer', column => column.primaryKey().notNull())
      .addColumn('scan_id', 'text', column => column.notNull())
      .addColumn('catalog_id', 'text')
      .addColumn('artist', 'text', column => column.notNull())
      .addColumn('name', 'text', column => column.notNull())
      .addColumn('artist_normalized', 'text', column => column.notNull())
      .addColumn('name_normalized', 'text', column => column.notNull())
      .addColumn('updated_at', 'text', column => column.notNull())
      .execute();
    await db.schema
      .createIndex('idx_apple_music_tracks_scan_identity')
      .on('apple_music_tracks')
      .columns(['scan_id', 'artist_normalized', 'name_normalized'])
      .execute();
    await db.schema
      .createIndex('idx_apple_music_tracks_scan_catalog')
      .on('apple_music_tracks')
      .columns(['scan_id', 'catalog_id'])
      .execute();
    await db.schema
      .createTable('apple_music_library_state')
      .addColumn('id', 'integer', column => column.primaryKey().notNull())
      .addCheckConstraint('apple_music_library_state_singleton', sql`id = 1`)
      .addColumn('connection_epoch', 'integer', column =>
        column.notNull().defaultTo(0),
      )
      .addColumn('scan_generation', 'integer', column =>
        column.notNull().defaultTo(0),
      )
      .addColumn('active_scan_id', 'text')
      .addColumn('storefront', 'text')
      .addColumn('reported_total', 'integer', column => column.notNull())
      .addColumn('fetched_count', 'integer', column => column.notNull())
      .addColumn('usable_count', 'integer', column => column.notNull())
      .addColumn('catalog_associated_count', 'integer', column =>
        column.notNull(),
      )
      .addColumn('track_count', 'integer', column => column.notNull())
      .addColumn('updated_at', 'text')
      .execute();
  },
  async down(db: Kysely<any>) {
    await db.schema.dropTable('apple_music_library_state').execute();
    await db.schema.dropTable('apple_music_tracks').execute();
  },
};
