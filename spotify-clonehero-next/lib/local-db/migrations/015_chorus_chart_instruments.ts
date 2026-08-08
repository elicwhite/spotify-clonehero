import {sql, type Kysely, type Migration} from 'kysely';

/**
 * Chorus' numeric intensity fields are optional metadata. Track hashes remain
 * authoritative for instrument presence when those intensities are missing.
 */
export const migration_015_chorus_chart_instruments: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .alterTable('chorus_charts')
      .addColumn('has_guitar', 'integer', column =>
        column.notNull().defaultTo(0),
      )
      .execute();
    await db.schema
      .alterTable('chorus_charts')
      .addColumn('has_bass', 'integer', column => column.notNull().defaultTo(0))
      .execute();
    await db.schema
      .alterTable('chorus_charts')
      .addColumn('has_keys', 'integer', column => column.notNull().defaultTo(0))
      .execute();
    await db.schema
      .alterTable('chorus_charts')
      .addColumn('has_pro_drums', 'integer', column =>
        column.notNull().defaultTo(0),
      )
      .execute();

    // The old cache omitted track-level presence. Invalidating only its data
    // version makes the next connected scan rebuild it from the bundled dump.
    await sql`DELETE FROM chorus_metadata WHERE key = 'charts_data_version'`.execute(
      db,
    );
  },

  async down(db: Kysely<any>) {
    await db.schema
      .alterTable('chorus_charts')
      .dropColumn('has_guitar')
      .execute();
    await db.schema
      .alterTable('chorus_charts')
      .dropColumn('has_bass')
      .execute();
    await db.schema
      .alterTable('chorus_charts')
      .dropColumn('has_keys')
      .execute();
    await db.schema
      .alterTable('chorus_charts')
      .dropColumn('has_pro_drums')
      .execute();
  },
};
