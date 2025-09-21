import {getLocalDb} from '../client';
import {ChorusCharts, ChorusMetadata} from '../types';
import {ChartResponseEncore} from '@/lib/chartSelection';
import {Insertable} from 'kysely';
import {
  createScanSession,
  updateScanProgress,
  completeScanSession,
  failScanSession,
  getIncompleteScanSession,
  cancelOldScanSessions,
} from './scanning';

// Helper function to get current timestamp
function nowIso(): string {
  return new Date().toISOString();
}

// Chart operations
export async function upsertCharts(
  charts: ChartResponseEncore[],
): Promise<void> {
  if (charts.length === 0) return;
  const db = await getLocalDb();

  await db.transaction().execute(async trx => {
    const chartRows = charts.map(chart => ({
      md5: chart.md5,
      name: chart.name,
      artist: chart.artist,
      charter: chart.charter,
      diff_drums: chart.diff_drums ?? null,
      diff_guitar: chart.diff_guitar ?? null,
      diff_bass: chart.diff_bass ?? null,
      diff_keys: chart.diff_keys ?? null,
      diff_drums_real: chart.diff_drums_real ?? null,
      modified_time: chart.modifiedTime,
      song_length: chart.song_length ?? null,
      has_video_background: chart.hasVideoBackground,
      album_art_md5: chart.albumArtMd5 ?? null,
      group_id: chart.groupId ?? 0,
    }));

    await trx
      .insertInto('chorus_charts')
      .values(chartRows)
      .onConflict(oc =>
        oc.column('md5').doUpdateSet(eb => ({
          name: eb.ref('excluded.name'),
          artist: eb.ref('excluded.artist'),
          charter: eb.ref('excluded.charter'),
          diff_drums: eb.ref('excluded.diff_drums'),
          diff_guitar: eb.ref('excluded.diff_guitar'),
          diff_bass: eb.ref('excluded.diff_bass'),
          diff_keys: eb.ref('excluded.diff_keys'),
          diff_drums_real: eb.ref('excluded.diff_drums_real'),
          modified_time: eb.ref('excluded.modified_time'),
          song_length: eb.ref('excluded.song_length'),
          has_video_background: eb.ref('excluded.has_video_background'),
          album_art_md5: eb.ref('excluded.album_art_md5'),
          group_id: eb.ref('excluded.group_id'),
        })),
      )
      .execute();
  });
}

export async function getAllCharts(): Promise<ChartResponseEncore[]> {
  const db = await getLocalDb();
  const rows = await db
    .selectFrom('chorus_charts')
    .selectAll()
    .orderBy('modified_time', 'desc')
    .execute();

  return rows.map(row => ({
    md5: row.md5,
    name: row.name,
    artist: row.artist,
    charter: row.charter,
    diff_drums: row.diff_drums,
    diff_guitar: row.diff_guitar,
    diff_bass: row.diff_bass,
    diff_keys: row.diff_keys,
    diff_drums_real: row.diff_drums_real,
    modifiedTime: row.modified_time,
    song_length: row.song_length,
    hasVideoBackground: row.has_video_background,
    albumArtMd5: row.album_art_md5 ?? '',
    groupId: row.group_id,
    // These fields are calculated dynamically
    file: '', // Will be calculated when needed
    notesData: null as any, // Not stored in database
  }));
}

export async function findChartsByArtistAndName(
  artist: string,
  name: string,
): Promise<ChartResponseEncore[]> {
  const db = await getLocalDb();
  const rows = await db
    .selectFrom('chorus_charts')
    .selectAll()
    .where('artist', '=', artist)
    .where('name', '=', name)
    .orderBy('modified_time', 'desc')
    .execute();

  return rows.map(row => ({
    md5: row.md5,
    name: row.name,
    artist: row.artist,
    charter: row.charter,
    diff_drums: row.diff_drums,
    diff_guitar: row.diff_guitar,
    diff_bass: row.diff_bass,
    diff_keys: row.diff_keys,
    diff_drums_real: row.diff_drums_real,
    modifiedTime: row.modified_time,
    song_length: row.song_length,
    hasVideoBackground: row.has_video_background,
    albumArtMd5: row.album_art_md5 ?? '',
    groupId: row.group_id,
    file: '',
    notesData: null as any,
  }));
}

export async function clearAllCharts(): Promise<void> {
  const db = await getLocalDb();
  await db.deleteFrom('chorus_charts').execute();
}

