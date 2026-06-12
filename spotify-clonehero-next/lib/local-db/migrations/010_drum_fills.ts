import {type Kysely, type Migration} from 'kysely';

export const migration_010_drum_fills: Migration = {
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

    // Indexes: replace-by-song lookups + taxonomy filters.
    await db.schema
      .createIndex('idx_fills_chart_hash')
      .ifNotExists()
      .on('fills')
      .column('chart_hash')
      .execute();

    await db.schema
      .createIndex('idx_fills_subdivision')
      .ifNotExists()
      .on('fills')
      .column('subdivision')
      .execute();

    await db.schema
      .createIndex('idx_fills_complexity')
      .ifNotExists()
      .on('fills')
      .column('complexity')
      .execute();

    await db.schema
      .createIndex('idx_fills_length_bars')
      .ifNotExists()
      .on('fills')
      .column('length_bars')
      .execute();

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
    await db.schema.dropIndex('idx_fill_srs_state').ifExists().execute();
    await db.schema.dropIndex('idx_fill_srs_due_at').ifExists().execute();
    await db.schema.dropIndex('idx_fill_attempts_fill_id').ifExists().execute();
    await db.schema.dropIndex('idx_fills_length_bars').ifExists().execute();
    await db.schema.dropIndex('idx_fills_complexity').ifExists().execute();
    await db.schema.dropIndex('idx_fills_subdivision').ifExists().execute();
    await db.schema.dropIndex('idx_fills_chart_hash').ifExists().execute();

    await db.schema.dropTable('scan_runs').ifExists().execute();
    await db.schema.dropTable('fill_srs').ifExists().execute();
    await db.schema.dropTable('fill_attempts').ifExists().execute();
    await db.schema.dropTable('fills').ifExists().execute();
  },
};
