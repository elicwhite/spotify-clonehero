import {Kysely, sql} from 'kysely';

export const migration_002_chorus_charts = {
  async up(db: Kysely<any>): Promise<void> {
    // Create chorus_charts table
    await db.schema
      .createTable('chorus_charts')
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
      .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
      .addColumn('session_id', 'text', col => col.notNull().unique())
      .addColumn('status', 'text', col => col.notNull())
      .addColumn('started_at', 'text', col => col.notNull())
      .addColumn('completed_at', 'text')
      .addColumn('total_songs_to_fetch', 'integer')
      .addColumn('total_songs_found', 'integer')
      .addColumn('total_charts_found', 'integer')
      .addColumn('last_chart_id', 'integer')
      .addColumn('data_version', 'integer', col => col.notNull())
      .addColumn('error_message', 'text')
      .addColumn('created_at', 'text', col =>
        col.notNull().defaultTo(sql`datetime('now')`),
      )
      .execute();

    // Create chorus_metadata table
    await db.schema
      .createTable('chorus_metadata')
      .addColumn('key', 'text', col => col.primaryKey())
      .addColumn('value', 'text', col => col.notNull())
      .addColumn('updated_at', 'text', col =>
        col.notNull().defaultTo(sql`datetime('now')`),
      )
      .execute();

    // Create indexes for performance
    await db.schema
      .createIndex('idx_chorus_charts_modified_time')
      .on('chorus_charts')
      .column('modified_time')
      .execute();

    await db.schema
      .createIndex('idx_chorus_charts_artist_modified')
      .on('chorus_charts')
      .columns(['artist', 'modified_time'])
      .execute();

    await db.schema
      .createIndex('idx_chorus_charts_name_artist')
      .on('chorus_charts')
      .columns(['name', 'artist'])
      .execute();

    await db.schema
      .createIndex('idx_chorus_scan_sessions_status')
      .on('chorus_scan_sessions')
      .column('status')
      .execute();

    await db.schema
      .createIndex('idx_chorus_scan_sessions_started_at')
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
