import {sql, type Kysely, type Migration} from 'kysely';

export const migration_009_renormalize_strip_articles: Migration = {
  async up(db: Kysely<any>) {
    // Re-normalize all tables to strip leading articles ("the", "a", "an")

    await sql`
      UPDATE chorus_charts
      SET artist_normalized = normalize(artist),
          charter_normalized = normalize(charter),
          name_normalized = normalize(name);
    `.execute(db);

    await sql`
      UPDATE spotify_tracks
      SET artist_normalized = normalize(artist),
          name_normalized = normalize(name);
    `.execute(db);

    await sql`
      UPDATE local_charts
      SET artist_normalized = normalize(artist),
          song_normalized = normalize(song),
          charter_normalized = normalize(charter);
    `.execute(db);

    await sql`
      UPDATE spotify_history
      SET artist_normalized = normalize(artist),
          name_normalized = normalize(name);
    `.execute(db);
  },

  async down() {
    // No-op: re-running normalize with the old function would require
    // reverting the normalize code, which isn't feasible in a migration.
  },
};
