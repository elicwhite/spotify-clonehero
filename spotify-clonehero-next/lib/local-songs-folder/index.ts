import {get, set} from 'idb-keyval';
import filenamify from 'filenamify/browser';

import {track, type ChartDownloadSource} from '@/lib/analytics/track';
import {writeFile} from '@/lib/fileSystemHelpers';
import scanLocalCharts, {
  BlockedChartFolder,
  LocalChartScanIssue,
  SongAccumulator,
} from './scanLocalCharts';
import {rescueSongInis} from './songIniRescue';
import {coalesceProgress} from './scan-progress';
import {SngStream} from '@eliwhite/parse-sng';
import {upsertLocalCharts} from '@/lib/local-db/local-charts';

let currentSongDirectoryCache: FileSystemDirectoryHandle | undefined;

/**
 * Show the folder picker and keep what the user picks, whether or not a folder
 * is already stored. This is the only writer of `songsDirectoryHandle`: a
 * caller that writes the key itself leaves `currentSongDirectoryCache` holding
 * the previous folder for the rest of the session. Returns null when the user
 * cancels or the browser refuses the picker.
 */
export async function pickSongsDirectory(): Promise<FileSystemDirectoryHandle | null> {
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker({
      id: 'clone-hero-songs',
      mode: 'readwrite',
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === 'AbortError' || error.name === 'NotAllowedError')
    ) {
      return null;
    }
    throw error;
  }

  await set('songsDirectoryHandle', handle);
  currentSongDirectoryCache = handle;

  return handle;
}

/**
 * Try to recover a previously-picked Songs directory handle from idb-keyval
 * without showing the picker. Returns the handle only if read/write permission
 * is (or can be re-granted to be) available; otherwise null so the caller can
 * fall back to the picker. A re-grant may require a user gesture, which is why
 * permission failures resolve to null rather than throwing.
 */
export async function getCachedSongsDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  return await recoverStoredHandle({mayRequestPermission: true});
}

/**
 * The same recovery, but it never calls `requestPermission`. A re-grant needs a
 * user gesture, so a caller that runs on page load — with no gesture to spend —
 * must take the handle only when permission is already granted, and do nothing
 * otherwise.
 */
export async function getGrantedSongsDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  return await recoverStoredHandle({mayRequestPermission: false});
}

async function recoverStoredHandle({
  mayRequestPermission,
}: {
  mayRequestPermission: boolean;
}): Promise<FileSystemDirectoryHandle | null> {
  if (currentSongDirectoryCache) {
    return currentSongDirectoryCache;
  }

  let handle: FileSystemDirectoryHandle | undefined;
  try {
    handle = await get<FileSystemDirectoryHandle>('songsDirectoryHandle');
  } catch {
    return null;
  }

  if (handle == null) {
    return null;
  }

  // TS's built-in FileSystem*Handle types don't include the experimental
  // permission methods; cast through a minimal interface.
  type WithPerm = {
    queryPermission(d: {mode: 'readwrite'}): Promise<PermissionState>;
    requestPermission(d: {mode: 'readwrite'}): Promise<PermissionState>;
  };
  const perm = handle as unknown as WithPerm;
  const opts = {mode: 'readwrite'} as const;
  try {
    let permission = await perm.queryPermission(opts);
    if (permission !== 'granted' && mayRequestPermission) {
      permission = await perm.requestPermission(opts);
    }
    if (permission !== 'granted') {
      return null;
    }
  } catch {
    return null;
  }

  currentSongDirectoryCache = handle;
  return handle;
}

/**
 * The Songs folder, from wherever it can be had: the stored handle if there is
 * one, otherwise whatever the user picks. Both paths cache the handle
 * themselves, so this is only the choice between them.
 *
 * Nothing may show a modal dialog on the way to the picker. Chrome ends the
 * transient user activation when a dialog closes, and `showDirectoryPicker`
 * then refuses with a SecurityError, which fails the download the click asked
 * for. The button the user pressed says which folder the picker wants.
 */
