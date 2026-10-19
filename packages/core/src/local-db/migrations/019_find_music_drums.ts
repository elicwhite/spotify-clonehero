import {type Kysely, type Migration} from 'kysely';

/**
 * Instrument presence becomes track-backed. `has_drums` replaces the
 * `diff_drums_real`-derived pro-drums signal, and `has_other_instruments`
 * records tracks outside the four Find Music renders so a GHL-only chart can
 * say so instead of showing an empty column.
 *
 * Neither new column can be recomputed from stored rows — the source fields
 * were never mirrored — so they stay at their defaults until the catalog is
 * re-ingested. CHART_DB_DATA_VERSION is the one thing that triggers that.
 */
export const migration_019_find_music_drums: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .alterTable('chorus_charts')
      .addColumn('has_drums', 'integer', column =>
        column.notNull().defaultTo(0),
      )
      .execute();

    await db.schema
      .alterTable('chorus_charts')
      .addColumn('has_other_instruments', 'integer', column =>
        column.notNull().defaultTo(0),
      )
      .execute();

    // scan-chart's observation of what the drums track actually contains.
    // `pro_drums` and `five_lane_drums` are charter-declared and disagree with
    // it constantly, so anything that needs to know reads the scan.
    await db.schema
      .alterTable('chorus_charts')
      .addColumn('drum_type', 'integer')
      .execute();
  },

  async down(db: Kysely<any>) {
    await db.schema
      .alterTable('chorus_charts')
      .dropColumn('drum_type')
      .execute();
    await db.schema
      .alterTable('chorus_charts')
      .dropColumn('has_other_instruments')
      .execute();
    await db.schema
      .alterTable('chorus_charts')
      .dropColumn('has_drums')
      .execute();
  },
};
