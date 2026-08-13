import {type Kysely, type Migration} from 'kysely';

/**
 * `has_pro_drums` never held a pro-drums fact. It was set from
 * `diff_drums_real >= 0 || a drums track exists` — an intensity field and a
 * plain drums track, neither of which says anything about cymbal markers.
 *
 * Find Music now reads `has_drums` for presence and `drum_type` for what the
 * kit actually is, so the column has no readers left and nothing it could
 * carry that `has_drums` does not already carry honestly.
 */
export const migration_021_drop_has_pro_drums: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .alterTable('chorus_charts')
      .dropColumn('has_pro_drums')
      .execute();
  },

  async down(db: Kysely<any>) {
    await db.schema
      .alterTable('chorus_charts')
      .addColumn('has_pro_drums', 'integer', column =>
        column.notNull().defaultTo(0),
      )
      .execute();
  },
};
