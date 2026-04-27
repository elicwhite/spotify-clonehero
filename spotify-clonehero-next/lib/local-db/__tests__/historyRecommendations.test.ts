/** @jest-environment node */

import {afterEach, beforeEach, describe, expect, test} from '@jest/globals';
import type {Kysely} from 'kysely';
import scanLocalCharts, {
  type SongAccumulator,
} from '@/lib/local-songs-folder/scanLocalCharts';
import {getHistoryRecommendations} from '../spotify-history/queries';
import {upsertLocalCharts} from '../local-charts';
import {installTestDb, teardownTestDb} from './helpers/testDb';
import {
  seedChorusCharts,
  seedPlaylistWithTracks,
  seedSpotifyHistory,
} from './helpers/spotifySeeders';
import {writeChartLibrary} from './helpers/chartFixtures';
import {makeTmpDir} from './helpers/tmpDir';
import {dirHandleForPath} from './helpers/polyfillFs';
import type {DB} from '../types';

describe('getHistoryRecommendations', () => {
  let db: Kysely<DB>;
  let tmp: {path: string; cleanup: () => Promise<void>};

  beforeEach(async () => {
    db = await installTestDb();
    tmp = await makeTmpDir();
  });

  afterEach(async () => {
    await teardownTestDb(db);
    await tmp.cleanup();
  });

  test('matches across diacritics (Beyoncé vs Beyonce)', async () => {
    await seedChorusCharts(db, [
      {
        md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        name: 'Halo',
        artist: 'Beyoncé',
        charter: 'C1',
      },
    ]);
    await seedSpotifyHistory(db, [
      {artist: 'Beyonce', track: 'Halo', playCount: 7},
    ]);

    const result = await getHistoryRecommendations(db);
    expect(result).toHaveLength(1);
    expect(result[0].artist).toBe('Beyonce');
    expect(result[0].song).toBe('Halo');
    expect(result[0].play_count).toBe(7);
    expect(Array.isArray(result[0].matching_charts)).toBe(true);
    expect(result[0].matching_charts).toHaveLength(1);
    expect(result[0].matching_charts[0].md5).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(Array.isArray(result[0].playlist_memberships)).toBe(true);
    expect(result[0].playlist_memberships).toHaveLength(0);
  });

  test('matches across leading articles (The Beatles vs Beatles)', async () => {
    await seedChorusCharts(db, [
      {
        md5: 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
        name: 'Help',
        artist: 'The Beatles',
        charter: 'C1',
      },
    ]);
    await seedSpotifyHistory(db, [
      {artist: 'Beatles', track: 'Help', playCount: 4},
    ]);

    const result = await getHistoryRecommendations(db);
    expect(result).toHaveLength(1);
    expect(result[0].matching_charts).toHaveLength(1);
  });

  test('strips parenthesized suffixes from history names', async () => {
    await seedChorusCharts(db, [
      {
        md5: '11111111111111111111111111111111',
        name: 'Halo',
        artist: 'Beyonce',
        charter: 'C1',
      },
    ]);
    await seedSpotifyHistory(db, [
      {artist: 'Beyonce', track: 'Halo (Remastered)', playCount: 2},
    ]);

    const result = await getHistoryRecommendations(db);
    expect(result).toHaveLength(1);
    expect(result[0].matching_charts).toHaveLength(1);
  });

  test('strips bracketed suffixes from history names', async () => {
    await seedChorusCharts(db, [
      {
        md5: '22222222222222222222222222222222',
        name: 'Help',
        artist: 'Beatles',
        charter: 'C1',
      },
    ]);
    await seedSpotifyHistory(db, [
      {artist: 'Beatles', track: 'Help [Live]', playCount: 5},
    ]);

    const result = await getHistoryRecommendations(db);
    expect(result).toHaveLength(1);
    expect(result[0].matching_charts).toHaveLength(1);
  });

  test('strips punctuation and lowercases (P.O.D. -> pod, Alive)', async () => {
    await seedChorusCharts(db, [
      {
        md5: '33333333333333333333333333333333',
        name: 'Alive',
        artist: 'P.O.D.',
        charter: 'C1',
      },
    ]);
    await seedSpotifyHistory(db, [
      {artist: 'pod', track: 'alive', playCount: 1},
    ]);

    const result = await getHistoryRecommendations(db);
    expect(result).toHaveLength(1);
    expect(result[0].matching_charts).toHaveLength(1);
  });

  test('flips is_any_local_chart_installed when a local chart exists', async () => {
    await writeChartLibrary(tmp.path, [
      {artist: 'Beyoncé', song: 'Halo', charter: 'C1', format: 'folder'},
    ]);
    const acc: SongAccumulator[] = [];
    await scanLocalCharts(await dirHandleForPath(tmp.path), acc, () => {});
    await upsertLocalCharts(acc);

    await seedChorusCharts(db, [
      {
        md5: '44444444444444444444444444444444',
        name: 'Halo',
        artist: 'Beyoncé',
        charter: 'C1',
      },
    ]);
    await seedSpotifyHistory(db, [
      {artist: 'Beyonce', track: 'Halo', playCount: 3},
    ]);

    const result = await getHistoryRecommendations(db);
    expect(result).toHaveLength(1);
    expect(result[0].is_any_local_chart_installed).toBe(1);
    expect(result[0].matching_charts[0].isInstalled).toBe(1);
  });

  test('per-chart isInstalled reflects per-charter local match (only matching charter flips on)', async () => {
    // Local chart by C1 only.
    await writeChartLibrary(tmp.path, [
      {artist: 'Beyoncé', song: 'Halo', charter: 'C1', format: 'folder'},
    ]);
    const acc: SongAccumulator[] = [];
    await scanLocalCharts(await dirHandleForPath(tmp.path), acc, () => {});
    await upsertLocalCharts(acc);

    // Two chorus charts: C1 (matches local) and C2 (doesn't).
    await seedChorusCharts(db, [
      {
        md5: 'cccccccccccccccccccccccccccccccc',
        name: 'Halo',
        artist: 'Beyoncé',
        charter: 'C1',
      },
      {
        md5: 'dddddddddddddddddddddddddddddddd',
        name: 'Halo',
        artist: 'Beyoncé',
        charter: 'C2',
      },
    ]);
    await seedSpotifyHistory(db, [
      {artist: 'Beyonce', track: 'Halo', playCount: 1},
    ]);

    const result = await getHistoryRecommendations(db);
    expect(result).toHaveLength(1);
    expect(result[0].matching_charts).toHaveLength(2);
    const byMd5 = new Map(result[0].matching_charts.map(c => [c.md5, c]));
    expect(byMd5.get('cccccccccccccccccccccccccccccccc')!.isInstalled).toBe(1);
    expect(byMd5.get('dddddddddddddddddddddddddddddddd')!.isInstalled).toBe(0);
    // Song-level flag is on because *some* charter matches.
    expect(result[0].is_any_local_chart_installed).toBe(1);
  });

  test('history with no chorus match is excluded (inner join semantics)', async () => {
    await seedSpotifyHistory(db, [
      {artist: 'Nobody', track: 'Nowhere', playCount: 99},
    ]);

    const result = await getHistoryRecommendations(db);
    expect(result).toHaveLength(0);
  });

  test('playlist_memberships is an empty array when there is no playlist match', async () => {
    await seedChorusCharts(db, [
      {
        md5: '55555555555555555555555555555555',
        name: 'Halo',
        artist: 'Beyoncé',
        charter: 'C1',
      },
    ]);
    await seedSpotifyHistory(db, [
      {artist: 'Beyonce', track: 'Halo', playCount: 1},
    ]);

    const result = await getHistoryRecommendations(db);
    expect(result).toHaveLength(1);
    expect(result[0].playlist_memberships).toEqual([]);
  });

  test('multiple playlists containing the same song all surface in playlist_memberships', async () => {
    await seedChorusCharts(db, [
      {
        md5: '66666666666666666666666666666666',
        name: 'Halo',
        artist: 'Beyoncé',
        charter: 'C1',
      },
    ]);
    await seedSpotifyHistory(db, [
      {artist: 'Beyonce', track: 'Halo', playCount: 1},
    ]);

    const sharedTrack = {
      id: 'spotify:track:halo',
      name: 'Halo',
      artists: ['Beyoncé'],
    };
    await seedPlaylistWithTracks(
      {
        id: 'pl-1',
        snapshot_id: 'snap-1',
        name: 'Workout',
        collaborative: false,
        owner_display_name: 'tester',
        owner_external_url: 'https://example.com/tester',
        total_tracks: 1,
      },
      [sharedTrack],
    );
    await seedPlaylistWithTracks(
      {
        id: 'pl-2',
        snapshot_id: 'snap-2',
        name: 'Chill',
        collaborative: false,
        owner_display_name: 'tester',
        owner_external_url: 'https://example.com/tester',
        total_tracks: 1,
      },
      [sharedTrack],
    );

    const result = await getHistoryRecommendations(db);
    expect(result).toHaveLength(1);
    expect(result[0].playlist_memberships).toHaveLength(2);
    const ids = result[0].playlist_memberships.map(p => p.id).sort();
    expect(ids).toEqual(['pl-1', 'pl-2']);
  });

  test('orders results by play_count descending', async () => {
    await seedChorusCharts(db, [
      {
        md5: '77777777777777777777777777777777',
        name: 'Halo',
        artist: 'Beyoncé',
        charter: 'C1',
      },
      {
        md5: '88888888888888888888888888888888',
        name: 'Help',
        artist: 'Beatles',
        charter: 'C1',
      },
    ]);
    await seedSpotifyHistory(db, [
      {artist: 'Beyonce', track: 'Halo', playCount: 2},
      {artist: 'Beatles', track: 'Help', playCount: 50},
    ]);

    const result = await getHistoryRecommendations(db);
    expect(result.map(r => r.song)).toEqual(['Help', 'Halo']);
  });

  test('preserves Cyrillic text (not folded, just lowercased)', async () => {
    await seedChorusCharts(db, [
      {
        md5: '99999999999999999999999999999999',
        name: 'Дурной Вкус',
        artist: 'Кино',
        charter: 'C1',
      },
    ]);
    await seedSpotifyHistory(db, [
      {artist: 'Кино', track: 'Дурной Вкус', playCount: 3},
    ]);

    const result = await getHistoryRecommendations(db);
    expect(result).toHaveLength(1);
    expect(result[0].matching_charts).toHaveLength(1);
  });

  test('full E2E: write 3 charts (mixed folder + sng), scan, seed history + playlist + chorus, query', async () => {
    // Two folder charts and one .sng — exercises both scan paths.
    await writeChartLibrary(tmp.path, [
      {artist: 'Beyoncé', song: 'Halo', charter: 'C1', format: 'folder'},
      {artist: 'Beatles', song: 'Help', charter: 'C1', format: 'folder'},
      {artist: 'P.O.D.', song: 'Alive', charter: 'C1', format: 'sng'},
    ]);
    const acc: SongAccumulator[] = [];
    await scanLocalCharts(await dirHandleForPath(tmp.path), acc, () => {});
    expect(acc).toHaveLength(3);
    await upsertLocalCharts(acc);

    // Two chorus charts: Halo matches a local chart, Single Ladies doesn't.
    await seedChorusCharts(db, [
      {
        md5: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        name: 'Halo',
        artist: 'Beyoncé',
        charter: 'C1',
      },
      {
        md5: 'ffffffffffffffffffffffffffffffff',
        name: 'Single Ladies',
        artist: 'Beyoncé',
        charter: 'C1',
      },
    ]);

    // Add Halo to a Spotify playlist.
    await seedPlaylistWithTracks(
      {
        id: 'pl-fav',
        snapshot_id: 'snap-fav',
        name: 'Favorites',
        collaborative: false,
        owner_display_name: 'tester',
        owner_external_url: 'https://example.com/tester',
        total_tracks: 1,
      },
      [
        {
          id: 'spotify:track:halo',
          name: 'Halo',
          artists: ['Beyoncé'],
        },
      ],
    );

    // Listening history covers both Halo (installed) and Single Ladies (not).
    await seedSpotifyHistory(db, [
      {artist: 'Beyonce', track: 'Halo (Remastered)', playCount: 9},
      {artist: 'Beyonce', track: 'Single Ladies', playCount: 4},
    ]);

    const result = await getHistoryRecommendations(db);
    // Both history entries match a chorus chart.
    expect(result).toHaveLength(2);

    const halo = result.find(r => r.song.includes('Halo'))!;
    expect(halo.play_count).toBe(9);
    expect(halo.matching_charts).toHaveLength(1);
    expect(halo.matching_charts[0].md5).toBe(
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    );
    expect(halo.matching_charts[0].isInstalled).toBe(1);
    expect(halo.is_any_local_chart_installed).toBe(1);
    expect(halo.playlist_memberships).toHaveLength(1);
    expect(halo.playlist_memberships[0].id).toBe('pl-fav');

    const ladies = result.find(r => r.song === 'Single Ladies')!;
    expect(ladies.play_count).toBe(4);
    expect(ladies.matching_charts).toHaveLength(1);
    expect(ladies.matching_charts[0].md5).toBe(
      'ffffffffffffffffffffffffffffffff',
    );
    expect(ladies.matching_charts[0].isInstalled).toBe(0);
    expect(ladies.is_any_local_chart_installed).toBe(0);
    expect(ladies.playlist_memberships).toEqual([]);

    // Ordering: play_count desc — Halo (9) comes before Single Ladies (4).
    expect(result[0].song).toContain('Halo');
  });
});
