import {Kysely, SqliteDialect} from 'kysely';
import {migration_016_apple_music_library} from '../../migrations/016_apple_music_library';
import {
  activateAppleMusicScan,
  beginAppleMusicScan,
  clearAppleMusicLibrary,
  discardAppleMusicScan,
  getAppleMusicLibraryStats,
  stageAppleMusicTracks,
} from '../index';
import type {DB} from '../../types';

const Database = require('better-sqlite3') as new (path: string) => unknown;

async function makeDb() {
  const db = new Kysely<DB>({
    dialect: new SqliteDialect({database: new Database(':memory:') as never}),
  });
  await migration_016_apple_music_library.up(db);
  return db;
}

describe('Apple Music local library repository', () => {
  it('preserves an active scan when a staged scan is cancelled and cleans orphans', async () => {
    const db = await makeDb();
    try {
      const scanOneToken = await beginAppleMusicScan(db, 'scan-one');
      await stageAppleMusicTracks(db, 'scan-one', [
        {artist: 'Artist', name: 'Active song'},
      ]);
      await activateAppleMusicScan(db, 'scan-one', {
        storefront: 'us',
        reportedTotal: 1,
        fetchedCount: 1,
        usableCount: 1,
        catalogAssociatedCount: 0,
        scanToken: scanOneToken,
      });
      await beginAppleMusicScan(db, 'scan-two');
      await stageAppleMusicTracks(db, 'scan-two', [
        {artist: 'Artist', name: 'Cancelled song'},
      ]);
      await discardAppleMusicScan(db, 'scan-two');

      expect(await getAppleMusicLibraryStats(db)).toMatchObject({
        activeScanId: 'scan-one',
        trackCount: 1,
        fetchedCount: 1,
        usableCount: 1,
        catalogAssociatedCount: 0,
      });
      expect(
        await db.selectFrom('apple_music_tracks').selectAll().execute(),
      ).toHaveLength(1);
    } finally {
      await db.destroy();
    }
  });

  it('atomically replaces the active generation and records a successful empty scan', async () => {
    const db = await makeDb();
    try {
      const oldToken = await beginAppleMusicScan(db, 'old');
      await stageAppleMusicTracks(db, 'old', [
        {artist: 'Artist', catalogId: 'catalog', name: 'Old'},
      ]);
      await activateAppleMusicScan(db, 'old', {
        storefront: 'us',
        reportedTotal: 1,
        fetchedCount: 1,
        usableCount: 1,
        catalogAssociatedCount: 1,
        scanToken: oldToken,
      });
      const emptyToken = await beginAppleMusicScan(db, 'empty');
      await activateAppleMusicScan(db, 'empty', {
        storefront: 'ca',
        reportedTotal: 0,
        fetchedCount: 0,
        usableCount: 0,
        catalogAssociatedCount: 0,
        scanToken: emptyToken,
      });

      expect(await getAppleMusicLibraryStats(db)).toMatchObject({
        activeScanId: 'empty',
        storefront: 'ca',
        reportedTotal: 0,
        fetchedCount: 0,
        usableCount: 0,
        catalogAssociatedCount: 0,
        trackCount: 0,
      });
      expect(
        await db.selectFrom('apple_music_tracks').selectAll().execute(),
      ).toEqual([]);
    } finally {
      await db.destroy();
    }
  });

  it('clears every local Apple row and state on disconnect', async () => {
    const db = await makeDb();
    try {
      const token = await beginAppleMusicScan(db, 'scan');
      await stageAppleMusicTracks(db, 'scan', [
        {artist: ' Artist ', name: ' Song '},
        {artist: '', name: 'Ignored'},
      ]);
      await activateAppleMusicScan(db, 'scan', {
        storefront: 'us',
        reportedTotal: 2,
        fetchedCount: 2,
        usableCount: 1,
        catalogAssociatedCount: 0,
        scanToken: token,
      });
      await clearAppleMusicLibrary(db);

      expect(await getAppleMusicLibraryStats(db)).toEqual({
        activeScanId: null,
        storefront: null,
        reportedTotal: 0,
        fetchedCount: 0,
        usableCount: 0,
        catalogAssociatedCount: 0,
        trackCount: 0,
        updatedAt: null,
      });
      expect(
        await db.selectFrom('apple_music_tracks').selectAll().execute(),
      ).toEqual([]);
    } finally {
      await db.destroy();
    }
  });

  it('enforces the singleton state row', async () => {
    const db = await makeDb();
    try {
      await expect(
        db
          .insertInto('apple_music_library_state')
          .values({
            id: 2,
            active_scan_id: null,
            storefront: null,
            reported_total: 0,
            fetched_count: 0,
            usable_count: 0,
            catalog_associated_count: 0,
            track_count: 0,
            updated_at: new Date().toISOString(),
          })
          .execute(),
      ).rejects.toThrow();
    } finally {
      await db.destroy();
    }
  });

  it('stages a library page larger than SQLite bind-variable limits', async () => {
    const db = await makeDb();
    try {
      await beginAppleMusicScan(db, 'large');
      const rows = Array.from({length: 5_001}, (_, index) => ({
        artist: 'Artist',
        name: `Song ${index}`,
      }));
      await expect(stageAppleMusicTracks(db, 'large', rows)).resolves.toBe(
        5_001,
      );
      const count = await db
        .selectFrom('apple_music_tracks')
        .select(db.fn.count('id').as('count'))
        .executeTakeFirstOrThrow();
      expect(Number(count.count)).toBe(5_001);
    } finally {
      await db.destroy();
    }
  });

  it('rejects activation from a scan cleared after it began', async () => {
    const db = await makeDb();
    try {
      const token = await beginAppleMusicScan(db, 'stale');
      await stageAppleMusicTracks(db, 'stale', [
        {artist: 'Artist', name: 'Song'},
      ]);
      await clearAppleMusicLibrary(db);
      await expect(
        activateAppleMusicScan(db, 'stale', {
          storefront: 'us',
          reportedTotal: 1,
          fetchedCount: 1,
          usableCount: 1,
          catalogAssociatedCount: 0,
          scanToken: token,
        }),
      ).rejects.toThrow('cleared during scan');
      expect(await getAppleMusicLibraryStats(db)).toMatchObject({
        activeScanId: null,
        trackCount: 0,
      });
    } finally {
      await db.destroy();
    }
  });

  it('rejects an older scan as soon as a newer scan begins', async () => {
    const db = await makeDb();
    try {
      const firstToken = await beginAppleMusicScan(db, 'first');
      await beginAppleMusicScan(db, 'second');
      await stageAppleMusicTracks(db, 'first', [{artist: 'A', name: 'One'}]);

      await expect(
        activateAppleMusicScan(db, 'first', {
          storefront: 'us',
          reportedTotal: 1,
          fetchedCount: 1,
          usableCount: 1,
          catalogAssociatedCount: 0,
          scanToken: firstToken,
        }),
      ).rejects.toThrow('superseded by a newer scan');
      await discardAppleMusicScan(db, 'first');
      expect(await getAppleMusicLibraryStats(db)).toMatchObject({
        activeScanId: null,
        trackCount: 0,
      });
    } finally {
      await db.destroy();
    }
  });

  it('does not let a slower older scan overwrite an activated newer scan', async () => {
    const db = await makeDb();
    try {
      const firstToken = await beginAppleMusicScan(db, 'first');
      const secondToken = await beginAppleMusicScan(db, 'second');
      await stageAppleMusicTracks(db, 'first', [{artist: 'A', name: 'One'}]);
      await stageAppleMusicTracks(db, 'second', [{artist: 'B', name: 'Two'}]);
      await activateAppleMusicScan(db, 'second', {
        storefront: 'us',
        reportedTotal: 1,
        fetchedCount: 1,
        usableCount: 1,
        catalogAssociatedCount: 0,
        scanToken: secondToken,
      });
      await expect(
        activateAppleMusicScan(db, 'first', {
          storefront: 'us',
          reportedTotal: 1,
          fetchedCount: 1,
          usableCount: 1,
          catalogAssociatedCount: 0,
          scanToken: firstToken,
        }),
      ).rejects.toThrow('superseded by a newer scan');
      await discardAppleMusicScan(db, 'first');
      expect(await getAppleMusicLibraryStats(db)).toMatchObject({
        activeScanId: 'second',
        trackCount: 1,
      });
      await expect(
        db
          .selectFrom('apple_music_tracks')
          .select(['scan_id', 'name'])
          .execute(),
      ).resolves.toEqual([{scan_id: 'second', name: 'Two'}]);
    } finally {
      await db.destroy();
    }
  });
});
