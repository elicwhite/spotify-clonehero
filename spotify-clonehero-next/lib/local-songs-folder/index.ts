import {set} from 'idb-keyval';
import filenamify from 'filenamify/browser';
import {sendGAEvent} from '@next/third-parties/google';

import {writeFile} from '@/lib/fileSystemHelpers';
import scanLocalCharts, {SongAccumulator} from './scanLocalCharts';
import {SngStream} from 'parse-sng';
import {upsertLocalCharts} from '@/lib/local-db/local-charts';

async function promptForSongsDirectory() {
  alert('Select your Songs directory');

  let handle;
  try {
    handle = await window.showDirectoryPicker({
      id: 'clone-hero-songs',
      mode: 'readwrite',
    });
  } catch (err) {
    throw new Error('User canceled picker', {
      cause: err,
    });
  }

  await set('songsDirectoryHandle', handle);

  return handle;
}

let currentSongDirectoryCache: FileSystemDirectoryHandle | undefined;

async function getSongsDirectoryHandle(): Promise<FileSystemDirectoryHandle> {
  // const handle: FileSystemDirectoryHandle | undefined = await get(
  //   'songsDirectoryHandle',
  // );

  if (currentSongDirectoryCache) {
    return currentSongDirectoryCache;
  }

  // if (handle == null) {
  const promptedHandle = await promptForSongsDirectory();
  currentSongDirectoryCache = promptedHandle;
  return promptedHandle;
  // }

  // const permissionState: PermissionState = await handle.queryPermission({
  //   mode: 'readwrite',
  // });

  // console.log('premissionStatus', permissionState);
  // if (permissionState === 'granted') {
  //   return handle;
  // } else if (permissionState === 'prompt') {
  //   await handle.requestPermission({mode: 'readwrite'});
  //   return handle;
  // } else {
  //   return await promptForSongsDirectory();
  // }
}

type InstalledChartsResponse = {
  lastScanned: Date;
  installedCharts: SongAccumulator[];
};

export async function scanForInstalledCharts(
  callbackPerSong: () => void = () => {},
): Promise<InstalledChartsResponse> {
  const root = await navigator.storage.getDirectory();

  const handle = await getSongsDirectoryHandle();

  const {lastScanned, installedCharts} = await scanDirectoryForCharts(
    callbackPerSong,
    handle,
  );

  sendGAEvent({
    event: 'charts_scanned',
    value: installedCharts.length,
  });

  const installedChartsCacheHandle = await root.getFileHandle(
    'installedCharts.json',
    {
      create: true,
    },
  );

  // Write the charts to the local db
  await upsertLocalCharts(installedCharts);

  writeFile(installedChartsCacheHandle, JSON.stringify(installedCharts));
  localStorage.setItem(
    'lastScannedInstalledCharts',
    lastScanned.getTime().toString(),
  );
  return {
    lastScanned,
    installedCharts,
  };
}

async function scanDirectoryForCharts(
  callbackPerSong: () => void = () => {},
  directoryHandle: FileSystemDirectoryHandle,
): Promise<InstalledChartsResponse> {
  const beforeScan = Date.now();
  const installedCharts: SongAccumulator[] = [];
  await scanLocalCharts(directoryHandle, installedCharts, callbackPerSong);
  console.log(
    'Took',
    (Date.now() - beforeScan) / 1000,
    'ss to scan',
    installedCharts.length,
  );

  const now = new Date();
  return {
    lastScanned: now,
    installedCharts,
  };
}

async function getDefaultDownloadDirectory(): Promise<FileSystemDirectoryHandle> {
  const songsDirHandle = await getSongsDirectoryHandle();
  const downloadsHandle = await songsDirHandle.getDirectoryHandle(
    'musiccharts-dot-tools-downloads',
    {create: true},
  );
  return downloadsHandle;
}

export async function getPreviewDownloadDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();

  const previewDirHandle = await root.getDirectoryHandle('previews', {
    create: true,
  });

  return previewDirHandle;
}

