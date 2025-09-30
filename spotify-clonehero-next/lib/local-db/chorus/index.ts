import {getLocalDb} from '../client';
import {ChorusCharts, ChorusMetadata, DB} from '../types';
import {ChartResponseEncore} from '@/lib/chartSelection';
import {ColumnDefinitionBuilder, Kysely, Transaction, sql} from 'kysely';
import {normalizeStrForMatching} from '../normalize';
import {
  createScanSession,
  updateScanProgress,
  completeScanSession,
} from './scanning';
import {recalculateTrackChartMatches} from '../queries';

const MAX_VARIABLE_NUMBER = 32766;

// Helper function to get current timestamp
function nowIso(): string {
  return new Date().toISOString();
}

// Chart operations
export async function upsertCharts(
  trx: Transaction<DB>,
  charts: ChartResponseEncore[],
): Promise<void> {
  if (charts.length === 0) return;
  const before = performance.now();

  const BATCH_SIZE = Math.floor(MAX_VARIABLE_NUMBER / 17);
  const chartRows = charts
    .filter(
      // Some charts seem to have invalid data.
      // Like d060a6baec3c135b60f533a610bafad0
      chart =>
        chart.artist != null &&
        chart.name != null &&
        chart.charter != null &&
        chart.md5 != null,
    )
    .map(chart => ({
      md5: chart.md5,
      name: chart.name,
      artist: chart.artist,
      charter: chart.charter,
      artist_normalized: normalizeStrForMatching(chart.artist),
      charter_normalized: normalizeStrForMatching(chart.charter),
      name_normalized: normalizeStrForMatching(chart.name),
      diff_drums: chart.diff_drums ?? null,
      diff_guitar: chart.diff_guitar ?? null,
      diff_bass: chart.diff_bass ?? null,
      diff_keys: chart.diff_keys ?? null,
      diff_drums_real: chart.diff_drums_real ?? null,
      modified_time: chart.modifiedTime,
      song_length: chart.song_length ?? null,
      // types currently define boolean columns as numbers in generated types
      has_video_background: chart.hasVideoBackground ? 1 : 0,
      album_art_md5: chart.albumArtMd5 ?? null,
      group_id: chart.groupId ?? 0,
    }));

  const tempTable = '_temp_chorus_charts';

  await trx.schema
    .createTable(tempTable)
    .temporary()
    .as(
      trx
        .selectFrom('chorus_charts')
        .selectAll()
        .where(sql<boolean>`0`),
    )
    .execute();

  console.log('inserting batches');
  // Bulk load into the temp table first (respecting SQLite variable limits)
  for (let i = 0; i < chartRows.length; i += BATCH_SIZE) {
    console.log('inserting batch #', i / BATCH_SIZE + 1);
    const batch = chartRows.slice(i, i + BATCH_SIZE);
    try {
      await trx
        .insertInto(tempTable as any)
        .values(batch)
        .execute();
    } catch (error) {
      console.error('Error staging charts into temp table:', error);
      throw error;
    }
  }

  // Insert only rows that don't already exist in chorus_charts by md5
  await trx
    .insertInto('chorus_charts')
    .ignore()
    .columns([
      'md5',
      'name',
      'artist',
      'charter',
      'artist_normalized',
      'charter_normalized',
      'name_normalized',
      'diff_drums',
      'diff_guitar',
      'diff_bass',
      'diff_keys',
      'diff_drums_real',
      'modified_time',
      'song_length',
      'has_video_background',
      'album_art_md5',
      'group_id',
    ])
    .expression(eb =>
      eb
        .selectFrom(`${tempTable} as t` as any)
        .select([
          'md5',
          'name',
          'artist',
          'charter',
          'artist_normalized',
          'charter_normalized',
          'name_normalized',
          'diff_drums',
          'diff_guitar',
          'diff_bass',
          'diff_keys',
          'diff_drums_real',
          'modified_time',
          'song_length',
          'has_video_background',
          'album_art_md5',
          'group_id',
        ])
        .orderBy('md5'),
    )
    .execute();

  // Drop the temp table
  await trx.schema.dropTable(tempTable).execute();

  await recalculateTrackChartMatches(trx);

  const after = performance.now();
  console.log('Upserted charts in', (after - before) / 1000, 'seconds');
}

export async function clearAllCharts(db: Kysely<DB>): Promise<void> {
  await db.deleteFrom('chorus_charts').execute();
  await recalculateTrackChartMatches(db);
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

export async function setMetadata(
  db: Kysely<DB>,
  key: string,
  value: string,
): Promise<void> {
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

export async function setChartsDataVersion(
  db: Kysely<DB>,
  version: number,
): Promise<void> {
  console.log('Setting charts data version to', version);
  await setMetadata(db, 'charts_data_version', version.toString());
}

export async function clearAllData(): Promise<void> {
  const db = await getLocalDb();

  await db.transaction().execute(async trx => {
    await trx.deleteFrom('chorus_charts').execute();
    await trx.deleteFrom('chorus_scan_sessions').execute();
    await trx.deleteFrom('chorus_metadata').execute();
    await recalculateTrackChartMatches(trx);
  });
}

// Re-export scan session functions
export {createScanSession, updateScanProgress, completeScanSession};
