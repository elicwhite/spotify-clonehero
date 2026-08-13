import {Kysely, SqliteDialect, type Insertable} from 'kysely';

import type {DB} from '../../../lib/local-db/types';
import {getFindMusicStats} from '../queries';

const Database = require('better-sqlite3') as new (path: string) => {
  exec(source: string): unknown;
};

function makeDb(): Kysely<DB> {
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
  });
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
describe('find-music stats query', () => {
  let db: Kysely<DB>;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('reports provider-specific and combined library stats from only the active Apple scan', async () => {
    await db
      .insertInto('spotify_history')
      .values([
        {
          artist: 'Artist',
          artist_normalized: 'artist',
          name: 'Song',
          name_normalized: 'song',
          play_count: 2,
        },
        {
          artist: 'The Artist',
          artist_normalized: 'artist',
          name: 'Song!',
          name_normalized: 'song',
          play_count: 3,
        },
      ])
      .execute();
    await db
      .insertInto('spotify_tracks')
      .values([
        {
          id: 'one',
          artist: 'Artist',
          artist_normalized: 'artist',
          name: 'Song',
          name_normalized: 'song',
          updated_at: '2026-01-02',
        },
        {
          id: 'two',
          artist: 'The Artist',
          artist_normalized: 'artist',
          name: 'Song!',
          name_normalized: 'song',
          updated_at: '2026-01-03',
        },
      ])
      .execute();
    await setSpotifyPlaylistMembership(db, ['one', 'two']);
    await db
      .insertInto('local_charts')
      .values({
        artist: 'Artist',
        artist_normalized: 'artist',
        song: 'Song',
        song_normalized: 'song',
        charter: 'A',
        charter_normalized: 'a',
        modified_time: '2026-01-01',
        data: '{}',
        updated_at: '2026-02-01',
      })
      .execute();
    await setAppleMusicState(db, {
      active_scan_id: 'current',
      storefront: 'gb',
      reported_total: 2,
      fetched_count: 2,
      usable_count: 2,
      catalog_associated_count: 1,
      track_count: 1,
      updated_at: '2026-03-01',
    });
    await db
      .insertInto('apple_music_tracks')
      .values([
        {
          scan_id: 'current',
          catalog_id: 'active',
          artist: 'Apple',
          artist_normalized: 'apple',
          name: 'Active',
          name_normalized: 'active',
          updated_at: '2026-03-01',
        },
        {
          scan_id: 'stale',
          catalog_id: 'stale',
          artist: 'Apple',
          artist_normalized: 'apple',
          name: 'Stale',
          name_normalized: 'stale',
          updated_at: '2026-02-01',
        },
      ])
      .execute();

    expect(await getFindMusicStats(db)).toEqual({
      historySongs: 2,
      playlists: 1,
      albums: 0,
      libraryTracks: 3,
      spotifyLibraryTracks: 2,
      appleMusicLibraryTracks: 1,
      chorusCharts: 0,
      localCharts: 1,
      historyUpdatedAt: null,
      libraryUpdatedAt: '2026-03-01',
      spotifyLibraryUpdatedAt: '2026-02-10',
      appleMusicLibraryUpdatedAt: '2026-03-01',
      appleMusicStorefront: 'gb',
      localUpdatedAt: '2026-02-01',
    });
  });
});