// Metadata operations
export async function getMetadata(key: string): Promise<string | null> {
  const db = await getLocalDb();

  const row = await db
    .selectFrom('chorus_metadata')
    .select('value')
    .where('key', '=', key)
    .executeTakeFirst();

  return row?.value || null;
}

export async function setMetadata(key: string, value: string): Promise<void> {
  const db = await getLocalDb();

  await db
    .insertInto('chorus_metadata')
    .values({
      key,
      value,
      updated_at: nowIso(),
    })
    .onConflict(oc =>
      oc.column('key').doUpdateSet(eb => ({
        value: eb.ref('excluded.value'),
        updated_at: nowIso(),
      })),
    )
    .execute();
}

export async function getChartsDataVersion(): Promise<number> {
  const version = await getMetadata('charts_data_version');
  return version ? parseInt(version, 10) : 0;
}

export async function setChartsDataVersion(version: number): Promise<void> {
  await setMetadata('charts_data_version', version.toString());
}

export async function getLastSuccessfulScan(): Promise<Date | null> {
  const lastScan = await getMetadata('last_successful_scan');
  return lastScan ? new Date(lastScan) : null;
}

export async function getLastInstalledChartsScan(): Promise<Date | null> {
  const lastScan = await getMetadata('last_installed_charts_scan');
  return lastScan ? new Date(lastScan) : null;
}

export async function setLastInstalledChartsScan(): Promise<void> {
  await setMetadata('last_installed_charts_scan', nowIso());
}

// Migration helper functions
export async function migrateFromIndexedDB(): Promise<ChartResponseEncore[]> {
  const db = await getLocalDb();

  // Check if we already have charts in the database
  const existingCharts = await db
    .selectFrom('chorus_charts')
    .select(db.fn.count('md5').as('count'))
    .executeTakeFirst();

  if (Number(existingCharts?.count || 0) > 0) {
    console.log('[Chorus] Charts already migrated to database');
    return await getAllCharts();
  }

  console.log('[Chorus] Starting migration from IndexedDB to SQLite');

  try {
    // Get the OPFS root directory
    const root = await navigator.storage.getDirectory();

    // Load charts from IndexedDB/OPFS
    const indexedDbCharts = await loadChartsFromIndexedDB(root);

    if (indexedDbCharts.length === 0) {
      console.log('[Chorus] No charts found in IndexedDB');
      return [];
    }

    console.log(
      `[Chorus] Found ${indexedDbCharts.length} charts in IndexedDB, migrating to SQLite`,
    );

    // Upsert all charts to the database
    await upsertCharts(indexedDbCharts);

    console.log(
      `[Chorus] Successfully migrated ${indexedDbCharts.length} charts to SQLite`,
    );

    // Return the migrated charts
    return indexedDbCharts;
  } catch (error) {
    console.error('[Chorus] Migration failed:', error);
    return [];
  }
}

// Helper function to load charts from IndexedDB/OPFS
async function loadChartsFromIndexedDB(
  root: FileSystemDirectoryHandle,
): Promise<ChartResponseEncore[]> {
  const charts: ChartResponseEncore[] = [];

  try {
    // Try to load from localData directory (updated charts)
    const localDataHandle = await root.getDirectoryHandle('localData', {
      create: false,
    });

    for await (const subHandle of localDataHandle.values()) {
      if (subHandle.kind === 'file' && subHandle.name.endsWith('.json')) {
        const file = await subHandle.getFile();
        const text = await file.text();
        const json = JSON.parse(text);
        charts.push(...json);
      }
    }
  } catch (error) {
    console.log('[Chorus] No localData directory found, trying serverData');
  }

  // If no local charts, try server data
  if (charts.length === 0) {
    try {
      const serverDataHandle = await root.getDirectoryHandle('serverData', {
        create: false,
      });
      const serverChartsHandle = await serverDataHandle.getFileHandle(
        'charts.json',
        {create: false},
      );
      const file = await serverChartsHandle.getFile();
      const text = await file.text();
      const json = JSON.parse(text);
      charts.push(...json);
    } catch (error) {
      console.log('[Chorus] No serverData found either');
    }
  }

  return charts;
}

export async function clearAllData(): Promise<void> {
  const db = await getLocalDb();

  await db.transaction().execute(async trx => {
    await trx.deleteFrom('chorus_charts').execute();
    await trx.deleteFrom('chorus_scan_sessions').execute();
    await trx.deleteFrom('chorus_metadata').execute();
  });
}

// Re-export scan session functions
export {
  createScanSession,
  updateScanProgress,
  completeScanSession,
  failScanSession,
  getIncompleteScanSession,
  cancelOldScanSessions,
};
