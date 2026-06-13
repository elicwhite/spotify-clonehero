import {type Kysely, type Migration} from 'kysely';

/**
 * Drops the orphaned drum-fills tables from the shared database (plan 0047).
 *
 * The drum-fills tool now owns a separate `drum-fills.sqlite3` database, so its
 * tables no longer belong in `spotify-clonehero-local.sqlite3`. Existing user
 * DBs created them via migrations 010–012 (now no-op stubs); this migration
 * removes them. On fresh DBs the stubs created nothing, so every `dropTable` /
 * `dropIndex` is a no-op thanks to `ifExists`.
 *
 * No data is ported: detected fills rebuild via a rescan into the new DB, and
 * the (minimal) practice history in the old tables is intentionally abandoned.
 */
export const migration_013_drop_drum_fills: Migration = {
  async up(db: Kysely<any>) {
    for (const index of [
      'idx_fills_chart_hash',
      'idx_fills_subdivision',
      'idx_fills_complexity',
      'idx_fills_length_bars',
      'idx_fills_groove_fingerprint',
      'idx_fills_groove_similarity_key',
      'idx_fills_fill_similarity_key',
      'idx_fills_difficulty_score',
      'idx_fill_attempts_fill_id',
      'idx_fill_srs_due_at',
      'idx_fill_srs_state',
    ]) {
      await db.schema.dropIndex(index).ifExists().execute();
    }

    await db.schema.dropTable('groove_ladder_progress').ifExists().execute();
    await db.schema.dropTable('scan_runs').ifExists().execute();
    await db.schema.dropTable('fill_srs').ifExists().execute();
    await db.schema.dropTable('fill_attempts').ifExists().execute();
    await db.schema.dropTable('fills').ifExists().execute();
  },

  // Irreversible: the schema lives in the drum-fills database now, so there is
  // nothing meaningful to recreate here.
  async down() {},
};
