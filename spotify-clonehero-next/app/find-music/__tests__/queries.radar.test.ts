import {Kysely, SqliteDialect, type Insertable} from 'kysely';

import type {DB} from '../../../lib/local-db/types';
import {getRadarSongs} from '../queries';

const Database = require('better-sqlite3') as new (path: string) => {
  exec(source: string): unknown;
};

type QueryLog = {sql: string; parameters: readonly unknown[]};

function makeDb(queryLog?: QueryLog[]): Kysely<DB> {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE spotify_history (
      artist TEXT NOT NULL,
      artist_normalized TEXT NOT NULL,
      name TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      play_count INTEGER NOT NULL
    );
    CREATE TABLE spotify_tracks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      artist_normalized TEXT,
      name_normalized TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE apple_music_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id TEXT NOT NULL,
      catalog_id TEXT,
      artist TEXT NOT NULL,
      name TEXT NOT NULL,
      artist_normalized TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE apple_music_library_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      connection_epoch INTEGER NOT NULL DEFAULT 0,
      active_scan_id TEXT,
      storefront TEXT,
      reported_total INTEGER NOT NULL,
      fetched_count INTEGER NOT NULL,
      usable_count INTEGER NOT NULL,
      catalog_associated_count INTEGER NOT NULL,
      track_count INTEGER NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE spotify_playlists (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      name TEXT NOT NULL,
      collaborative INTEGER NOT NULL,
      owner_display_name TEXT NOT NULL,
      owner_external_url TEXT NOT NULL,
      total_tracks INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE spotify_playlist_tracks (
      playlist_id TEXT NOT NULL,
      track_id TEXT NOT NULL
    );
    CREATE TABLE spotify_albums (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      artist_name TEXT NOT NULL,
      total_tracks INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE spotify_album_tracks (
      album_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE chorus_charts (
      md5 TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      charter TEXT NOT NULL,
      diff_drums INTEGER,
      diff_guitar INTEGER,
      diff_bass INTEGER,
      diff_keys INTEGER,
      diff_drums_real INTEGER,
      has_guitar INTEGER NOT NULL DEFAULT 0,
      has_bass INTEGER NOT NULL DEFAULT 0,
      has_keys INTEGER NOT NULL DEFAULT 0,
      has_drums INTEGER NOT NULL DEFAULT 0,
      has_other_instruments INTEGER NOT NULL DEFAULT 0,
      drum_type INTEGER,
      modified_time TEXT NOT NULL,
      song_length INTEGER,
      has_video_background INTEGER NOT NULL,
      album_art_md5 TEXT,
      group_id INTEGER NOT NULL,
      first_seen TEXT,
      artist_normalized TEXT,
      name_normalized TEXT,
      charter_normalized TEXT
    );
    CREATE TABLE local_charts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artist TEXT NOT NULL,
      song TEXT NOT NULL,
      charter TEXT NOT NULL,
      modified_time TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      artist_normalized TEXT,
      song_normalized TEXT,
      charter_normalized TEXT
    );
    CREATE TABLE spotify_track_chart_matches (
      spotify_id TEXT NOT NULL,
      chart_md5 TEXT NOT NULL,
      matched_at INTEGER NOT NULL
    );
    CREATE TABLE radar_dismissed (
      artist_normalized TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      dismissed_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_radar_dismissed_identity
      ON radar_dismissed (artist_normalized, name_normalized);
    CREATE TABLE chorus_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE chorus_scan_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      scan_since_time TEXT NOT NULL,
      completed_at TEXT,
      last_chart_id INTEGER
    );
  `);
  return new Kysely<DB>({
    dialect: new SqliteDialect({database: sqlite as never}),
    log: event => {
      if (event.level === 'query') {
        queryLog?.push({
          sql: event.query.sql,
          parameters: event.query.parameters,
        });
      }
    },
  });
}

function chart(
  md5: string,
  artist: string,
  artistNormalized: string,
  name: string,
  nameNormalized: string,
  charter: string,
  charterNormalized: string,
  overrides: Partial<DB['chorus_charts']> = {},
): DB['chorus_charts'] {
  return {
    md5,
    artist,
    artist_normalized: artistNormalized,
    name,
    name_normalized: nameNormalized,
    charter,
    charter_normalized: charterNormalized,
    diff_drums: 2,
    diff_guitar: 3,
    diff_bass: null,
    diff_keys: null,
    diff_drums_real: 2,
    has_guitar: 1,
    has_bass: 0,
    has_keys: 0,
    has_drums: 1,
    has_other_instruments: 0,
    drum_type: null,
    modified_time: '2026-01-01',
    song_length: 180_000,
    has_video_background: 0,
    album_art_md5: null,
    // Each fixture chart is its own upload group unless a test is exercising
    // revision dedupe, where it passes an explicit group_id.
    group_id: fixtureGroupId(md5),
    first_seen: null,
    ...overrides,
  };
}

const fixtureGroupIds = new Map<string, number>();
function fixtureGroupId(md5: string): number {
  const existing = fixtureGroupIds.get(md5);
  if (existing != null) return existing;
  const next = fixtureGroupIds.size + 1;
  fixtureGroupIds.set(md5, next);
  return next;
}

async function setAppleMusicState(
  db: Kysely<DB>,
  overrides: Partial<Insertable<DB['apple_music_library_state']>> = {},
) {
  await db
    .insertInto('apple_music_library_state')
    .values({
      id: 1,
      active_scan_id: 'active-scan',
      storefront: 'us',
      reported_total: 0,
      fetched_count: 0,
      usable_count: 0,
      catalog_associated_count: 0,
      track_count: 0,
      updated_at: '2026-03-01T00:00:00.000Z',
      ...overrides,
    })
    .execute();
}

async function setSpotifyPlaylistMembership(
  db: Kysely<DB>,
  trackIds: readonly string[],
) {
  await db
    .insertInto('spotify_playlists')
    .values({
      id: 'current-playlist',
      snapshot_id: 'current-snapshot',
      name: 'Current playlist',
      collaborative: 0,
      owner_display_name: 'Me',
      owner_external_url: '',
      total_tracks: trackIds.length,
      updated_at: '2026-02-10',
    })
    .execute();
  if (trackIds.length > 0) {
    await db
      .insertInto('spotify_playlist_tracks')
      .values(
        trackIds.map(trackId => ({
          playlist_id: 'current-playlist',
          track_id: trackId,
        })),
      )
      .execute();
  }
}
describe('find-music Radar queries', () => {
  let db: Kysely<DB>;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function seedAffinity(artist: string, playCount = 50) {
    await db
      .insertInto('spotify_history')
      .values({
        artist,
        artist_normalized: artist.toLowerCase(),
        name: `${artist} Known`,
        name_normalized: `${artist.toLowerCase()} known`,
        play_count: playCount,
      })
      .execute();
  }

  it('keeps only the newest revision of a chart upload group', async () => {
    await seedAffinity('Revised');
    await db
      .insertInto('chorus_charts')
      .values([
        chart('old-rev', 'Revised', 'revised', 'Song', 'song', 'Ana', 'ana', {
          group_id: 7,
          modified_time: '2024-01-01',
          has_drums: 1,
        }),
        chart('new-rev', 'Revised', 'revised', 'Song', 'song', 'Ana', 'ana', {
          group_id: 7,
          modified_time: '2026-01-01',
          has_drums: 0,
        }),
        chart('other', 'Revised', 'revised', 'Song', 'song', 'Bo', 'bo', {
          group_id: 8,
          has_drums: 0,
        }),
        // group_id 0 means Chorus reported no group, so these stand alone
        chart('ungrouped-a', 'Revised', 'revised', 'Song', 'song', 'Cy', 'cy', {
          group_id: 0,
          has_drums: 0,
        }),
        chart('ungrouped-b', 'Revised', 'revised', 'Song', 'song', 'Di', 'di', {
          group_id: 0,
          has_drums: 0,
        }),
      ])
      .execute();

    const [song] = await getRadarSongs(db);
    expect(song.charts.map(item => item.md5).sort()).toEqual([
      'new-rev',
      'other',
      'ungrouped-a',
      'ungrouped-b',
    ]);
    expect(song.chartCount).toBe(4);
    expect(song.availableInstrumentCount).toBe(1);
  });

  it('excludes songs that are already installed locally', async () => {
    await seedAffinity('Owned');
    await db
      .insertInto('chorus_charts')
      .values([
        chart(
          'installed',
          'Owned',
          'owned',
          'Have It',
          'have it',
          'Ana',
          'ana',
        ),
        chart('fresh', 'Owned', 'owned', 'Need It', 'need it', 'Ana', 'ana'),
      ])
      .execute();
    await db
      .insertInto('local_charts')
      .values({
        artist: 'Owned',
        song: 'Have It',
        charter: 'Someone',
        artist_normalized: 'owned',
        song_normalized: 'have it',
        charter_normalized: 'someone',
        modified_time: '2026-01-01',
        data: '{}',
        updated_at: '2026-01-01',
      })
      .execute();

    const songs = await getRadarSongs(db);
    expect(songs.map(item => item.song)).toEqual(['Need It']);
  });

  it('honors song and artist dismissals', async () => {
    await seedAffinity('Dropped');
    await seedAffinity('Partly');
    await db
      .insertInto('chorus_charts')
      .values([
        chart('d1', 'Dropped', 'dropped', 'Any', 'any', 'Ana', 'ana'),
        chart('p1', 'Partly', 'partly', 'Gone', 'gone', 'Ana', 'ana'),
        chart('p2', 'Partly', 'partly', 'Kept', 'kept', 'Ana', 'ana'),
      ])
      .execute();
    await db
      .insertInto('radar_dismissed')
      .values([
        {
          artist_normalized: 'dropped',
          name_normalized: '',
          dismissed_at: '2026-01-01',
        },
        {
          artist_normalized: 'partly',
          name_normalized: 'gone',
          dismissed_at: '2026-01-01',
        },
      ])
      .execute();

    const songs = await getRadarSongs(db);
    expect(songs.map(item => item.song)).toEqual(['Kept']);
  });

  it('caps how many songs a single artist can occupy', async () => {
    await seedAffinity('Prolific', 500);
    await seedAffinity('Quiet', 1);
    await db
      .insertInto('chorus_charts')
      .values([
        ...Array.from({length: 9}, (_, index) =>
          chart(
            `prolific-${index}`,
            'Prolific',
            'prolific',
            `Deep Cut ${index}`,
            `deep cut ${index}`,
            'Ana',
            'ana',
          ),
        ),
        chart('quiet-1', 'Quiet', 'quiet', 'Only One', 'only one', 'Bo', 'bo'),
      ])
      .execute();

    const songs = await getRadarSongs(db);
    expect(songs.filter(item => item.artist === 'Prolific')).toHaveLength(5);
    // The capped artist must not crowd out everyone else
    expect(songs.map(item => item.artist)).toContain('Quiet');
  });

  it('ranks radar by artist affinity, excludes all direct evidence, and preserves variants', async () => {
    await db
      .insertInto('spotify_history')
      .values([
        {
          artist: 'Most Played',
          artist_normalized: 'most played',
          name: 'Known',
          name_normalized: 'known',
          play_count: 50,
        },
        {
          artist: 'Variant Artist',
          artist_normalized: 'variant artist',
          name: 'Known',
          name_normalized: 'known',
          play_count: 20,
        },
      ])
      .execute();
    await db
      .insertInto('spotify_tracks')
      .values({
        id: 'direct-library',
        artist: 'Variant Artist',
        artist_normalized: 'variant artist',
        name: 'Library Direct',
        name_normalized: 'library direct',
        updated_at: '2026-01-01',
      })
      .execute();
    await setSpotifyPlaylistMembership(db, ['direct-library']);
    await db
      .insertInto('chorus_charts')
      .values([
        chart(
          'known-history',
          'Most Played',
          'most played',
          'Known',
          'known',
          'A',
          'a',
        ),
        chart(
          'top-rec',
          'Most Played',
          'most played',
          'Discovery',
          'discovery',
          'A',
          'a',
        ),
        chart(
          'library-direct',
          'Variant Artist',
          'variant artist',
          'Library Direct',
          'library direct',
          'A',
          'a',
        ),
        chart(
          'variant-1',
          'Variant Artist',
          'variant artist',
          'Deep Cut',
          'deep cut',
          'A',
          'a',
        ),
        chart(
          'variant-2',
          'Variant Artist',
          'variant artist',
          'Deep Cut',
          'deep cut',
          'B',
          'b',
        ),
        chart(
          'outsider',
          'Outsider',
          'outsider',
          'No Affinity',
          'no affinity',
          'A',
          'a',
        ),
      ])
      .execute();

    const radar = await getRadarSongs(db, 10);
    expect(radar.map(song => song.song)).toEqual(['Discovery', 'Deep Cut']);
    expect(radar[0].artistPlayCount).toBe(50);
    expect(radar[1].artistPlayCount).toBe(20);
    expect(radar[1].charts.map(item => item.md5).sort()).toEqual([
      'variant-1',
      'variant-2',
    ]);
    expect(await getRadarSongs(db, 1)).toMatchObject([
      {song: 'Discovery', artistPlayCount: 50},
    ]);
  });

  it('uses deduplicated cross-provider saved-library coverage and excludes active Apple songs', async () => {
    await setAppleMusicState(db, {track_count: 2});
    await db
      .insertInto('spotify_tracks')
      .values({
        id: 'spotify-duplicate',
        artist: 'Saved Artist',
        artist_normalized: 'saved artist',
        name: 'Already Saved',
        name_normalized: 'already saved',
        updated_at: '2026-02-01',
      })
      .execute();
    await setSpotifyPlaylistMembership(db, ['spotify-duplicate']);
    await db
      .insertInto('apple_music_tracks')
      .values([
        {
          scan_id: 'active-scan',
          catalog_id: 'apple-duplicate',
          artist: 'The Saved Artist',
          artist_normalized: 'saved artist',
          name: 'Already Saved!',
          name_normalized: 'already saved',
          updated_at: '2026-03-01',
        },
        {
          scan_id: 'active-scan',
          catalog_id: 'apple-second',
          artist: 'Saved Artist',
          artist_normalized: 'saved artist',
          name: 'Apple Direct',
          name_normalized: 'apple direct',
          updated_at: '2026-03-01',
        },
        {
          scan_id: 'stale-scan',
          catalog_id: 'stale',
          artist: 'Stale Artist',
          artist_normalized: 'stale artist',
          name: 'Stale Direct',
          name_normalized: 'stale direct',
          updated_at: '2026-01-01',
        },
      ])
      .execute();
    await db
      .insertInto('chorus_charts')
      .values([
        chart(
          'spotify-direct-chart',
          'Saved Artist',
          'saved artist',
          'Already Saved',
          'already saved',
          'A',
          'a',
        ),
        chart(
          'apple-direct-chart',
          'Saved Artist',
          'saved artist',
          'Apple Direct',
          'apple direct',
          'A',
          'a',
        ),
        chart(
          'saved-recommendation',
          'Saved Artist',
          'saved artist',
          'Recommended Cut',
          'recommended cut',
          'A',
          'a',
        ),
        chart(
          'stale-recommendation',
          'Stale Artist',
          'stale artist',
          'Should Not Appear',
          'should not appear',
          'A',
          'a',
        ),
      ])
      .execute();

    const radar = await getRadarSongs(db, 10);
    expect(radar).toMatchObject([
      {
        song: 'Recommended Cut',
        artistPlayCount: 0,
        savedLibrarySongCount: 2,
      },
    ]);
    expect(radar).toHaveLength(1);
  });

  it('applies the public score before limiting Radar results', async () => {
    const highPlayArtists = ['High One', 'High Two', 'High Three', 'High Four'];
    await db
      .insertInto('spotify_history')
      .values([
        ...highPlayArtists.map((artist, index) => ({
          artist,
          artist_normalized: `high ${index + 1}`,
          name: 'Known',
          name_normalized: 'known',
          play_count: 55,
        })),
        {
          artist: 'Broad Library',
          artist_normalized: 'broad library',
          name: 'Known',
          name_normalized: 'known',
          play_count: 10,
        },
      ])
      .execute();
    await db
      .insertInto('spotify_tracks')
      .values(
        Array.from({length: 5}, (_, index) => ({
          id: `broad-library-${index}`,
          artist: 'Broad Library',
          artist_normalized: 'broad library',
          name: `Saved ${index}`,
          name_normalized: `saved ${index}`,
          updated_at: '2026-01-01',
        })),
      )
      .execute();
    await setSpotifyPlaylistMembership(
      db,
      Array.from({length: 5}, (_, index) => `broad-library-${index}`),
    );
    await db
      .insertInto('chorus_charts')
      .values([
        ...highPlayArtists.map((artist, index) =>
          chart(
            `high-${index}`,
            artist,
            `high ${index + 1}`,
            'Recommendation',
            'recommendation',
            'A',
            'a',
          ),
        ),
        chart(
          'broad-library-recommendation',
          'Broad Library',
          'broad library',
          'Recommendation',
          'recommendation',
          'A',
          'a',
        ),
      ])
      .execute();

    await expect(getRadarSongs(db, 1)).resolves.toMatchObject([
      {
        artist: 'Broad Library',
        artistPlayCount: 10,
        savedLibrarySongCount: 5,
      },
    ]);
  });

  it('does not discard the public identity winner when SQL-only signals differ', async () => {
    await db.destroy();
    const queryLog: QueryLog[] = [];
    db = makeDb(queryLog);
    const artists = [
      'Alpha Final',
      'Zulu One',
      'Zulu Two',
      'Zulu Three',
      'Zulu Four',
    ];
    await db
      .insertInto('spotify_history')
      .values(
        artists.map(artist => ({
          artist,
          artist_normalized: artist.toLowerCase(),
          name: 'Known',
          name_normalized: 'known',
          play_count: 100,
        })),
      )
      .execute();

    const savedTracks = artists.flatMap(artist =>
      Array.from({length: 5}, (_, index) => ({
        id: `${artist.toLowerCase().replaceAll(' ', '-')}-${index}`,
        artist,
        artist_normalized: artist.toLowerCase(),
        name: `Saved ${index}`,
        name_normalized: `saved ${index}`,
        updated_at: '2026-01-01',
      })),
    );
    await db.insertInto('spotify_tracks').values(savedTracks).execute();
    await setSpotifyPlaylistMembership(
      db,
      savedTracks.map(track => track.id),
    );

    await db
      .insertInto('chorus_charts')
      .values(
        artists.flatMap((artist, artistIndex) => {
          const variantCount = artistIndex === 0 ? 1 : 2;
          return Array.from({length: variantCount}, (_, variantIndex) =>
            chart(
              `recommendation-${artistIndex}-${variantIndex}`,
              artist,
              artist.toLowerCase(),
              'Recommendation',
              'recommendation',
              `Charter ${variantIndex}`,
              `charter ${variantIndex}`,
            ),
          );
        }),
      )
      .execute();

    // Alpha Final is the first candidate SQL emits, but it has one chart
    // version where the rest have two, so the public score reorders it away.
    await expect(getRadarSongs(db, 1)).resolves.toMatchObject([
      {
        artist: 'Zulu Four',
        savedLibrarySongCount: 5,
      },
    ]);
    const detailQuery = queryLog.find(entry =>
      entry.sql.includes('winning_songs(artist_normalized'),
    );
    expect(detailQuery?.parameters).toEqual(['zulu four', 'recommendation']);
  });
});