export async function tryGetSongsDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  return (
    (await getCachedSongsDirectoryHandle()) ?? (await pickSongsDirectory())
  );
}

type InstalledChartsResponse = {
  status: 'complete' | 'partial';
  lastScanned: Date;
  installedCharts: SongAccumulator[];
  issues: LocalChartScanIssue[];
  /** Chart folders whose `song.ini` the browser did not give the scan. */
  needSongIniRescue: BlockedChartFolder[];
};

export function getLocalScanWarning(issueCount: number) {
  return `${issueCount.toLocaleString()} chart ${issueCount === 1 ? 'location was' : 'locations were'} skipped. Existing indexed charts were preserved.`;
}

/**
 * Scan whichever Songs folder `getHandle` produces. The caller chooses how far
 * the app may go to get one — `tryGetSongsDirectoryHandle` falls back to the
 * picker, `pickSongsDirectory` insists on it, `getGrantedSongsDirectoryHandle`
 * refuses to prompt at all — and every one of them answers null rather than
 * throwing when there is no folder to scan, so a null result here means "no
 * scan happened", never "the scan failed".
 */
export async function scanSongsDirectory(
  getHandle: () => Promise<FileSystemDirectoryHandle | null>,
  onProgress: (count: number) => void = () => {},
): Promise<InstalledChartsResponse | null> {
  const handle = await getHandle();
  if (!handle) {
    return null;
  }

  return await scanInstalledCharts(handle, onProgress);
}

export async function scanInstalledCharts(
  handle: FileSystemDirectoryHandle,
  onProgress: (count: number) => void = () => {},
): Promise<InstalledChartsResponse> {
  const root = await navigator.storage.getDirectory();

  // Coalesce per-chart progress ticks so the caller's React setState doesn't
  // re-render ~15k times during a full library scan.
  const progress = coalesceProgress(onProgress);

  const {lastScanned, installedCharts, issues, needSongIniRescue, status} =
    await scanDirectoryForCharts(progress.bump, handle);

  progress.flush();

  track({
    event: 'charts_scanned',
    value: installedCharts.length,
  });

  await upsertLocalCharts(installedCharts, {
    pruneMissing: status === 'complete',
  });

  if (status === 'complete') {
    const installedChartsCacheHandle = await root.getFileHandle(
      'installedCharts.json',
      {create: true},
    );
    await writeFile(
      installedChartsCacheHandle,
      JSON.stringify(installedCharts),
    );
    localStorage.setItem(
      'lastScannedInstalledCharts',
      lastScanned.getTime().toString(),
    );
  }
  return {
    status,
    lastScanned,
    installedCharts,
    issues,
    needSongIniRescue,
  };
}

/**
 * Read the `song.ini` of every folder the scan could not, from one
 * `webkitdirectory` selection of the same Songs folder, and record what that
 * recovers.
 *
 * Nothing is pruned: the charts the scan did read are still installed, and a
 * folder this selection missed may be recovered by the next one.
 */
export async function recoverBlockedSongInis(
  candidates: BlockedChartFolder[],
  selection: File[],
): Promise<{recovered: number; missed: number}> {
  const {charts, missed} = await rescueSongInis(candidates, selection);

  if (charts.length > 0) {
    await upsertLocalCharts(charts, {pruneMissing: false});
  }

  track({
    event: 'song_ini_rescued',
    recovered: charts.length,
    missed,
  });

  return {recovered: charts.length, missed};
}

