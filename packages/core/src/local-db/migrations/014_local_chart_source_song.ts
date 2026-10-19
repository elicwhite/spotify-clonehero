import {type Migration} from 'kysely';

/**
 * No-op compatibility stub. A short-lived development build exposed this
 * migration before its local-chart matching experiment was reverted. Keep the
 * name permanently so databases that recorded it remain valid to Kysely.
 *
 * The abandoned columns are harmless in affected databases, and current code
 * does not require them in new databases.
 */
export const migration_014_local_chart_source_song: Migration = {
  async up() {},
  async down() {},
};
