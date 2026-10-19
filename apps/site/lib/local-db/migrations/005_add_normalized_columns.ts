import {sql, type Kysely, type Migration} from 'kysely';

export const migration_005_add_normalized_columns: Migration = {
  async up(db: Kysely<any>) {
    // Add normalized columns to chorus_charts
    await db.schema
      .alterTable('chorus_charts')
      .addColumn('artist_normalized', 'text')
      .execute();

    await db.schema
      .alterTable('chorus_charts')
      .addColumn('charter_normalized', 'text')
      .execute();

    await db.schema
      .alterTable('chorus_charts')
      .addColumn('name_normalized', 'text')
      .execute();

    // Add artist_bucket generated column to chorus_charts
    await db.schema
      .alterTable('chorus_charts')
      .addColumn('artist_bucket', 'text', col =>
        col.generatedAlwaysAs(sql`substr(artist_normalized,1,1)`),
      )
      .execute();

    // Add normalized columns to spotify_tracks
    await db.schema
      .alterTable('spotify_tracks')
      .addColumn('artist_normalized', 'text')
      .execute();

    await db.schema
      .alterTable('spotify_tracks')
      .addColumn('name_normalized', 'text')
      .execute();

    // Add artist_bucket generated column to spotify_tracks
    await db.schema
      .alterTable('spotify_tracks')
      .addColumn('artist_bucket', 'text', col =>
        col.generatedAlwaysAs(sql`substr(artist_normalized,1,1)`),
      )
      .execute();

    await sql`
      UPDATE chorus_charts 
      SET artist_normalized = normalize(artist),
          charter_normalized = normalize(charter),
          name_normalized = normalize(name)
      WHERE artist_normalized IS NULL;
    `.execute(db);

    await sql`
      UPDATE spotify_tracks 
      SET artist_normalized = normalize(artist),
          name_normalized = normalize(name)
      WHERE artist_normalized IS NULL;
    `.execute(db);
  },

  async down(db: Kysely<any>) {
    // Drop normalized columns from chorus_charts
    await db.schema
      .alterTable('chorus_charts')
      .dropColumn('artist_bucket')
      .execute();

    await db.schema
      .alterTable('chorus_charts')
      .dropColumn('artist_normalized')
      .execute();

    await db.schema
      .alterTable('chorus_charts')
      .dropColumn('charter_normalized')
      .execute();

    await db.schema
      .alterTable('chorus_charts')
      .dropColumn('name_normalized')
      .execute();

    // Drop normalized columns from spotify_tracks
    await db.schema
      .alterTable('spotify_tracks')
      .dropColumn('artist_bucket')
      .execute();

    await db.schema
      .alterTable('spotify_tracks')
      .dropColumn('artist_normalized')
      .execute();

    await db.schema
      .alterTable('spotify_tracks')
      .dropColumn('name_normalized')
      .execute();
  },
};
