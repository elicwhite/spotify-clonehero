import {type Kysely, type Migration} from 'kysely';

/**
 * Cross-song fill dedupe + continuous difficulty + per-groove ladder progress
 * (plan 0045 §5–6).
 *
 *  - `fills.fill_similarity_key`: canonical fill fingerprint with dynamics
 *    stripped (cymbal collapsed, 16th-grid quantized). Equivalent fills across
 *    different songs share this key, so the Library can group by unique pattern.
 *  - `fills.difficulty_score`: continuous difficulty in [0, 100] used to order a
 *    groove cluster's fills into a simple→complex ladder.
 *  - `groove_ladder_progress`: per-groove (similarity key) ladder position so a
 *    user resumes a groove's fill ladder where they left off.
 *
 * Both new `fills` columns are nullable: rows detected before this migration
 * stay NULL until the next library rescan repopulates them (the scan writes
 * both for every fill). A NULL check drives the "rescan" hint, the same pattern
 * migration 011 established for groove fingerprints.
 */
export const migration_012_fill_dedupe_difficulty: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .alterTable('fills')
      .addColumn('fill_similarity_key', 'text')
      .execute();

    await db.schema
      .alterTable('fills')
      .addColumn('difficulty_score', 'real')
      .execute();

    await db.schema
      .createIndex('idx_fills_fill_similarity_key')
      .ifNotExists()
      .on('fills')
      .column('fill_similarity_key')
      .execute();

    await db.schema
      .createIndex('idx_fills_difficulty_score')
      .ifNotExists()
      .on('fills')
      .column('difficulty_score')
      .execute();

    // Per-groove ladder progress. Keyed by the groove similarity key so it
    // survives rescans (fill rows are replaced per song, but the groove key is
    // stable across songs). `current_rung_fill_id` references the fill at the
    // user's current rung; nullable because the referenced fill can be replaced
    // by a rescan (resolved against the current ladder at read time).
    await db.schema
      .createTable('groove_ladder_progress')
      .ifNotExists()
      .addColumn('groove_similarity_key', 'text', cb => cb.primaryKey())
      .addColumn('current_rung_fill_id', 'text')
      .addColumn('updated_at', 'integer', cb => cb.notNull())
      .execute();
  },

  async down(db: Kysely<any>) {
    await db.schema.dropTable('groove_ladder_progress').ifExists().execute();
    await db.schema
      .dropIndex('idx_fills_difficulty_score')
      .ifExists()
      .execute();
    await db.schema
      .dropIndex('idx_fills_fill_similarity_key')
      .ifExists()
      .execute();
    await db.schema
      .alterTable('fills')
      .dropColumn('difficulty_score')
      .execute();
    await db.schema
      .alterTable('fills')
      .dropColumn('fill_similarity_key')
      .execute();
  },
};
