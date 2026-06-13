import {type Kysely, type Migration} from 'kysely';

/**
 * Initial schema for the drum-fills database. Consolidates what were migrations
 * 010–012 in the shared local DB: the `fills` table (with groove fingerprint,
 * cross-song dedupe, and continuous difficulty columns), `fill_attempts`,
 * `fill_srs`, `scan_runs`, `groove_ladder_progress`, and all their indexes.
 *
 * The nullable `groove_*` / `fill_similarity_key` / `difficulty_score` columns
 * are created NOT-NULL-free here because the scan always writes them; they stay
 * nullable so the query layer's "needs rescan" checks remain meaningful for any
 * row a future change might leave incomplete.
 */
export const InitialMigration: Migration = {
  async up(db: Kysely<any>) {
    // Detected drum fills. One row per unique fill within a song. Re-scanning a
    // song replaces all of that song's fills (keyed by chart_hash).
    await db.schema
      .createTable('fills')
      .ifNotExists()
      .addColumn('id', 'text', cb => cb.primaryKey())
      // Song identity
      .addColumn('chart_hash', 'text', cb => cb.notNull())
      .addColumn('library_path', 'text', cb => cb.notNull())
      .addColumn('song', 'text', cb => cb.notNull())
      .addColumn('artist', 'text', cb => cb.notNull())
      .addColumn('charter', 'text', cb => cb.notNull())
      // Span (ticks)
      .addColumn('start_tick', 'integer', cb => cb.notNull())
      .addColumn('end_tick', 'integer', cb => cb.notNull())
      .addColumn('groove_start_tick', 'integer', cb => cb.notNull())
      .addColumn('groove_end_tick', 'integer', cb => cb.notNull())
      .addColumn('tempo_bpm', 'real', cb => cb.notNull())
      // Taxonomy
      .addColumn('length_bars', 'real', cb => cb.notNull())
      .addColumn('subdivision', 'text', cb => cb.notNull())
      .addColumn('complexity', 'integer', cb => cb.notNull())
      .addColumn('voicing_tags', 'text', cb => cb.notNull()) // JSON string[]
      .addColumn('fingerprint', 'text', cb => cb.notNull())
      .addColumn('confidence', 'real', cb => cb.notNull())
      .addColumn('features', 'text', cb => cb.notNull()) // JSON object
      .addColumn('created_at', 'integer', cb => cb.notNull())
      // Groove fingerprinting (clustering across songs)
      .addColumn('groove_fingerprint', 'text')
      .addColumn('groove_similarity_key', 'text')
      // Cross-song fill dedupe + continuous difficulty
      .addColumn('fill_similarity_key', 'text')
      .addColumn('difficulty_score', 'real')
      .execute();

    // Per-attempt scoring history.
    await db.schema
      .createTable('fill_attempts')
      .ifNotExists()
      .addColumn('id', 'integer', cb => cb.primaryKey().autoIncrement())
      .addColumn('fill_id', 'text', cb => cb.notNull())
      .addColumn('ts', 'integer', cb => cb.notNull())
      .addColumn('mode', 'text', cb => cb.notNull())
      .addColumn('tempo_pct', 'integer', cb => cb.notNull())
      .addColumn('score', 'real', cb => cb.notNull())
      .addColumn('judgments', 'text', cb => cb.notNull()) // JSON
      .addForeignKeyConstraint(
        'fill_attempts_fill_id_fk',
        ['fill_id'],
        'fills',
        ['id'],
        cb => cb.onDelete('cascade'),
      )
      .execute();

    // Spaced-repetition / mastery state per fill.
    await db.schema
      .createTable('fill_srs')
      .ifNotExists()
      .addColumn('fill_id', 'text', cb => cb.primaryKey())
      .addColumn('state', 'text', cb => cb.notNull())
      .addColumn('ease', 'real', cb => cb.notNull())
      .addColumn('interval_days', 'real', cb => cb.notNull())
      .addColumn('due_at', 'integer', cb => cb.notNull())
      .addColumn('pass_streak', 'integer', cb => cb.notNull())
      .addColumn('updated_at', 'integer', cb => cb.notNull())
      .addForeignKeyConstraint(
        'fill_srs_fill_id_fk',
        ['fill_id'],
        'fills',
        ['id'],
        cb => cb.onDelete('cascade'),
      )
      .execute();

    // Bookkeeping for library scan runs.
    await db.schema
      .createTable('scan_runs')
      .ifNotExists()
      .addColumn('id', 'integer', cb => cb.primaryKey().autoIncrement())
      .addColumn('started_at', 'integer', cb => cb.notNull())
      .addColumn('finished_at', 'integer')
      .addColumn('songs_scanned', 'integer', cb => cb.notNull().defaultTo(0))
      .addColumn('fills_found', 'integer', cb => cb.notNull().defaultTo(0))
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

    // Indexes: replace-by-song lookups + taxonomy filters.
    for (const [name, column] of [
      ['idx_fills_chart_hash', 'chart_hash'],
      ['idx_fills_subdivision', 'subdivision'],
      ['idx_fills_complexity', 'complexity'],
      ['idx_fills_length_bars', 'length_bars'],
      ['idx_fills_groove_fingerprint', 'groove_fingerprint'],
      ['idx_fills_groove_similarity_key', 'groove_similarity_key'],
      ['idx_fills_fill_similarity_key', 'fill_similarity_key'],
      ['idx_fills_difficulty_score', 'difficulty_score'],
    ] as const) {
      await db.schema
        .createIndex(name)
        .ifNotExists()
        .on('fills')
        .column(column)
        .execute();
    }

    await db.schema
      .createIndex('idx_fill_attempts_fill_id')
      .ifNotExists()
      .on('fill_attempts')
      .column('fill_id')
      .execute();

    await db.schema
      .createIndex('idx_fill_srs_due_at')
      .ifNotExists()
      .on('fill_srs')
      .column('due_at')
      .execute();

    await db.schema
      .createIndex('idx_fill_srs_state')
      .ifNotExists()
      .on('fill_srs')
      .column('state')
      .execute();
  },

  async down(db: Kysely<any>) {
    await db.schema.dropTable('groove_ladder_progress').ifExists().execute();
    await db.schema.dropTable('scan_runs').ifExists().execute();
    await db.schema.dropTable('fill_srs').ifExists().execute();
    await db.schema.dropTable('fill_attempts').ifExists().execute();
    await db.schema.dropTable('fills').ifExists().execute();
  },
};
