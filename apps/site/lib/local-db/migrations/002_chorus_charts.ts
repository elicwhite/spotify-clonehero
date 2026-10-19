import {Kysely, sql} from 'kysely';

export const migration_002_chorus_charts = {
  async up(db: Kysely<any>): Promise<void> {
    // Create chorus_charts table
    await db.schema
      .createTable('chorus_charts')
      .ifNotExists()
      .addColumn('md5', 'text', col => col.primaryKey())
      .addColumn('name', 'text', col => col.notNull())
      .addColumn('artist', 'text', col => col.notNull())
      .addColumn('charter', 'text', col => col.notNull())
      .addColumn('diff_drums', 'integer')
      .addColumn('diff_guitar', 'integer')
      .addColumn('diff_bass', 'integer')
      .addColumn('diff_keys', 'integer')
      .addColumn('diff_drums_real', 'integer')
      .addColumn('modified_time', 'text', col => col.notNull())
      .addColumn('song_length', 'integer')
      .addColumn('has_video_background', 'boolean', col =>
        col.notNull().defaultTo(false),
      )
      .addColumn('album_art_md5', 'text')
      .addColumn('group_id', 'integer', col => col.notNull())
      .execute();

    // Create chorus_scan_sessions table
    await db.schema
      .createTable('chorus_scan_sessions')
      .ifNotExists()
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('status', 'text', col => col.notNull())
      .addColumn('started_at', 'text', col => col.notNull())
      .addColumn('scan_since_time', 'text', col => col.notNull())
      .addColumn('completed_at', 'text')
      .addColumn('last_chart_id', 'integer')
      .execute();

    // Create chorus_metadata table
    await db.schema
      .createTable('chorus_metadata')
      .ifNotExists()
      .addColumn('key', 'text', col => col.primaryKey())
      .addColumn('value', 'text', col => col.notNull())
      .addColumn('updated_at', 'text', col =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`),
      )
      .execute();

    // Create indexes for performance
    await db.schema
      .createIndex('idx_chorus_charts_modified_time')
      .ifNotExists()
      .on('chorus_charts')
      .column('modified_time')
      .execute();

    await db.schema
      .createIndex('idx_chorus_charts_artist_modified')
      .ifNotExists()
      .on('chorus_charts')
      .columns(['artist', 'modified_time'])
      .execute();

    await db.schema
      .createIndex('idx_chorus_charts_name_artist')
      .ifNotExists()
      .on('chorus_charts')
      .columns(['name', 'artist'])
      .execute();

    await db.schema
      .createIndex('idx_chorus_scan_sessions_status')
      .ifNotExists()
      .on('chorus_scan_sessions')
      .column('status')
      .execute();

    await db.schema
      .createIndex('idx_chorus_scan_sessions_started_at')
      .ifNotExists()
      .on('chorus_scan_sessions')
      .column('started_at')
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('chorus_charts').execute();
    await db.schema.dropTable('chorus_scan_sessions').execute();
    await db.schema.dropTable('chorus_metadata').execute();
  },
};