async function scanDirectoryForCharts(
  callbackPerSong: () => void = () => {},
  directoryHandle: FileSystemDirectoryHandle,
): Promise<InstalledChartsResponse> {
  const beforeScan = Date.now();
  const installedCharts: SongAccumulator[] = [];
  const {issues, needSongIniRescue} = await scanLocalCharts(
    directoryHandle,
    installedCharts,
    callbackPerSong,
  );
  console.log(
    'Took',
    (Date.now() - beforeScan) / 1000,
    'ss to scan',
    installedCharts.length,
  );

  const now = new Date();
  return {
    status: issues.length === 0 ? 'complete' : 'partial',
    lastScanned: now,
    installedCharts,
    issues,
    needSongIniRescue,
  };
}

async function getDefaultDownloadDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const songsDirHandle = await tryGetSongsDirectoryHandle();
  if (!songsDirHandle) {
    return null;
  }
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
    do {
      let hasSwap = false;

      for await (const entry of handle.values()) {
        if (entry.name.includes('.crswap')) {
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
    await parentHandle.getDirectoryHandle(name, {
      create: false,
    });

    return true;
  } catch {
    // Can't get it without creating, doesn't exist.
    return false;
  }
}

/**
 * Clears whatever a previous attempt left staged, so this one writes into an
 * empty name. Two attempts sharing a staged file corrupt both.
 *
 * A staged entry that will not go away is the real reason the download cannot
 * start, so it is reported as itself. It says nothing about the destination:
 * `moveToFolder` replaces a chart that is already installed.
 */
async function clearStagedDownload(
  stagingDirHandle: FileSystemDirectoryHandle,
  filename: string,
) {
  try {
    await stagingDirHandle.removeEntry(filename, {recursive: true});
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      // Nothing staged, which is what every download but a retry finds.
      return;
    }
    throw error;
  }
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
    source?: ChartDownloadSource;
    md5?: string;
  },
): Promise<
  | {status: 'canceled'}
  | {
      status: 'downloaded';
      newParentDirectoryHandle: FileSystemDirectoryHandle;
      fileName: string;
    }
> {
  const downloadLocation =
    options?.folder ?? (await getDefaultDownloadDirectory());
  if (!downloadLocation) {
    return {status: 'canceled'};
  }

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
  if (!response.ok) {
    throw new Error(`Chart download failed with HTTP ${response.status}`);
  }

  const body = response.body;
  if (body == null) {
    throw new Error('Chart download response did not include a body');
  }
  const artistSongTitle = `${artist} - ${song} (${charter})${
    options?.asSng ? '.sng' : ''
  }`;
  const filename = filenamify(artistSongTitle, {replacement: ''});

  const backupRootDirHandle = await getBackupDirectory();

  await clearStagedDownload(backupRootDirHandle, filename);

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

  // Installation commits when the destination copy succeeds. A stale backup
  // is safe to leave behind because the next attempt removes it before writing.
  try {
    await backupRootDirHandle.removeEntry(filename, {recursive: true});
  } catch (error) {
    console.warn(`Could not remove download backup ${filename}`, error);
  }

  track({
    event: 'chart_downloaded',
    source: options?.source ?? 'unknown',
    format: options?.asSng === false ? 'chart' : 'sng',
    md5: options?.md5,
  });

  console.log(`Finished downloading ${filename}`);
  return {status: 'downloaded', ...result};
}

async function downloadAsFolder(
  folderHandle: FileSystemDirectoryHandle,
  filename: string,
  stream: ReadableStream,
) {
  try {
    const songDirHandle = await folderHandle.getDirectoryHandle(filename, {
      create: true,
    });
    await new Promise((resolve, reject) => {
      const sngStream = new SngStream(stream, {generateSongIni: true});
      sngStream.on('file', async (file, stream, nextFile) => {
        const fileHandle = await songDirHandle.getFileHandle(file, {
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
  try {
    const songFileHandle = await folderHandle.getFileHandle(filename, {
      create: true,
    });
    const writableStream = await songFileHandle.createWritable();

    await stream.pipeTo(writableStream);
  } catch (error) {
    console.error(error);
    await folderHandle.removeEntry(filename, {recursive: true});
    throw error;
  }
}
