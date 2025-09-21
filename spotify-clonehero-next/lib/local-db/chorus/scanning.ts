import {getLocalDb} from '../client';
import {ChorusScanSessions} from '../types';
import {Insertable} from 'kysely';

// Helper function to get current timestamp
function nowIso(): string {
  return new Date().toISOString();
}

// Scan session operations
export async function createScanSession(dataVersion: number): Promise<string> {
  const db = await getLocalDb();
  const sessionId = crypto.randomUUID();

  await db
    .insertInto('chorus_scan_sessions')
    .values({
      session_id: sessionId,
      status: 'in_progress',
      started_at: nowIso(),
      data_version: dataVersion,
      total_songs_found: 0,
      total_charts_found: 0,
      last_chart_id: 0,
    } as Insertable<ChorusScanSessions>)
    .execute();

  return sessionId;
}

export async function updateScanProgress(
  sessionId: string,
  progress: {
    totalSongsToFetch?: number;
    totalSongsFound?: number;
    totalChartsFound?: number;
    lastChartId?: number;
  },
): Promise<void> {
  const db = await getLocalDb();

  const updateData: Partial<ChorusScanSessions> = {};
  if (progress.totalSongsToFetch !== undefined) {
    updateData.total_songs_to_fetch = progress.totalSongsToFetch;
  }
  if (progress.totalSongsFound !== undefined) {
    updateData.total_songs_found = progress.totalSongsFound;
  }
  if (progress.totalChartsFound !== undefined) {
    updateData.total_charts_found = progress.totalChartsFound;
  }
  if (progress.lastChartId !== undefined) {
    updateData.last_chart_id = progress.lastChartId;
  }

  await db
    .updateTable('chorus_scan_sessions')
    .set(updateData)
    .where('session_id', '=', sessionId)
    .execute();
}

export async function completeScanSession(sessionId: string): Promise<void> {
  const db = await getLocalDb();

  await db.transaction().execute(async trx => {
    // Mark session as completed
    await trx
      .updateTable('chorus_scan_sessions')
      .set({
        status: 'completed',
        completed_at: nowIso(),
      })
      .where('session_id', '=', sessionId)
      .execute();

    // Update metadata
    await trx
      .insertInto('chorus_metadata')
      .values({
        key: 'last_successful_scan',
        value: nowIso(),
        updated_at: nowIso(),
      })
      .onConflict(oc =>
        oc.column('key').doUpdateSet(eb => ({
          value: eb.ref('excluded.value'),
          updated_at: nowIso(),
        })),
      )
      .execute();
  });
}

export async function failScanSession(
  sessionId: string,
  errorMessage: string,
): Promise<void> {
  const db = await getLocalDb();

  await db
    .updateTable('chorus_scan_sessions')
    .set({
      status: 'failed',
      error_message: errorMessage,
    })
    .where('session_id', '=', sessionId)
    .execute();
}

export async function getIncompleteScanSession(): Promise<ChorusScanSessions | null> {
  const db = await getLocalDb();

  // Look for in-progress sessions from the last 24 hours
  const twentyFourHoursAgo = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();

  const session = await db
    .selectFrom('chorus_scan_sessions')
    .selectAll()
    .where('status', '=', 'in_progress')
    .where('started_at', '>', twentyFourHoursAgo)
    .orderBy('started_at', 'desc')
    .executeTakeFirst();

  return session || null;
}

export async function cancelOldScanSessions(): Promise<void> {
  const db = await getLocalDb();

  // Cancel in-progress sessions older than 24 hours
  const twentyFourHoursAgo = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();

  await db
    .updateTable('chorus_scan_sessions')
    .set({
      status: 'cancelled',
    })
    .where('status', '=', 'in_progress')
    .where('started_at', '<', twentyFourHoursAgo)
    .execute();
}
