import {getLocalDb} from '../client';
import {ChorusCharts, ChorusMetadata} from '../types';
import {ChartResponseEncore} from '@/lib/chartSelection';
import {Insertable} from 'kysely';
import {
  createScanSession,
  updateScanProgress,
  completeScanSession,
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
  console.log('Setting charts data version to', version);
  await setMetadata('charts_data_version', version.toString());
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
export {createScanSession, updateScanProgress, completeScanSession};
