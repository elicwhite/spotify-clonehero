import {Kysely, SqliteDialect, type Insertable} from 'kysely';

import type {DB} from '../../../lib/local-db/types';
import {getFindMusicSongs, getFindMusicStats} from '../queries';

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
        {playlist_id: 'p2', track_id: 'library-only'},
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
      inAppleMusicLibrary: false,
    });
    expect(merged?.providerActions).toEqual([
      {
        provider: 'spotify',
        trackId: 'track-1',
        url: 'https://open.spotify.com/track/track-1',
        artist: 'Example',
        song: 'Same Song',
      },
      {
        provider: 'spotify',
        trackId: 'track-duplicate',
        url: 'https://open.spotify.com/track/track-duplicate',
        artist: 'The Example',
        song: 'Same Song (Single)',
      },
    ]);
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

  it('ignores orphaned Spotify rows while preserving tracks shared by a current source', async () => {
    await db
      .insertInto('spotify_tracks')
      .values([
        {
          id: 'shared',
          artist: 'Current Artist',
          artist_normalized: 'current artist',
          name: 'Shared Song',
          name_normalized: 'shared song',
          updated_at: '2026-02-04',
        },
        {
          id: 'playlist-only',
          artist: 'Current Artist',
          artist_normalized: 'current artist',
          name: 'Playlist Song',
          name_normalized: 'playlist song',
          updated_at: '2026-02-03',
        },
        {
          id: 'removed-source',
          artist: 'Removed Artist',
          artist_normalized: 'removed artist',
          name: 'Removed Song',
          name_normalized: 'removed song',
          updated_at: '2026-02-20',
        },
        {
          id: 'unlinked',
          artist: 'Orphan Artist',
          artist_normalized: 'orphan artist',
          name: 'Orphan Song',
          name_normalized: 'orphan song',
          updated_at: '2026-02-21',
        },
      ])
      .execute();
    await db
      .insertInto('spotify_playlists')
      .values({
        id: 'active-playlist',
        snapshot_id: 'active-snapshot',
        name: 'Active playlist',
        collaborative: 0,
        owner_display_name: 'Me',
        owner_external_url: '',
        total_tracks: 2,
        updated_at: '2026-02-05',
      })
      .execute();
    await db
      .insertInto('spotify_playlist_tracks')
      .values([
        {playlist_id: 'active-playlist', track_id: 'shared'},
        {playlist_id: 'active-playlist', track_id: 'playlist-only'},
        // Simulates a dangling link on databases where FK cascades were off.
        {playlist_id: 'deleted-playlist', track_id: 'removed-source'},
      ])
      .execute();
    await db
      .insertInto('spotify_albums')
      .values({
        id: 'active-album',
        name: 'Active album',
        artist_name: 'Current Artist',
        total_tracks: 1,
        updated_at: '2026-02-06',
      })
      .execute();
    await db
      .insertInto('spotify_album_tracks')
      .values({
        album_id: 'active-album',
        track_id: 'shared',
        updated_at: '2026-02-06',
      })
      .execute();
    await db
      .insertInto('chorus_charts')
      .values([
        chart(
          'shared-chart',
          'Current Artist',
          'current artist',
          'Shared Song',
          'shared song',
          'A',
          'a',
        ),
        chart(
          'playlist-chart',
          'Current Artist',
          'current artist',
          'Playlist Song',
          'playlist song',
          'A',
          'a',
        ),
        chart(
          'removed-chart',
          'Removed Artist',
          'removed artist',
          'Removed Song',
          'removed song',
          'A',
          'a',
        ),
        chart(
          'orphan-chart',
          'Orphan Artist',
          'orphan artist',
          'Orphan Song',
          'orphan song',
          'A',
          'a',
        ),
      ])
      .execute();

    await expect(getFindMusicStats(db)).resolves.toMatchObject({
      spotifyLibraryTracks: 2,
      libraryTracks: 2,
    });
    await expect(getFindMusicSongs(db)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({song: 'Shared Song'}),
        expect.objectContaining({song: 'Playlist Song'}),
      ]),
    );
    expect((await getFindMusicSongs(db)).map(song => song.song)).not.toEqual(
      expect.arrayContaining(['Removed Song', 'Orphan Song']),
    );

    // The playlist links deliberately remain, mirroring a non-cascading legacy
    // database. Shared Song remains current through its album membership.
    await db
      .deleteFrom('spotify_playlists')
      .where('id', '=', 'active-playlist')
      .execute();

    await expect(getFindMusicStats(db)).resolves.toMatchObject({
      spotifyLibraryTracks: 1,
      libraryTracks: 1,
    });
    await expect(getFindMusicSongs(db)).resolves.toMatchObject([
      {
        song: 'Shared Song',
        providerActions: [
          expect.objectContaining({provider: 'spotify', trackId: 'shared'}),
        ],
      },
    ]);
  });

  it('returns only active-scan Apple Music songs and retains catalog-less membership evidence', async () => {
    await setAppleMusicState(db, {
      reported_total: 3,
      fetched_count: 3,
      usable_count: 3,
      catalog_associated_count: 2,
      track_count: 2,
    });
    await db
      .insertInto('apple_music_tracks')
      .values([
        {
          scan_id: 'active-scan',
          catalog_id: 'apple-catalog-1',
          artist: 'Apple Artist',
          artist_normalized: 'apple artist',
          name: 'Catalog Song',
          name_normalized: 'catalog song',
          updated_at: '2026-03-01',
        },
        {
          scan_id: 'active-scan',
          catalog_id: null,
          artist: 'Apple Artist',
          artist_normalized: 'apple artist',
          name: 'Uploaded Song',
          name_normalized: 'uploaded song',
          updated_at: '2026-03-01',
        },
        {
          scan_id: 'stale-scan',
          catalog_id: 'stale-catalog',
          artist: 'Stale Artist',
          artist_normalized: 'stale artist',
          name: 'Stale Song',
          name_normalized: 'stale song',
          updated_at: '2026-02-01',
        },
      ])
      .execute();
    await db
      .insertInto('chorus_charts')
      .values([
        chart(
          'apple-catalog-chart',
          'Apple Artist',
          'apple artist',
          'Catalog Song',
          'catalog song',
          'A',
          'a',
        ),
        chart(
          'apple-upload-chart',
          'Apple Artist',
          'apple artist',
          'Uploaded Song',
          'uploaded song',
          'A',
          'a',
        ),
        chart(
          'stale-chart',
          'Stale Artist',
          'stale artist',
          'Stale Song',
          'stale song',
          'A',
          'a',
        ),
      ])
      .execute();

    const songs = await getFindMusicSongs(db);
    expect(songs.map(song => song.song)).toEqual([
      'Catalog Song',
      'Uploaded Song',
    ]);
    expect(songs[0]).toMatchObject({
      spotifyUrl: null,
      inAppleMusicLibrary: true,
      providerActions: [
        {
          provider: 'appleMusic',
          catalogId: 'apple-catalog-1',
          artist: 'Apple Artist',
          song: 'Catalog Song',
        },
      ],
    });
    expect(songs[1]).toMatchObject({
      spotifyUrl: null,
      inAppleMusicLibrary: true,
      providerActions: [],
    });
  });

  it('deduplicates cross-provider identities while retaining every distinct provider action', async () => {
    await setAppleMusicState(db, {track_count: 2});
    await db
      .insertInto('spotify_tracks')
      .values({
        id: 'spotify-version',
        artist: 'The Shared Artist',
        artist_normalized: 'shared artist',
        name: 'Shared Song - Remaster',
        name_normalized: 'shared song',
        updated_at: '2026-02-01',
      })
      .execute();
    await setSpotifyPlaylistMembership(db, ['spotify-version']);
    await db
      .insertInto('apple_music_tracks')
      .values([
        {
          scan_id: 'active-scan',
          catalog_id: 'apple-version-a',
          artist: 'Shared Artist',
          artist_normalized: 'shared artist',
          name: 'Shared Song',
          name_normalized: 'shared song',
          updated_at: '2026-03-01',
        },
        {
          scan_id: 'active-scan',
          catalog_id: 'apple-version-b',
          artist: 'Shared Artist',
          artist_normalized: 'shared artist',
          name: 'Shared Song (Deluxe)',
          name_normalized: 'shared song',
          updated_at: '2026-03-01',
        },
      ])
      .execute();
    await db
      .insertInto('chorus_charts')
      .values(
        chart(
          'shared-chart',
          'Shared Artist',
          'shared artist',
          'Shared Song',
          'shared song',
          'A',
          'a',
        ),
      )
      .execute();

    const songs = await getFindMusicSongs(db);
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({
      key: 'shared artist\u001fshared song',
      inAppleMusicLibrary: true,
      spotifyUrl: 'https://open.spotify.com/track/spotify-version',
    });
    expect(songs[0].providerActions).toEqual([
      {
        provider: 'appleMusic',
        catalogId: 'apple-version-a',
        artist: 'Shared Artist',
        song: 'Shared Song',
      },
      {
        provider: 'appleMusic',
        catalogId: 'apple-version-b',
        artist: 'Shared Artist',
        song: 'Shared Song (Deluxe)',
      },
      {
        provider: 'spotify',
        trackId: 'spotify-version',
        url: 'https://open.spotify.com/track/spotify-version',
        artist: 'The Shared Artist',
        song: 'Shared Song - Remaster',
      },
    ]);
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
        drums: 4,
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
            has_drums: 0,
            has_other_instruments: 0,
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
        drums: false,
      },
    });
  });

  it('collapses chart revisions that share an upload group', async () => {
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
        chart('old', 'Artist', 'artist', 'Song', 'song', 'Ana', 'ana', {
          group_id: 4,
          modified_time: '2023-01-01',
        }),
        chart('new', 'Artist', 'artist', 'Song', 'song', 'Ana', 'ana', {
          group_id: 4,
          modified_time: '2026-01-01',
        }),
        chart('other', 'Artist', 'artist', 'Song', 'song', 'Bo', 'bo', {
          group_id: 5,
        }),
      ])
      .execute();

    const [song] = await getFindMusicSongs(db);
    expect(song.charts.map(item => item.md5)).toEqual(['new', 'other']);
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
});
