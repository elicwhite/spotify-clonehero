'use client';

import {ChartInfo, ChartResponseEncore} from '@/lib/chartSelection';
import fetchNewCharts from './fetchNewCharts';
import {readJsonFile, writeFile} from '@/lib/fileSystemHelpers';
import {search, Searcher} from 'fast-fuzzy';
import {useCallback, useState} from 'react';

// Import database version
import {useChorusChartDb as useChorusChartDbDatabase} from './database';

const DEBUG = false;

// Feature flag to control database vs IndexedDB usage
const USE_DATABASE = false;

function debugLog(message: string) {
  if (DEBUG) {
    console.log(message);
  }
}

export async function getServerChartsDataVersion(): Promise<number> {
  const response = await fetch('/api/data');
  const json = await response.json();
  return parseInt(json.chartsDataVersion, 10);
}

async function getServerCharts(rootHandle: FileSystemDirectoryHandle) {
  const serverDataHandle = await rootHandle.getDirectoryHandle('serverData', {
    create: true,
  });

  let serverCharts;
  let serverMetadata;

  try {
    const serverChartsHandle = await serverDataHandle.getFileHandle(
      'charts.json',
      {
        create: false,
      },
    );
    serverCharts = await readJsonFile(serverChartsHandle);

    const serverMetadataHandle = await serverDataHandle.getFileHandle(
      'metadata.json',
      {
        create: false,
      },
    );
    serverMetadata = await readJsonFile(serverMetadataHandle);
  } catch {
    const serverChartsHandle = await serverDataHandle.getFileHandle(
      'charts.json',
      {
        create: true,
      },
    );
    const serverMetadataHandle = await serverDataHandle.getFileHandle(
      'metadata.json',
      {
        create: true,
      },
    );
    const {charts, metadata} = await fetchServerData(
      serverChartsHandle,
      serverMetadataHandle,
    );

    serverCharts = charts;
    serverMetadata = metadata;
  }

  return {serverCharts, serverMetadata};
}

async function getLocalCharts(rootHandle: FileSystemDirectoryHandle) {
  const localDataHandle = await rootHandle.getDirectoryHandle('localData', {
    create: true,
  });

  let charts: any[] = [];

  for await (const subHandle of localDataHandle.values()) {
    if (subHandle.kind !== 'file') {
      throw new Error('There should not be any subdirectories in localData');
    }

    const file = await subHandle.getFile();
    const text = await file.text();
    const json = JSON.parse(text);
    charts = charts.concat(json);
  }

  return charts;
}

async function getUpdatedCharts(
  rootHandle: FileSystemDirectoryHandle,
  onEachResponse: Parameters<typeof fetchNewCharts>[2],
) {
  const localDataHandle = await rootHandle.getDirectoryHandle('localData', {
    create: true,
  });

  let lastUpdateTime = await getLastUpdateTime(rootHandle);

  const {charts, metadata} = await fetchNewCharts(
    lastUpdateTime,
    1,
    onEachResponse,
  );

  if (charts.length !== 0) {
    const localMetadataHandle = await rootHandle.getFileHandle(
      'localMetadata.json',
      {
        create: true,
      },
    );
    await writeFile(localMetadataHandle, JSON.stringify(metadata));

    // Don't bother writing an empty file
    const fileName = `charts-${new Date(metadata.lastRun)
      .toISOString()
      .replace(/[:.]/g, '-')}.json`;
    // replace : and . with - to avoid issues with file names

    console.log('Writing file', fileName);
    const chartsFile = await localDataHandle.getFileHandle(fileName, {
      create: true,
    });
    await writeFile(chartsFile, JSON.stringify(charts));
  }

  return charts;
}

async function getLastUpdateTime(
  rootHandle: FileSystemDirectoryHandle,
): Promise<Date> {
  try {
    // Check if we have existing client data
    const localMetadataHandle = await rootHandle.getFileHandle(
      'localMetadata.json',
      {
        create: false,
      },
    );

    const metadata = await readJsonFile(localMetadataHandle);
    return new Date(metadata.lastRun);
  } catch {
    console.log('No local metadata found');
    // No existing client data, use server time
    const serverDataHandle = await rootHandle.getDirectoryHandle('serverData', {
      create: false,
    });
    const serverMetadataHandle = await serverDataHandle.getFileHandle(
      'metadata.json',
      {
        create: false,
      },
    );
    const serverMetadata = await readJsonFile(serverMetadataHandle);

    return new Date(serverMetadata.lastRun);
  }
}

