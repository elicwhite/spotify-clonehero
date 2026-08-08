import {Kysely, SqliteDialect} from 'kysely';

import type {DB} from '../../../lib/local-db/types';
import {getFindMusicSongs, getFindMusicStats, getRadarSongs} from '../queries';

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
      has_pro_drums INTEGER NOT NULL DEFAULT 0,
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
    has_pro_drums: 1,
    modified_time: '2026-01-01',
    song_length: 180_000,
    has_video_background: 0,
    album_art_md5: null,
    group_id: 1,
    ...overrides,
  };
}

describe('find-music queries', () => {
  let db: Kysely<DB>;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('unions and deduplicates source identities while merging all evidence and chart variants', async () => {
    await db
      .insertInto('spotify_history')
      .values([
        {
          artist: 'The Example',
          artist_normalized: 'example',
          name: 'Same Song',
          name_normalized: 'same song',
          play_count: 5,
        },
        {
          artist: 'Example',
          artist_normalized: 'example',
          name: 'Same Song!',
          name_normalized: 'same song',
          play_count: 2,
        },
        {
          artist: 'History Only',
          artist_normalized: 'history only',
          name: 'Remembered',
          name_normalized: 'remembered',
          play_count: 9,
        },
      ])
      .execute();

    await db
      .insertInto('spotify_tracks')
      .values([
        {
          id: 'track-1',
          artist: 'Example',
          artist_normalized: 'example',
          name: 'Same Song',
          name_normalized: 'same song',
          updated_at: '2026-02-01',
        },
        {
          id: 'track-duplicate',
          artist: 'The Example',
          artist_normalized: 'example',
          name: 'Same Song (Single)',
          name_normalized: 'same song',
          updated_at: '2026-02-02',
        },
        {
          id: 'library-only',
          artist: 'Library Only',
          artist_normalized: 'library only',
          name: 'Saved Song',
          name_normalized: 'saved song',
          updated_at: '2026-02-03',
        },
      ])
      .execute();

    await db
      .insertInto('spotify_playlists')
      .values([
        {
          id: 'p1',
          snapshot_id: 's1',
          name: 'Road Trip',
          collaborative: 0,
          owner_display_name: 'Me',
          owner_external_url: '',
          total_tracks: 2,
          updated_at: '2026-02-04',
        },
        {
          id: 'p2',
          snapshot_id: 's2',
          name: 'Favorites',
          collaborative: 0,
          owner_display_name: 'Me',
          owner_external_url: '',
          total_tracks: 1,
          updated_at: '2026-02-05',
        },
      ])
      .execute();
    await db
      .insertInto('spotify_playlist_tracks')
      .values([
        {playlist_id: 'p1', track_id: 'track-1'},
        {playlist_id: 'p1', track_id: 'track-duplicate'},
        {playlist_id: 'p2', track_id: 'track-duplicate'},
      ])
      .execute();

    await db
      .insertInto('spotify_albums')
      .values({
        id: 'a1',
        name: 'The Album',
        artist_name: 'Example',
        total_tracks: 10,
        updated_at: '2026-02-06',
      })
      .execute();
    await db
      .insertInto('spotify_album_tracks')
      .values([
        {album_id: 'a1', track_id: 'track-1', updated_at: '2026-02-06'},
        {
          album_id: 'a1',
          track_id: 'track-duplicate',
          updated_at: '2026-02-06',
        },
      ])
      .execute();

    await db
      .insertInto('chorus_charts')
      .values([
        chart(
          'same-a',
          'Example',
          'example',
          'Same Song',
          'same song',
          'A',
          'a',
        ),
        chart(
          'same-b',
          'Example',
          'example',
          'Same Song',
          'same song',
          'B',
          'b',
        ),
        chart(
          'history',
          'History Only',
          'history only',
          'Remembered',
          'remembered',
          'C',
          'c',
        ),
        chart(
          'library',
          'Library Only',
          'library only',
          'Saved Song',
          'saved song',
          'D',
          'd',
        ),
      ])
      .execute();

    const songs = await getFindMusicSongs(db);
    expect(songs).toHaveLength(3);

    const merged = songs.find(song => song.key === 'example\u001fsame song');
    expect(merged).toMatchObject({
      playCount: 7,
      playlists: ['Favorites', 'Road Trip'],
      albums: ['The Album'],
      spotifyUrl: 'https://open.spotify.com/track/track-1',
    });
    expect(merged?.charts.map(item => item.md5).sort()).toEqual([
      'same-a',
      'same-b',
    ]);
    expect(songs.find(song => song.song === 'Remembered')?.playCount).toBe(9);
    expect(
      songs.find(song => song.song === 'Remembered')?.spotifyUrl,
    ).toBeNull();
    expect(songs.find(song => song.song === 'Saved Song')?.playCount).toBe(0);
  });

  it('projects zero and positive Chorus difficulty values without dropping instruments', async () => {
    await db
      .insertInto('spotify_history')
      .values({
        artist: 'Franz Ferdinand',
        artist_normalized: 'franz ferdinand',
        name: 'Take Me Out',
        name_normalized: 'take me out',
        play_count: 22,
      })
      .execute();
    await db
      .insertInto('chorus_charts')
      .values(
        chart(
          'f3aed706fd4f7ab4723a95be70ddc3b6',
          'Franz Ferdinand',
          'franz ferdinand',
          'Take Me Out',
          'take me out',
          'Harmonix',
          'harmonix',
          {
            diff_drums: 4,
            diff_guitar: 3,
            diff_bass: 0,
            diff_keys: -1,
            diff_drums_real: 4,
          },
        ),
      )
      .execute();

    const [song] = await getFindMusicSongs(db);
    expect(song.charts).toHaveLength(1);
    expect(song.charts[0]).toMatchObject({
      md5: 'f3aed706fd4f7ab4723a95be70ddc3b6',
      instruments: {
        guitar: 3,
        bass: 0,
        keys: -1,
        proDrums: 4,
      },
    });
  });

  it('projects track-level presence when numeric intensities are unavailable', async () => {
    await db
      .insertInto('spotify_history')
      .values({
        artist: 'Coldplay',
        artist_normalized: 'coldplay',
        name: 'Violet Hill',
        name_normalized: 'violet hill',
        play_count: 8,
      })
      .execute();
    await db
      .insertInto('chorus_charts')
      .values(
        chart(
          'b26561a9d61bd5f4d2454a9169a42654',
          'Coldplay',
          'coldplay',
          'Violet Hill',
          'violet hill',
          'Vicarious Visions',
          'vicarious visions',
          {
            diff_guitar: -1,
            diff_bass: -1,
            diff_keys: -1,
            diff_drums_real: -1,
            has_guitar: 1,
            has_bass: 1,
            has_keys: 0,
            has_pro_drums: 0,
          },
        ),
      )
      .execute();

    const [song] = await getFindMusicSongs(db);
    expect(song.charts[0]).toMatchObject({
      md5: 'b26561a9d61bd5f4d2454a9169a42654',
      instruments: {guitar: -1, bass: -1},
      instrumentPresence: {
        guitar: true,
        bass: true,
        keys: false,
        proDrums: false,
      },
    });
  });

  it('marks only the exact normalized artist/song/charter chart as installed', async () => {
    await db
      .insertInto('spotify_history')
      .values({
        artist: 'Artist',
        artist_normalized: 'artist',
        name: 'Song',
        name_normalized: 'song',
        play_count: 1,
      })
      .execute();
    await db
      .insertInto('chorus_charts')
      .values([
        chart(
          'right',
          'Artist',
          'artist',
          'Song',
          'song',
          'Charter A',
          'charter a',
        ),
        chart(
          'wrong',
          'Artist',
          'artist',
          'Song',
          'song',
          'Charter B',
          'charter b',
        ),
      ])
      .execute();
    await db
      .insertInto('local_charts')
      .values({
        artist: 'ARTIST',
        artist_normalized: 'artist',
        song: 'Song',
        song_normalized: 'song',
        charter: 'Charter A',
        charter_normalized: 'charter a',
        modified_time: '2026-01-01',
        data: '{}',
        updated_at: '2026-03-01',
      })
      .execute();

    const [song] = await getFindMusicSongs(db);
    expect(song.hasInstalledChart).toBe(true);
    expect(
      Object.fromEntries(song.charts.map(item => [item.md5, item.isInstalled])),
    ).toEqual({
      right: true,
      wrong: false,
    });
  });

  it('marks a song installed when the local chart charter is absent from Chorus', async () => {
    await db
      .insertInto('spotify_history')
      .values({
        artist: 'All Time Low',
        artist_normalized: 'all time low',
        name: 'Dear Maria, Count Me In',
        name_normalized: 'dear maria count me in',
        play_count: 89,
      })
      .execute();
    await db
      .insertInto('chorus_charts')
      .values(
        chart(
          'neversoft-version',
          'All Time Low',
          'all time low',
          'Dear Maria, Count Me In',
          'dear maria count me in',
          'Neversoft',
          'neversoft',
        ),
      )
      .execute();
    await db
      .insertInto('local_charts')
      .values({
        artist: 'All Time Low',
        artist_normalized: 'all time low',
        song: 'Dear Maria, Count Me In',
        song_normalized: 'dear maria count me in',
        charter: 'Harmonix',
        charter_normalized: 'harmonix',
        modified_time: '2026-01-01',
        data: '{}',
        updated_at: '2026-03-01',
      })
      .execute();

    const [song] = await getFindMusicSongs(db);
    expect(song.hasInstalledChart).toBe(true);
    expect(song.charts).toHaveLength(1);
    expect(song.charts[0].isInstalled).toBe(false);
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

  it('reports source row counts and real available refresh timestamps', async () => {
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

    expect(await getFindMusicStats(db)).toEqual({
      historySongs: 2,
      playlists: 0,
      albums: 0,
      libraryTracks: 2,
      chorusCharts: 0,
      localCharts: 1,
      historyUpdatedAt: null,
      libraryUpdatedAt: '2026-01-03',
      localUpdatedAt: '2026-02-01',
    });
  });
});
