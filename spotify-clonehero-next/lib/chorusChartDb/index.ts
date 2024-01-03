import {levenshteinEditDistance} from 'levenshtein-edit-distance';

import {ChartResponseEncore} from '@/lib/chartSelection';
import fetchNewCharts from './fetchNewCharts';
import {readJsonFile, writeFile} from '@/lib/fileSystemHelpers';

const DEBUG = false;

export default async function getChorusChartDb(): Promise<
  ChartResponseEncore[]
> {
  const root = await navigator.storage.getDirectory();

  debugLog('Checking for server data updates');
  const localDataVersion = parseInt(
    localStorage.getItem('chartsDataVersion') ?? '',
    10,
  );
  const serverDataVersion = await getServerChartsDataVersion();

  if (localDataVersion !== serverDataVersion) {
    debugLog('Server data is newer, updating');
    await root.removeEntry('serverData', {recursive: true});
    await root.removeEntry('localData', {recursive: true});
    localStorage.setItem('chartsDataVersion', String(serverDataVersion));
  }

  debugLog('Fetching local charts from server');
  const {serverCharts} = await getServerCharts(root);
  debugLog('Fetching local cache of charts');
  const localCharts = await getLocalCharts(root);
  let updatedCharts = [];
  if (navigator.onLine) {
    debugLog('Fetching updated charts');
    updatedCharts = await getUpdatedCharts(root);
    debugLog('Done fetching charts');
  }

  const finalCharts = reduceCharts(serverCharts, localCharts, updatedCharts);
  return finalCharts;
}

export function findMatchingCharts(
  artist: string,
  song: string,
  charts: ChartResponseEncore[],
) {
  const results = charts.filter(chart => {
    if (chart.artist === artist && chart.name === song) {
      return true;
    }
  });

  // const results = charts.filter(chart => {
  //   const artistDistance = levenshteinEditDistance(chart.artist, artist);
  //   const songDistance = levenshteinEditDistance(chart.name, song);

  //   const match = artistDistance < 2 && songDistance < 2;
  //   return match;
  // });
  return results;
}

function reduceCharts(
  ...chartSets: {groupId: number; md5: string; modifiedTime: string}[][]
) {
  const results = new Map<number, any>();
  for (const chartSet of chartSets) {
    for (const chart of chartSet) {
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

async function getServerChartsDataVersion(): Promise<number> {
  const response = await fetch('/api/data');
  const json = await response.json();
  return parseInt(json.chartsDataVersion, 10);
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

async function getUpdatedCharts(rootHandle: FileSystemDirectoryHandle) {
  const localDataHandle = await rootHandle.getDirectoryHandle('localData', {
    create: true,
  });

  let lastUpdateTime = await getLastUpdateTime(rootHandle);

  const {charts, metadata} = await fetchNewCharts(
    lastUpdateTime,
    (json, lastChartId) => {},
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

function debugLog(message: string) {
  if (DEBUG) {
    console.log(message);
  }
}