async function fetchServerData(
  chartsHandle: FileSystemFileHandle,
  metadataHandle: FileSystemFileHandle,
) {
  const results = await Promise.all([
    fetch('/data/charts.json'),
    fetch('/data/metadata.json'),
  ]);

  const [charts, metadata] = await Promise.all(results.map(r => r.json()));

  await Promise.all([
    writeFile(chartsHandle, JSON.stringify(charts)),
    writeFile(metadataHandle, JSON.stringify(metadata)),
  ]);

  return {charts, metadata};
}

function reduceCharts(
  ...chartSets: {
    artist: string;
    name: string;
    groupId: number;
    md5: string;
    modifiedTime: string;
  }[][]
) {
  const results = new Map<number, any>();
  for (const chartSet of chartSets) {
    for (const chart of chartSet) {
      // Invalid charts can get uploaded to encore and have 30 days to get fixed
      if (chart.artist == null || chart.name == null) {
        continue;
      }

      if (!results.has(chart.groupId)) {
        results.set(chart.groupId, {
          ...chart,
          file: `https://files.enchor.us/${chart.md5}.sng`,
        });
      } else if (
        new Date(results.get(chart.groupId).modifiedTime) <
        new Date(chart.modifiedTime)
      ) {
        results.set(chart.groupId, {
          ...chart,
          file: `https://files.enchor.us/${chart.md5}.sng`,
        });
      }
    }
  }
  return Array.from(results.values());
}

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
function useChorusChartDbIndexedDB(): [
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
      return new Promise<ChartResponseEncore[]>(async (resolve, reject) => {
        const charts: ChartResponseEncore[] = [];
        setProgress(progress => ({
          ...progress,
          status: 'fetching',
        }));

        const root = await navigator.storage.getDirectory();

        debugLog('Checking for server data updates');
        const localDataVersion = parseInt(
          localStorage.getItem('chartsDataVersion') ?? '',
          10,
        );
        const serverDataVersion = await getServerChartsDataVersion();

        if (localDataVersion !== serverDataVersion) {
          setProgress(progress => ({
            ...progress,
            status: 'fetching-dump',
          }));
          try {
            await root.removeEntry('serverData', {recursive: true});
            await root.removeEntry('localData', {recursive: true});
          } catch (e) {
            // Not found if the items don't exist, which is fine
            if (!(e instanceof DOMException && e.name === 'NotFoundError')) {
              reject(e);
            }
          }
          localStorage.setItem('chartsDataVersion', String(serverDataVersion));
        }

        debugLog('Fetching local charts from server');
        const {serverCharts} = await getServerCharts(root);
        debugLog('Fetching local cache of charts');

        const localCharts = await getLocalCharts(root);
        let updatedCharts = [];

        if (navigator.onLine) {
          setProgress(progress => ({
            ...progress,
            status: 'updating-db',
          }));
          debugLog('Fetching updated charts');
          updatedCharts = await getUpdatedCharts(root, (json, stats) => {
            setProgress(progress => ({
              ...progress,
              numFetched: stats.totalSongsFound,
              numTotal: stats.totalSongsToFetch,
            }));
          });
          debugLog('Done fetching charts');
        }

        const finalCharts = reduceCharts(
          serverCharts,
          localCharts,
          updatedCharts,
        );
        setProgress(progress => ({
          ...progress,
          status: 'complete',
        }));
        resolve(finalCharts);
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

export function findMatchingCharts<T extends ChartInfo>(
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

// Main export function - always call hooks at the top level
export function useChorusChartDb(
  forceDatabase?: boolean,
): [
  ChorusChartProgress,
  (abort: AbortController) => Promise<ChartResponseEncore[]>,
] {
  // Always call both hooks to satisfy React rules
  const databaseResult = useChorusChartDbDatabase();
  const indexedDBResult = useChorusChartDbIndexedDB();

  // Return the appropriate result based on feature flag
  return USE_DATABASE || forceDatabase ? databaseResult : indexedDBResult;
}
