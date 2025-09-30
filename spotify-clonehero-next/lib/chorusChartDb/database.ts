import {useState, useCallback} from 'react';
import {ChorusChartProgress, getServerChartsDataVersion} from '.';
import {ChartResponseEncore} from '../chartSelection';
import fetchNewCharts from './fetchNewCharts';
import {
  upsertCharts,
  clearAllCharts,
  getChartsDataVersion,
  setChartsDataVersion,
  createScanSession,
  updateScanProgress,
  completeScanSession,
} from '@/lib/local-db/chorus';
import {getLastScanSession} from '../local-db/chorus/scanning';
import {getLocalDb} from '@/lib/local-db/client';
import {Kysely, Transaction} from 'kysely';
import {DB} from '@/lib/local-db/types';

const DEBUG = true;

export function useChorusChartDb(): [
  ChorusChartProgress,
  (abort: AbortController) => Promise<ChartResponseEncore[]>,
] {
  const [progress, setProgress] = useState<ChorusChartProgress>({
    status: 'idle',
    numFetched: 0,
    numTotal: 0,
  });

  const run = useCallback(
    async (abort: AbortController): Promise<ChartResponseEncore[]> => {
      return new Promise(async (resolve, reject) => {
        const charts: ChartResponseEncore[] = [];
        setProgress(progress => ({
          ...progress,
          status: 'fetching',
        }));

        debugLog('Checking for server data updates');
        // Get the latest data version from database metadata
        const localDataVersion = await getChartsDataVersion();
        const serverDataVersion = await getServerChartsDataVersion();

        if (localDataVersion !== serverDataVersion) {
          setProgress(progress => ({
            ...progress,
            status: 'fetching-dump',
          }));

          const db = await getLocalDb();

          await db.transaction().execute(async trx => {
            // Clear all data and set the new data version
            await clearAllCharts(trx);
            await setChartsDataVersion(trx, serverDataVersion);

            // Fetch initial dump and store it
            await fetchInitialDump(trx);
          });
        }

        setProgress(progress => ({
          ...progress,
          status: 'updating-db',
        }));
        debugLog('Fetching updated charts');

        await getUpdatedCharts((_, stats) => {
          setProgress(progress => ({
            ...progress,
            numFetched: stats.totalSongsFound,
            numTotal: stats.totalSongsToFetch,
          }));
        });
        debugLog('Done fetching charts');

        setProgress(progress => ({
          ...progress,
          status: 'complete',
        }));

        resolve([]);
      });
    },
    [],
  );

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
  db.transaction().execute(async trx => {
    const id = await createScanSession(trx, scan_since_time, last_chart_id);

    let updatePromises = Promise.resolve();

    const {charts, metadata} = await fetchNewCharts(
      scan_since_time,
      last_chart_id,
      (json, stats) => {
        // Store charts and update scan progress
        updatePromises = updatePromises.then(async () => {
          await upsertCharts(trx, json as unknown as ChartResponseEncore[]);
          last_chart_id = stats.lastChartId;
          await updateScanProgress(trx, id, stats.lastChartId);
        });

        onEachResponse(json, stats);
      },
    );

    await updatePromises;

    // Mark the scan session as completed
    await completeScanSession(trx, id);
  });
}

async function fetchInitialDump(db: Transaction<DB>) {
  const results = await Promise.all([
    fetch('/data/charts.json'),
    fetch('/data/metadata.json'),
  ]);

  const [charts, metadata] = await Promise.all(results.map(r => r.json()));

  // TODO: store the charts in the database
  // Create a new scan session with status complete,
  // started at and scan_since_time should be metadata.lastRun which is a string in the format 2025-02-10T00:40:59.863Z
  // last_chart_id should simply be 1. We'll make the next scan start from there

  await upsertCharts(db, charts as unknown as ChartResponseEncore[]);
  const id = await createScanSession(db, new Date(metadata.lastRun), 1);
  await completeScanSession(db, id, metadata.lastRun);
  return {charts, metadata};
}

function debugLog(message: string) {
  if (DEBUG) {
    console.log(message);
  }
}
