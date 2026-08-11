import {sql, type Kysely, type Migration} from 'kysely';

export const migration_017_renormalize_editions_and_features: Migration = {
  async up(db: Kysely<any>) {
    // Re-normalize every stored identity so hyphenated edition suffixes,
    // featured-artist suffixes, and "&" all match the way they now do.

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

    await sql`
      UPDATE apple_music_tracks
      SET artist_normalized = normalize(artist),
          name_normalized = normalize(name);
    `.execute(db);
  },

  async down() {
    // No-op: reverting would require reverting the normalize function itself.
  },
};
