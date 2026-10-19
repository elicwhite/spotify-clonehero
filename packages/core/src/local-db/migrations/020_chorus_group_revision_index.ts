import {type Kysely, type Migration} from 'kysely';

/**
 * Find Music resolves each upload group to its newest revision in SQL, which
 * is a correlated lookup for a higher `(modified_time, md5)` within a
 * `group_id`. This index is what keeps that from scanning the catalog.
 */
export const migration_020_chorus_group_revision_index: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .createIndex('idx_chorus_charts_group_revision')
      .ifNotExists()
      .on('chorus_charts')
      .columns(['group_id', 'modified_time', 'md5'])
      .execute();
  },

  async down(db: Kysely<any>) {
    await db.schema
      .dropIndex('idx_chorus_charts_group_revision')
      .ifExists()
      .execute();
  },
};
