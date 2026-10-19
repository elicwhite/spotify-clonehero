import {type Migration} from 'kysely';

/**
 * No-op stub. The drum-fills schema moved to its own database
 * (`lib/drum-fills/db`, plan 0047). This name is kept in the shared migration
 * chain so existing DBs that already recorded `012_fill_dedupe_difficulty`
 * don't trip Kysely's "previously executed migration is missing" check. The
 * orphaned drum-fills tables are dropped by `013_drop_drum_fills`.
 */
export const migration_012_fill_dedupe_difficulty: Migration = {
  async up() {},
  async down() {},
};
