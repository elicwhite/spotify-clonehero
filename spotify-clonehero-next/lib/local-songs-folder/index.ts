import {get, set} from 'idb-keyval';
import filenamify from 'filenamify/browser';

import {readJsonFile, writeFile} from '@/lib/fileSystemHelpers';
import scanLocalCharts, {SongAccumulator} from './scanLocalCharts';
import {SngStream} from 'parse-sng';

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

type InstalledChartsResponse = {
  lastScanned: Date;
  installedCharts: SongAccumulator[];
};

export async function getCachedInstalledCharts(): Promise<
  InstalledChartsResponse | undefined
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

  const lastScannedTime = new Date(
    parseInt(localStorage.getItem('lastScannedInstalledCharts') || '0', 10),
  );

  return {
    lastScanned: lastScannedTime,
    installedCharts,
  };
}

export async function scanForInstalledCharts(): Promise<InstalledChartsResponse> {
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
  const now = new Date();
  localStorage.setItem('lastScannedInstalledCharts', now.getTime().toString());
  return {
    lastScanned: now,
    installedCharts,
  };
}

export async function downloadSong(artist: string, song: string, url: string) {
  const handle = await getSongsDirectoryHandle();
  const response = await fetch(url, {
    headers: {
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'sec-fetch-dest': 'empty',
    },
    referrerPolicy: 'no-referrer',
    body: null,
    method: 'GET',
    credentials: 'omit',
  });

  const body = response.body;
  if (body == null) {
    return;
  }

  const artistSongTitle = `${artist} - ${song}`;
  const filename = filenamify(artistSongTitle, {replacement: ''});

  // Error if something matches the filename already
  let songDirHandle: FileSystemDirectoryHandle | undefined;
  try {
    songDirHandle = await handle.getDirectoryHandle(filename, {
      create: false,
    });
  } catch {
    // This is what we hope for, that the file doesn't exist
  }

  if (songDirHandle != null) {
    throw new Error(`Chart ${filename} already installed`);
  }

  songDirHandle = await handle.getDirectoryHandle(filename, {
    create: true,
  });

  return await new Promise((resolve, reject) => {
    const sngStream = new SngStream(() => body, {generateSongIni: true});
    sngStream.on('file', async (file, stream) => {
      const fileHandle = await songDirHandle!.getFileHandle(file, {
        create: true,
      });
      const writableStream = await fileHandle.createWritable();
      stream.pipeTo(writableStream);
    });

    sngStream.on('end', () => {
      console.log(`Finished downloading ${filename}`);
      resolve('downloaded');
    });

    sngStream.on('error', error => {
      console.log(error);
      reject(error);
    });

    sngStream.start();
  });
}
