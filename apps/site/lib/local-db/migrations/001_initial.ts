import type {Kysely, Migration} from 'kysely';

export const InitialMigration: Migration = {
  async up(db: Kysely<any>) {
    // spotify_playlists
    await db.schema
      .createTable('spotify_playlists')
      .ifNotExists()
      .addColumn('id', 'text', cb => cb.primaryKey().notNull())
      .addColumn('snapshot_id', 'text', cb => cb.notNull())
      .addColumn('name', 'text', cb => cb.notNull())
      .addColumn('collaborative', 'integer', cb => cb.notNull().defaultTo(0))
      .addColumn('owner_display_name', 'text', cb => cb.notNull())
      .addColumn('owner_external_url', 'text', cb => cb.notNull())
      .addColumn('total_tracks', 'integer', cb => cb.notNull().defaultTo(0))
      .addColumn('updated_at', 'text', cb => cb.notNull())
      .execute();

    // spotify_albums
    await db.schema
      .createTable('spotify_albums')
      .ifNotExists()
      .addColumn('id', 'text', cb => cb.primaryKey().notNull())
      .addColumn('name', 'text', cb => cb.notNull())
      .addColumn('artist_name', 'text', cb => cb.notNull())
      .addColumn('total_tracks', 'integer', cb => cb.notNull().defaultTo(0))
      .addColumn('updated_at', 'text', cb => cb.notNull())
      .execute();

    // spotify_tracks
    await db.schema
      .createTable('spotify_tracks')
      .ifNotExists()
      .addColumn('id', 'text', cb => cb.primaryKey().notNull())
      .addColumn('name', 'text', cb => cb.notNull())
      .addColumn('artist', 'text', cb => cb.notNull())
      .addColumn('updated_at', 'text', cb => cb.notNull())
      .execute();

    // spotify_playlist_tracks
    await db.schema
      .createTable('spotify_playlist_tracks')
      .ifNotExists()
      .addColumn('playlist_id', 'text', cb => cb.notNull())
      .addColumn('track_id', 'text', cb => cb.notNull())
      .addPrimaryKeyConstraint('spotify_playlist_tracks_pk', [
        'playlist_id',
        'track_id',
      ])
      .addForeignKeyConstraint(
        'spt_playlist_id_fk',
        ['playlist_id'],
        'spotify_playlists',
        ['id'],
        cb => cb.onDelete('cascade'),
      )
      .addForeignKeyConstraint(
        'spt_track_id_fk',
        ['track_id'],
        'spotify_tracks',
        ['id'],
        cb => cb.onDelete('cascade'),
      )
      .execute();

    // spotify_album_tracks
    await db.schema
      .createTable('spotify_album_tracks')
      .ifNotExists()
      .addColumn('album_id', 'text', cb => cb.notNull())
      .addColumn('track_id', 'text', cb => cb.notNull())
      .addColumn('updated_at', 'text', cb => cb.notNull())
      .addPrimaryKeyConstraint('spotify_album_tracks_pk', [
        'album_id',
        'track_id',
      ])
      .addForeignKeyConstraint(
        'sat_album_id_fk',
        ['album_id'],
        'spotify_albums',
        ['id'],
        cb => cb.onDelete('cascade'),
      )
      .addForeignKeyConstraint(
        'sat_track_id_fk',
        ['track_id'],
        'spotify_tracks',
        ['id'],
        cb => cb.onDelete('cascade'),
      )
      .execute();
  },
  async down(db: Kysely<any>) {
    await db.schema.dropTable('spotify_album_tracks').execute();
    await db.schema.dropTable('spotify_playlist_tracks').execute();
    await db.schema.dropTable('spotify_tracks').execute();
    await db.schema.dropTable('spotify_albums').execute();
    await db.schema.dropTable('spotify_playlists').execute();
  },
};
