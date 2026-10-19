import {useState, useCallback} from 'react';
import type {ChorusChartProgress} from '.';
import {getServerChartsDataVersion} from './serverVersions';
import fetchNewCharts from './fetchNewCharts';
import {loadChartDbDump} from './chartDbAssets';
import {
  upsertCharts,
  getChartsDataVersion,
  replaceChorusCatalog,
  createScanSession,
  updateScanProgress,
  completeScanSession,
} from '@/lib/local-db/chorus';
import {getLastScanSession} from '../local-db/chorus/scanning';
import {getLocalDb} from '@/lib/local-db/client';
import {CHORUS_CATALOG_LOCK, getWebLocks, withWebLock} from '@/lib/web-locks';

const DEBUG = true;

export function useChorusChartDb(): [
  ChorusChartProgress,
  (abort: AbortController) => Promise<void>,
] {
  const [progress, setProgress] = useState<ChorusChartProgress>({
    status: 'idle',
    numFetched: 0,
    numTotal: 0,
  });

  const run = useCallback(async (abort: AbortController): Promise<void> => {
    if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    setProgress(progress => ({
      ...progress,
      status: 'fetching',
    }));

    try {
      // Every path below ends in a locked section, so an unusable LockManager
      // is fatal whichever one runs. Failing here rather than in two places
      // also stops a dump being downloaded that could never be installed.
      const locks = getWebLocks();
      if (!locks) {
        throw new Error(
          'This browser does not support cross-tab catalog synchronization',
        );
      }

      debugLog('Checking for server data updates');
      const localDataVersion = await getChartsDataVersion();
      const serverDataVersion = await getServerChartsDataVersion();

      if (localDataVersion !== serverDataVersion) {
        setProgress(progress => ({
          ...progress,
          status: 'fetching-dump',
        }));

        const installCatalog = async () => {
          // Another tab may have completed the replacement while this tab
          // waited for the lock. Re-check before downloading or writing.
          if ((await getChartsDataVersion()) === serverDataVersion) {
            return;
          }

          // Download and validate the complete dump before touching the
          // current catalog. A failed fetch therefore preserves old data.
          const dump = await loadChartDbDump(serverDataVersion);
          if (abort.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }

          const db = await getLocalDb();
          await db.transaction().execute(async trx => {
            await replaceChorusCatalog(
              trx,
              dump.charts,
              serverDataVersion,
              dump.lastRun,
            );
          });
        };

        await withWebLock(CHORUS_CATALOG_LOCK, locks, installCatalog);
      }

      setProgress(progress => ({
        ...progress,
        status: 'updating-db',
      }));
      debugLog('Fetching updated charts');

      await withWebLock(CHORUS_CATALOG_LOCK, locks, () =>
        getUpdatedCharts((_, stats) => {
          setProgress(progress => ({
            ...progress,
            numFetched: stats.totalSongsFound,
            numTotal: stats.totalSongsToFetch,
          }));
        }),
      );
      debugLog('Done fetching charts');
    } catch (error) {
      setProgress(progress => ({
        ...progress,
        status: 'error',
      }));
      throw error;
    }

    setProgress(progress => ({
      ...progress,
      status: 'complete',
    }));
  }, []);

  return [progress, run];
}

async function getUpdatedCharts(
  onEachResponse: Parameters<typeof fetchNewCharts>[2],
) {
  // Determine the point-in-time to scan from
  // Prefer the last successful scan time recorded in metadata
  const lastScanSession = await getLastScanSession();
  let scan_since_time = new Date(0);
  let last_chart_id = 1;

  if (lastScanSession?.status === 'completed') {
    scan_since_time = new Date(lastScanSession.completed_at ?? 0);
    last_chart_id = 1;
  } else if (lastScanSession?.status === 'in_progress') {
    scan_since_time = new Date(lastScanSession.started_at);
    last_chart_id = lastScanSession.last_chart_id ?? 1;
  }

  // Start a new scan session
  const db = await getLocalDb();
  await db.transaction().execute(async trx => {
    const id = await createScanSession(trx, scan_since_time, last_chart_id);

    let updatePromises = Promise.resolve();

    await fetchNewCharts(scan_since_time, last_chart_id, (json, stats) => {
      // Store charts and update scan progress
      updatePromises = updatePromises.then(async () => {
        await upsertCharts(trx, json);
        last_chart_id = stats.lastChartId;
        await updateScanProgress(trx, id, stats.lastChartId);
      });

      onEachResponse(json, stats);
    });

    await updatePromises;

    // Mark the scan session as completed
    await completeScanSession(trx, id);
  });
}

function debugLog(message: string) {
  if (DEBUG) {
    console.log(message);
  }
}
