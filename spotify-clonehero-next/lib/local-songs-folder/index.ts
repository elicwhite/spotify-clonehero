import {get, set} from 'idb-keyval';
import {readJsonFile, writeFile} from '@/lib/fileSystemHelpers';
import scanLocalCharts, {SongAccumulator} from './scanLocalCharts';

// Save chart
// Replace chart
// Scan folder
// Get installed charts
// Request song directory
// Refresh permissions
// Has permission
// Get last scanned timestamp

async function promptForSongsDirectory() {
  const handle = await window.showDirectoryPicker({
    id: 'clone-hero-songs',
    mode: 'readwrite',
  });

  await set('songsDirectoryHandle', handle);

  return handle;
}

export async function getSongsDirectoryHandle(): Promise<FileSystemDirectoryHandle> {
  const handle: FileSystemDirectoryHandle | undefined = await get(
    'songsDirectoryHandle',
  );

  if (handle == null) {
    return await promptForSongsDirectory();
  }

  const permissionState: PermissionState = await handle.queryPermission({
    mode: 'readwrite',
  });

  console.log('premissionStatus', permissionState);
  if (permissionState === 'granted') {
    return handle;
  } else if (permissionState === 'prompt') {
    await handle.requestPermission({mode: 'readwrite'});
    return handle;
  } else {
    return await promptForSongsDirectory();
  }
}

export async function setSongsDirectoryHandle(
  handle: FileSystemDirectoryHandle,
) {
  await set('songsDirectoryHandle', handle);
}

export async function getCachedInstalledCharts(): Promise<
  SongAccumulator[] | undefined
> {
  const root = await navigator.storage.getDirectory();

  let installedChartsCacheHandle: FileSystemFileHandle;

  try {
    installedChartsCacheHandle = await root.getFileHandle(
      'installedCharts.json',
      {
        create: false,
      },
    );
  } catch {
    return undefined;
  }

  const installedCharts = await readJsonFile(installedChartsCacheHandle);
  return installedCharts;
}

export async function scanForInstalledCharts(): Promise<SongAccumulator[]> {
  const root = await navigator.storage.getDirectory();

  const handle = await getSongsDirectoryHandle();

  const installedCharts: SongAccumulator[] = [];
  await scanLocalCharts(handle, installedCharts, () => {});

  const installedChartsCacheHandle = await root.getFileHandle(
    'installedCharts.json',
    {
      create: true,
    },
  );
  writeFile(installedChartsCacheHandle, JSON.stringify(installedCharts));

  return installedCharts;
}
