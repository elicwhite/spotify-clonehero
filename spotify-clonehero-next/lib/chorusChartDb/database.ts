import {useState, useCallback} from 'react';
import {ChorusChartProgress, getServerChartsDataVersion} from '.';
import {ChartResponseEncore} from '../chartSelection';
import fetchNewCharts from './fetchNewCharts';

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
        // TODO: get the latest data version from database metadata
        // const localDataVersion =
        const serverDataVersion = await getServerChartsDataVersion();

        if (localDataVersion !== serverDataVersion) {
          setProgress(progress => ({
            ...progress,
            status: 'fetching-dump',
          }));
          // TODO: Clear all chorus charts from the database
          // TODO: Set the data version in the database metadata
        }

        setProgress(progress => ({
          ...progress,
          status: 'updating-db',
        }));
        debugLog('Fetching updated charts');

        updatedCharts = await getUpdatedCharts((json, stats) => {
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

        // Don't fill this in. We won't return charts here. We'll
        // change this later to do a more complicated sql.
        // For now, leave this blank.
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
  // TODO: get the latest scan from the database

  // if there are no scans, that means we need to fetch the initial dump from the server
  // call fetchInitialDump()

  // If the status is in_progress, we'll continue from there
  // if so, get the scan_since_time and last_chart_id
  // if the status is completed, we'll use that's started at time

  // create a new scan session
  // scan_since_time will be the latest scan's started_at
  // last_chart_id will be the latest scan's last_chart_id

  const {charts, metadata} = await fetchNewCharts(
    scan_since_time,
    last_chart_id,
    (json, stats) => {
      // store these charts in the database
      // update the scan session with the new last_chart_id

      onEachResponse(json, stats);
    },
  );

  // Mark the scan session as completed
}

async function fetchInitialDump() {
  const results = await Promise.all([
    fetch('/data/charts.json'),
    fetch('/data/metadata.json'),
  ]);

  const [charts, metadata] = await Promise.all(results.map(r => r.json()));

  // TODO: store the charts in the database
  // Create a new scan session with status complete,
  // started at and scan_since_time should be metadata.lastRun which is a string in the format 2025-02-10T00:40:59.863Z
  // last_chart_id should simply be 1. We'll make the next scan start from there

  return {charts, metadata};
}

function debugLog(message: string) {
  if (DEBUG) {
    console.log(message);
  }
}