async function getBackupDirectory() {
  const root = await navigator.storage.getDirectory();

  const backupDirHandle = await root.getDirectoryHandle('backups', {
    create: true,
  });

  return backupDirHandle;
}

async function getFileOrDirectoryHandle(
  parentHandle: FileSystemDirectoryHandle,
  name: string,
): Promise<null | FileSystemFileHandle | FileSystemDirectoryHandle> {
  try {
    return await parentHandle.getFileHandle(name, {
      create: false,
    });
  } catch {
    // It might be a directory
  }

  try {
    return await parentHandle.getDirectoryHandle(name, {
      create: false,
    });
  } catch {
    // it doesn't exist
  }

  return null;
}

async function moveToFolder(
  parentDirectoryHandle: FileSystemDirectoryHandle,
  fileOrFolderName: string,
  toFolder: FileSystemDirectoryHandle,
): Promise<{
  newParentDirectoryHandle: FileSystemDirectoryHandle;
  fileName: string;
}> {
  const handle = await getFileOrDirectoryHandle(
    parentDirectoryHandle,
    fileOrFolderName,
  );
  if (handle == null) {
    throw new Error('File or folder does not exist');
  }

  if (handle.kind === 'file') {
    if (await fileExists(toFolder, handle.name)) {
      await toFolder.removeEntry(handle.name, {recursive: true});
    }
    const newFileHandle = await toFolder.getFileHandle(handle.name, {
      create: true,
    });
    const writableStream = await newFileHandle.createWritable();
    const readableStream = await handle.getFile();
    await readableStream.stream().pipeTo(writableStream);

    return {
      newParentDirectoryHandle: toFolder,
      fileName: handle.name,
    };
  } else if (handle.kind === 'directory') {
    if (await fileExists(toFolder, handle.name)) {
      await toFolder.removeEntry(handle.name, {recursive: true});
    }

    const destDirHandle = await toFolder.getDirectoryHandle(handle.name, {
      create: true,
    });

    // If there are .crswap files, wait for them to be gone
    // It seems like await should do this, but it doesn't
    // It feels like I /must/ be missing an await somewhere, possibly in parse-sng
    const start = Date.now();
    let iterations = 0;
    do {
      let hasSwap = false;

      for await (const entry of handle.values()) {
        if (entry.name.includes('.crswap')) {
          iterations++;
          hasSwap = true;
          break;
        }
      }

      if (hasSwap) {
        await sleep(100);
      } else {
        break;
      }
    } while (Date.now() - start < 10 * 1000);
    // console.log('iterations', iterations, 'to remove swap');

    for await (const entry of handle.values()) {
      await moveToFolder(handle, entry.name, destDirHandle);
    }

    return {
      newParentDirectoryHandle: toFolder,
      fileName: destDirHandle.name,
    };
  }

  throw new Error('Unknown handle type');
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fileExists(
  parentHandle: FileSystemDirectoryHandle,
  name: string,
) {
  try {
    const checkHandle = await parentHandle.getDirectoryHandle(name, {
      create: false,
    });

    return true;
  } catch {
    // Can't get it without creating, doesn't exist.
    return false;
  }
}

async function backupSong(
  parentDirectoryHandle: FileSystemDirectoryHandle,
  fileOrFolderName: string,
): Promise<{
  revert: () => Promise<void>;
  deleteBackup: () => Promise<void>;
}> {
  const backupRootDirHandle = await getBackupDirectory();

  const moveResult = await moveToFolder(
    parentDirectoryHandle,
    fileOrFolderName,
    backupRootDirHandle,
  );

  const result = {
    async revert() {
      await moveToFolder(
        moveResult.newParentDirectoryHandle,
        moveResult.fileName,
        parentDirectoryHandle,
      );
      await moveResult.newParentDirectoryHandle.removeEntry(
        moveResult.fileName,
        {
          recursive: true,
        },
      );
    },
    async deleteBackup() {
      await moveResult.newParentDirectoryHandle.removeEntry(
        moveResult.fileName,
        {recursive: true},
      );
    },
  };

  return result;
}

export async function downloadSong(
  artist: string,
  song: string,
  charter: string,
  url: string,
  options?: {
    folder?: FileSystemDirectoryHandle;
    replaceExisting?: boolean;
    asSng?: boolean;
  },
): Promise<null | {
  newParentDirectoryHandle: FileSystemDirectoryHandle;
  fileName: string;
}> {
  sendGAEvent({
    event: 'download_song',
  });

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
    cache: 'no-store',
  });

  const body = response.body;
  if (body == null) {
    return null;
  }
  const artistSongTitle = `${artist} - ${song} (${charter})${
    options?.asSng ? '.sng' : ''
  }`;
  const filename = filenamify(artistSongTitle, {replacement: ''});

  const downloadLocation =
    options?.folder ?? (await getDefaultDownloadDirectory());

  const backupRootDirHandle = await getBackupDirectory();

  try {
    // Remove any existing backups
    await backupRootDirHandle.removeEntry(filename, {recursive: true});
  } catch (err) {}

  // Download into backups, and only on success copy it over to destination
  if (options?.asSng) {
    await downloadAsSng(backupRootDirHandle, filename, body);
  } else {
    await downloadAsFolder(backupRootDirHandle, filename, body);
  }
  if (options?.replaceExisting) {
    await downloadLocation.removeEntry(filename, {recursive: true});
  }

  const result = await moveToFolder(
    backupRootDirHandle,
    filename,
    downloadLocation,
  );

  // Delete the temp directory
  await backupRootDirHandle.removeEntry(filename, {recursive: true});

  console.log(`Finished downloading ${filename}`);
  return result;
}

