import {sql, type Kysely, type Migration} from 'kysely';
import {normalizeStrForMatching} from '../normalize';

export const migration_004_local_charts_normalized: Migration = {
  async up(db: Kysely<any>) {
    // Add normalized columns
    await db.schema
      .alterTable('local_charts')
      .addColumn('artist_normalized', 'text')
      .execute();

    await db.schema
      .alterTable('local_charts')
      .addColumn('song_normalized', 'text')
      .execute();

    await db.schema
      .alterTable('local_charts')
      .addColumn('charter_normalized', 'text')
      .execute();

    await db.schema
      .alterTable('local_charts')
      .addColumn('artist_bucket', 'text', col =>
        col.generatedAlwaysAs(sql`substr(artist_normalized,1,1)`),
      )
      .execute();

    // Populate normalized columns in batches of 50
    const BATCH_SIZE = 50;
    let hasMore = true;

    while (hasMore) {
      const rows = await db
        .selectFrom('local_charts')
        .select(['id', 'artist', 'song', 'charter'])
        .where('artist_normalized', 'is', null)
        .limit(BATCH_SIZE)
        .execute();

      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      // Update each row with normalized values
      for (const row of rows) {
        console.log();
        await db
          .updateTable('local_charts')
          .set({
            artist_normalized: normalizeStrForMatching(row.artist),
            song_normalized: normalizeStrForMatching(row.song),
            charter_normalized: normalizeStrForMatching(row.charter),
          })
          .where('id', '=', row.id)
          .execute();
      }
    }

    // Create indexes
    await db.schema
      .createIndex('idx_local_charts_artist_song_normalized')
      .on('local_charts')
      .columns(['artist_normalized', 'song_normalized'])
      .execute();

    await db.schema
      .createIndex('idx_local_charts_artist_bucket')
      .on('local_charts')
      .column('artist_bucket')
      .execute();
  },

  async down(db: Kysely<any>) {
    // Drop indexes
    await db.schema
      .dropIndex('idx_local_charts_artist_song_normalized')
      .ifExists()
      .execute();

    await db.schema
      .dropIndex('idx_local_charts_artist_bucket')
      .ifExists()
      .execute();

    // Drop columns
    await db.schema
      .alterTable('local_charts')
      .dropColumn('artist_bucket')
      .execute();

    await db.schema
      .alterTable('local_charts')
      .dropColumn('artist_normalized')
      .execute();

    await db.schema
      .alterTable('local_charts')
      .dropColumn('song_normalized')
      .execute();

    await db.schema
      .alterTable('local_charts')
      .dropColumn('charter_normalized')
      .execute();
  },
};
