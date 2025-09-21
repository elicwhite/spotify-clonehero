import {levenshteinEditDistance} from 'levenshtein-edit-distance';
import {ChartResponseEncore} from '@/lib/chartSelection';
import fetchNewCharts from './fetchNewCharts';
import {search, Searcher} from 'fast-fuzzy';
import {useCallback, useState} from 'react';
import {
  upsertCharts,
  getAllCharts,
  findChartsByArtistAndName,
  clearAllCharts,
  createScanSession,
  updateScanProgress,
  completeScanSession,
  failScanSession,
  getIncompleteScanSession,
  cancelOldScanSessions,
  getChartsDataVersion,
  setChartsDataVersion,
  getLastSuccessfulScan,
  getLastInstalledChartsScan,
  setLastInstalledChartsScan,
  migrateFromIndexedDB,
} from '@/lib/local-db/chorus';
import {getServerChartsDataVersion} from './index';

const DEBUG = false;

export type ChorusChartProgress = {
  status:
    | 'idle'
    | 'fetching'
    | 'fetching-dump'
    | 'updating-db'
    | 'complete'
    | 'error';
  numFetched: number;
  numTotal: number;
};

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
        try {
          setProgress(progress => ({
            ...progress,
            status: 'fetching',
          }));

          debugLog('Checking for server data updates');
          const localDataVersion = await getChartsDataVersion();
          const serverDataVersion = await getServerChartsDataVersion();

          if (localDataVersion !== serverDataVersion) {
            setProgress(progress => ({
              ...progress,
              status: 'fetching-dump',
            }));

            debugLog('Data version changed, clearing all data');
            await clearAllCharts();
            await setChartsDataVersion(serverDataVersion);
          }

          debugLog('Checking for incomplete scan sessions');
          await cancelOldScanSessions();
          const incompleteSession = await getIncompleteScanSession();

          let sessionId: string;
          let resumeFromChartId = 0;

          if (incompleteSession) {
            debugLog('Resuming incomplete scan session');
            sessionId = incompleteSession.session_id;
            resumeFromChartId = incompleteSession.last_chart_id || 0;
          } else {
            debugLog('Starting new scan session');
            sessionId = await createScanSession();
          }

          debugLog('Fetching charts from database');
          const charts = await getAllCharts();

          if (charts.length > 0) {
            debugLog(`Found ${charts.length} charts in database`);
            setProgress(progress => ({
              ...progress,
              status: 'complete',
              numFetched: charts.length,
              numTotal: charts.length,
            }));
            resolve(charts);
            return;
          }

          // Database is empty, try to migrate from IndexedDB
          debugLog('Database is empty, attempting migration from IndexedDB');
          const migratedCharts = await migrateFromIndexedDB();

          if (migratedCharts.length > 0) {
            debugLog(`Migrated ${migratedCharts.length} charts from IndexedDB`);
            setProgress(progress => ({
              ...progress,
              status: 'complete',
              numFetched: migratedCharts.length,
              numTotal: migratedCharts.length,
            }));
            resolve(migratedCharts);
            return;
          }

          debugLog('No charts in database, fetching from server');
          setProgress(progress => ({
            ...progress,
            status: 'updating-db',
          }));

          // Fetch charts from server
          const lastScan = await getLastSuccessfulScan();
          const afterTime = lastScan || new Date(0);

          const updatedCharts = await fetchNewCharts(
            afterTime,
            async (json, stats) => {
              // Update scan progress
              await updateScanProgress(sessionId, {
                totalSongsToFetch: stats.totalSongsToFetch,
                totalSongsFound: stats.totalSongsFound,
                totalChartsFound: stats.totalChartsFound,
                lastChartId: stats.lastChartId,
              });

              setProgress(progress => ({
                ...progress,
                numFetched: stats.totalSongsFound,
                numTotal: stats.totalSongsToFetch,
              }));

              // Store charts in database
              await upsertCharts(json);
            },
          );

          // Complete the scan session
          await completeScanSession(sessionId);

          // Get all charts from database
          const finalCharts = await getAllCharts();

          setProgress(progress => ({
            ...progress,
            status: 'complete',
            numFetched: finalCharts.length,
            numTotal: finalCharts.length,
          }));

          resolve(finalCharts);
        } catch (error) {
          debugLog('Error in chorus chart fetch:', error);
          setProgress(progress => ({
            ...progress,
            status: 'error',
          }));
          reject(error);
        }
      });
    },
    [],
  );

  return [progress, run];
}

export function findMatchingChartsExact(
  artist: string,
  song: string,
  charts: ChartResponseEncore[],
) {
  return charts.filter(chart => {
    return chart.artist == artist && chart.name == song;
  });
}

export function findMatchingCharts<T extends ChartResponseEncore>(
  artist: string,
  song: string,
  artistSearcher: Searcher<
    T,
    {
      keySelector: (chart: T) => string[];
      threshold: number;
    }
  >,
) {
  const artistResult = artistSearcher.search(artist);

  const nameResult = search(song, artistResult, {
    keySelector: chart => [chart.name],
    threshold: 1,
  });

  return nameResult;
}

// Database-specific search functions
export async function findMatchingChartsInDatabase(
  artist: string,
  song: string,
): Promise<ChartResponseEncore[]> {
  return await findChartsByArtistAndName(artist, song);
}

export async function createChartsSearcher(): Promise<ChartResponseEncore[]> {
  // For now, just return all charts and let the caller create the searcher
  // This avoids the complex Searcher type issues
  return await getAllCharts();
}

// Migration function
export async function migrateChartsToDatabase(): Promise<void> {
  try {
    await migrateFromIndexedDB();
    console.log('[Chorus] Migration completed successfully');
  } catch (error) {
    console.error('[Chorus] Migration failed:', error);
    throw error;
  }
}

// Helper functions
function debugLog(...args: any[]) {
  if (DEBUG) {
    console.log('[ChorusChartDb]', ...args);
  }
}
