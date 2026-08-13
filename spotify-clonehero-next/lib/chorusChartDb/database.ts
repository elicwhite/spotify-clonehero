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
      debugLog('Checking for server data updates');
      const localDataVersion = await getChartsDataVersion();
      const serverDataVersion = await getServerChartsDataVersion();

      if (localDataVersion !== serverDataVersion) {
        setProgress(progress => ({
          ...progress,
          status: 'fetching-dump',
        }));

        const locks = getCatalogLocks();
        if (!locks) {
          throw new Error(
            'This browser does not support cross-tab catalog synchronization',
          );
        }

        const installCatalog = async () => {
          // Another tab may have completed the replacement while this tab
          // waited for the lock. Re-check before downloading or writing.
          if ((await getChartsDataVersion()) === serverDataVersion) {
            return;
          }

          // Download and validate the complete dump before touching the
          // current catalog. A failed fetch therefore preserves old data.
          const dump = await loadChartDbDump();
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

        await withCatalogLock(installCatalog, locks);
      }

      const locks = getCatalogLocks();
      if (!locks) {
        throw new Error(
          'This browser does not support cross-tab catalog synchronization',
        );
      }

      setProgress(progress => ({
        ...progress,
        status: 'updating-db',
      }));
      debugLog('Fetching updated charts');

      await withCatalogLock(
        () =>
          getUpdatedCharts((_, stats) => {
            setProgress(progress => ({
              ...progress,
              numFetched: stats.totalSongsFound,
              numTotal: stats.totalSongsToFetch,
            }));
          }),
        locks,
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

type LockManagerLike = {
  request<T>(
    name: string,
    options: {mode: 'exclusive'},
    callback: () => Promise<T>,
  ): Promise<T>;
};

function getCatalogLocks(): LockManagerLike | undefined {
  return typeof navigator !== 'undefined'
    ? (navigator as Navigator & {locks?: LockManagerLike}).locks
    : undefined;
}

async function withCatalogLock<T>(
  work: () => Promise<T>,
  locks: LockManagerLike,
): Promise<T> {
  return locks.request(
    'spotify-clonehero-chorus-catalog',
    {mode: 'exclusive'},
    work,
  );
}