async function downloadAsFolder(
  folderHandle: FileSystemDirectoryHandle,
  filename: string,
  stream: ReadableStream,
) {
  // // Error if something matches the filename already
  let songDirHandle: FileSystemDirectoryHandle | undefined;
  try {
    songDirHandle = await folderHandle.getDirectoryHandle(filename, {
      create: false,
    });
  } catch {
    // This is what we hope for, that the file doesn't exist
  }
  if (songDirHandle != null) {
    throw new Error(`Chart ${filename} already installed`);
  }

  try {
    songDirHandle = await folderHandle.getDirectoryHandle(filename, {
      create: true,
    });
    await new Promise((resolve, reject) => {
      const sngStream = new SngStream(stream, {generateSongIni: true});
      sngStream.on('file', async (file, stream, nextFile) => {
        const fileHandle = await songDirHandle!.getFileHandle(file, {
          create: true,
        });
        const writableStream = await fileHandle.createWritable();
        await stream.pipeTo(writableStream);

        if (nextFile) {
          nextFile();
        } else {
          resolve('downloaded');
        }
      });

      sngStream.on('error', error => {
        reject(error);
      });

      sngStream.start();
    });
  } catch (error) {
    console.error(error);
    await folderHandle.removeEntry(filename, {recursive: true});
    throw error;
  }
}

async function downloadAsSng(
  folderHandle: FileSystemDirectoryHandle,
  filename: string,
  stream: ReadableStream,
) {
  const fileWithExtension = filename;

  // // Error if something matches the filename already
  let songFileHandle: FileSystemFileHandle | undefined;
  try {
    songFileHandle = await folderHandle.getFileHandle(fileWithExtension, {
      create: false,
    });
  } catch {
    // This is what we hope for, that the file doesn't exist
  }
  if (songFileHandle != null) {
    throw new Error(`Chart ${fileWithExtension} already installed`);
  }

  try {
    songFileHandle = await folderHandle.getFileHandle(fileWithExtension, {
      create: true,
    });
    const writableStream = await songFileHandle.createWritable();

    await stream.pipeTo(writableStream);
  } catch (error) {
    console.error(error);
    await folderHandle.removeEntry(fileWithExtension, {recursive: true});
    throw error;
  }
}
