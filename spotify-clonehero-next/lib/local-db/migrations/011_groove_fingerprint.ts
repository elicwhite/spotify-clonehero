import {type Kysely, type Migration} from 'kysely';

/**
 * Adds canonical groove fingerprints to detected fills so they can be clustered
 * into "same groove, many fills" practice sets.
 *
 *  - `groove_fingerprint`: deterministic serialization of the fill's
 *    preceding-groove span (exact match = identical groove pattern).
 *  - `groove_similarity_key`: the same with cymbal choice collapsed and onsets
 *    coarse-quantized, so equivalent grooves cluster across songs.
 *
 * Both are nullable: existing fills predate the columns and stay NULL until the
 * next library rescan repopulates them (the scan writes both for every fill).
 * A NULL check drives the UI's "rescan to enable Grooves" hint.
 */
export const migration_011_groove_fingerprint: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .alterTable('fills')
      .addColumn('groove_fingerprint', 'text')
      .execute();

    await db.schema
      .alterTable('fills')
      .addColumn('groove_similarity_key', 'text')
      .execute();

    await db.schema
      .createIndex('idx_fills_groove_fingerprint')
      .ifNotExists()
      .on('fills')
      .column('groove_fingerprint')
      .execute();

    await db.schema
      .createIndex('idx_fills_groove_similarity_key')
      .ifNotExists()
      .on('fills')
      .column('groove_similarity_key')
      .execute();
  },

  async down(db: Kysely<any>) {
    await db.schema
      .dropIndex('idx_fills_groove_similarity_key')
      .ifExists()
      .execute();
    await db.schema
      .dropIndex('idx_fills_groove_fingerprint')
      .ifExists()
      .execute();
    await db.schema
      .alterTable('fills')
      .dropColumn('groove_similarity_key')
      .execute();
    await db.schema
      .alterTable('fills')
      .dropColumn('groove_fingerprint')
      .execute();
  },
};
