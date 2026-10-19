import {getLocalDb} from '../client';
import {DB} from '../types';
import {
  CORE_INSTRUMENTS,
  type ChorusChartDbRow,
} from '@/lib/chorusChartDb/types';
import {Kysely, Transaction, sql} from 'kysely';
import {normalizeStrForMatching} from '../normalize';
import {
  createScanSession,
  updateScanProgress,
  completeScanSession,
} from './scanning';

const MAX_VARIABLE_NUMBER = 32766;

// Helper function to get current timestamp
function nowIso(): string {
  return new Date().toISOString();
}

// Chart operations
export async function upsertCharts(
  trx: Transaction<DB>,
  charts: ChorusChartDbRow[],
): Promise<void> {
  if (charts.length === 0) return;
  const before = performance.now();

  // Stamped once per scan so every chart discovered in the same pass shares a
  // first_seen. Existing rows keep theirs: first_seen is deliberately absent
  // from the conflict update below.
  const scanStartedAt = nowIso();

  const chartRows = charts.map(chart => {
    const trackInstruments = new Set<string>();
    for (const instrument of chart.notesData?.instruments ?? []) {
      if (typeof instrument === 'string') trackInstruments.add(instrument);
    }
    for (const track of chart.notesData?.trackHashes ?? []) {
      if (typeof track.instrument === 'string') {
        trackInstruments.add(track.instrument);
      }
    }
    // Anything outside the rendered four counts as "other", including an
    // instrument Encore adds before this code knows about it.
    const hasOtherInstruments = [...trackInstruments].some(
      instrument =>
        !(CORE_INSTRUMENTS as readonly string[]).includes(instrument),
    );

    return {
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
      has_guitar: trackInstruments.has('guitar') ? 1 : 0,
      has_bass: trackInstruments.has('bass') ? 1 : 0,
      has_keys: trackInstruments.has('keys') ? 1 : 0,
      has_drums: trackInstruments.has('drums') ? 1 : 0,
      has_other_instruments: hasOtherInstruments ? 1 : 0,
      drum_type: chart.notesData?.drumType ?? null,
      modified_time: chart.modifiedTime,
      song_length: chart.song_length ?? null,
      // types currently define boolean columns as numbers in generated types
      has_video_background: chart.hasVideoBackground ? 1 : 0,
      album_art_md5: chart.albumArtMd5 ?? null,
      group_id: chart.groupId,
      first_seen: scanStartedAt,
    };
  });

  if (chartRows.length === 0) return;

  // Derived from the row rather than hard-coded so adding or removing a column
  // cannot silently push a batch past SQLite's bound-variable limit.
  const BATCH_SIZE = Math.floor(
    MAX_VARIABLE_NUMBER / Object.keys(chartRows[0]).length,
  );

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

  // Refresh existing rows as Chorus metadata can change without changing md5.
  await trx
    .insertInto('chorus_charts')
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
      'has_guitar',
      'has_bass',
      'has_keys',
      'has_drums',
      'has_other_instruments',
      'drum_type',
      'modified_time',
      'song_length',
      'has_video_background',
      'album_art_md5',
      'group_id',
      'first_seen',
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
          'has_guitar',
          'has_bass',
          'has_keys',
          'has_drums',
          'has_other_instruments',
          'drum_type',
          'modified_time',
          'song_length',
          'has_video_background',
          'album_art_md5',
          'group_id',
          'first_seen',
        ])
        .orderBy('md5'),
    )
    .onConflict(oc =>
      oc.column('md5').doUpdateSet(eb => ({
        name: eb.ref('excluded.name'),
        artist: eb.ref('excluded.artist'),
        charter: eb.ref('excluded.charter'),
        artist_normalized: eb.ref('excluded.artist_normalized'),
        charter_normalized: eb.ref('excluded.charter_normalized'),
        name_normalized: eb.ref('excluded.name_normalized'),
        diff_drums: eb.ref('excluded.diff_drums'),
        diff_guitar: eb.ref('excluded.diff_guitar'),
        diff_bass: eb.ref('excluded.diff_bass'),
        diff_keys: eb.ref('excluded.diff_keys'),
        diff_drums_real: eb.ref('excluded.diff_drums_real'),
        has_guitar: eb.ref('excluded.has_guitar'),
        has_bass: eb.ref('excluded.has_bass'),
        has_keys: eb.ref('excluded.has_keys'),
        has_drums: eb.ref('excluded.has_drums'),
        has_other_instruments: eb.ref('excluded.has_other_instruments'),
        drum_type: eb.ref('excluded.drum_type'),
        modified_time: eb.ref('excluded.modified_time'),
        song_length: eb.ref('excluded.song_length'),
        has_video_background: eb.ref('excluded.has_video_background'),
        album_art_md5: eb.ref('excluded.album_art_md5'),
        group_id: eb.ref('excluded.group_id'),
      })),
    )
    .execute();

  // Drop the temp table
  await trx.schema.dropTable(tempTable).execute();

  const after = performance.now();
  console.log('Upserted charts in', (after - before) / 1000, 'seconds');
}

export async function clearAllCharts(db: Kysely<DB>): Promise<void> {
  await db.deleteFrom('chorus_charts').execute();
  await db.deleteFrom('spotify_track_chart_matches').execute();
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

export async function replaceChorusCatalog(
  db: Transaction<DB>,
  charts: ChorusChartDbRow[],
  dataVersion: number,
  lastRun: string,
): Promise<void> {
  await db.deleteFrom('chorus_charts').execute();
  await db.deleteFrom('spotify_track_chart_matches').execute();
  await db.deleteFrom('chorus_scan_sessions').execute();
  await db
    .deleteFrom('chorus_metadata')
    .where('key', '=', 'charts_data_version')
    .execute();
  await upsertCharts(db, charts);
  const scanId = await createScanSession(db, new Date(lastRun), 1);
  await completeScanSession(db, scanId, lastRun);
  await setChartsDataVersion(db, dataVersion);
}

export async function clearAllData(): Promise<void> {
  const db = await getLocalDb();

  await db.transaction().execute(async trx => {
    await trx.deleteFrom('chorus_charts').execute();
    await trx.deleteFrom('chorus_scan_sessions').execute();
    await trx.deleteFrom('chorus_metadata').execute();
    await trx.deleteFrom('spotify_track_chart_matches').execute();
  });
}

// Re-export scan session functions
export {createScanSession, updateScanProgress, completeScanSession};
