import {get, set} from 'idb-keyval';
import filenamify from 'filenamify/browser';

import {track, type ChartDownloadSource} from '../analytics/track';
import {downloadBlob} from '../download';
import {
  isPickerCancel,
  supportsDirectoryPicker,
} from '../file-access/capabilities';
import {setPrefersBrowserDownload} from './downloadChoice';
import {
  folderSourceFromHandle,
  type FolderSource,
} from '../file-access/folderSource';
import scanLocalCharts, {
  LocalChartScanIssue,
  SongAccumulator,
} from './scanLocalCharts';
import {coalesceProgress} from './scan-progress';
import {upsertLocalCharts} from '../local-db/local-charts';

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
    if (isPickerCancel(error)) return null;
    throw error;
  }

  await set('songsDirectoryHandle', handle);
  currentSongDirectoryCache = handle;
  // A folder picked now answers where charts go, over an earlier
  // "Download".
  setPrefersBrowserDownload(false);

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
};

export function getLocalScanWarning(issueCount: number) {
  return `${issueCount.toLocaleString()} chart ${issueCount === 1 ? 'location was' : 'locations were'} skipped. Existing indexed charts were preserved.`;
}

/**
 * Scan whichever Songs folder `getFolder` produces. The caller chooses how far
 * the app may go to get one — `tryGetSongsDirectoryHandle` falls back to the
 * picker, `pickSongsDirectory` insists on it, `getGrantedSongsDirectoryHandle`
 * refuses to prompt at all, and `pickFolder` asks through a file input where
 * there is no picker — and every one of them answers null rather than
 * throwing when there is no folder to scan, so a null result here means "no
 * scan happened", never "the scan failed".
 */
export async function scanSongsFolder(
  getFolder: () => Promise<FolderSource | null>,
  onProgress: (count: number) => void = () => {},
): Promise<InstalledChartsResponse | null> {
  const folder = await getFolder();
  if (!folder) {
    return null;
  }

  return await scanInstalledCharts(folder, onProgress);
}

/** A Songs folder handle getter, as the folder getter `scanSongsFolder` takes. */
export function songsFolderFrom(
  getHandle: () => Promise<FileSystemDirectoryHandle | null>,
): () => Promise<FolderSource | null> {
  return async () => {
    const handle = await getHandle();
    return handle && folderSourceFromHandle(handle);
  };
}

export async function scanInstalledCharts(
  folder: FolderSource,
  onProgress: (count: number) => void = () => {},
): Promise<InstalledChartsResponse> {
  // Coalesce per-chart progress ticks so the caller's React setState doesn't
  // re-render ~15k times during a full library scan.
  const progress = coalesceProgress(onProgress);

  const {lastScanned, installedCharts, issues, status} =
    await scanDirectoryForCharts(progress.bump, folder);

  progress.flush();

  track({
    event: 'charts_scanned',
    folder_access: folder.handle ? 'picker' : 'file-input',
    value: installedCharts.length,
  });

  await upsertLocalCharts(installedCharts, {
    pruneMissing: status === 'complete',
  });

  if (status === 'complete') {
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
  };
}

async function scanDirectoryForCharts(
  callbackPerSong: () => void = () => {},
  folder: FolderSource,
): Promise<InstalledChartsResponse> {
  const beforeScan = Date.now();
  const installedCharts: SongAccumulator[] = [];
  const {issues} = await scanLocalCharts(
    folder,
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
  };
}

/** The folder inside the Songs folder that installed charts go into. */
export async function getSongsDownloadFolder(
  songsFolder: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle> {
  return await songsFolder.getDirectoryHandle(
    'musiccharts-dot-tools-downloads',
    {create: true},
  );
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

/** Copy a staged file into `toFolder`, replacing a file of the same name. */
async function copyIntoFolder(
  fromFolder: FileSystemDirectoryHandle,
  fileName: string,
  toFolder: FileSystemDirectoryHandle,
) {
  const source = await (await fromFolder.getFileHandle(fileName)).getFile();
  const target = await toFolder.getFileHandle(fileName, {create: true});
  await source.stream().pipeTo(await target.createWritable());
}

/**
 * Clears whatever a previous attempt left staged, so this one writes into an
 * empty name. Two attempts sharing a staged file corrupt both.
 *
 * A staged entry that will not go away is the real reason the download cannot
 * start, so it is reported as itself. It says nothing about the destination:
 * `copyIntoFolder` replaces a chart that is already installed.
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

/**
 * Where a chart download goes. The caller decides, because only the caller can
 * ask the user: this function never prompts.
 */
export type ChartDestination =
  | {kind: 'folder'; folder: FileSystemDirectoryHandle}
  | {kind: 'browser-download'};

/** Download a chart as a `.sng` to where `destination` says. */
export async function downloadSong(
  artist: string,
  song: string,
  charter: string,
  url: string,
  destination: ChartDestination,
  options: {source?: ChartDownloadSource; md5?: string} = {},
): Promise<
  | {status: 'installed'; fileName: string}
  | {status: 'downloaded'; fileName: string}
> {
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
  const fileName = filenamify(`${artist} - ${song} (${charter}).sng`, {
    replacement: '',
  });

  if (destination.kind === 'browser-download') {
    // A browser download has nothing to be atomic about, so it skips the OPFS
    // staging copy, which would hold a second copy of a file that can reach
    // hundreds of MB against the quota the catalog also uses.
    downloadBlob(await new Response(body).blob(), fileName);
    trackChartDownload(destination, options);
    return {status: 'downloaded', fileName};
  }

  // Download into backups, and only on success copy it over to destination.
  const backupRootDirHandle = await getBackupDirectory();
  await clearStagedDownload(backupRootDirHandle, fileName);
  await downloadAsSng(backupRootDirHandle, fileName, body);
  await copyIntoFolder(backupRootDirHandle, fileName, destination.folder);

  // Installation commits when the destination copy succeeds. A stale backup
  // is safe to leave behind because the next attempt removes it before writing.
  try {
    await backupRootDirHandle.removeEntry(fileName, {recursive: true});
  } catch (error) {
    console.warn(`Could not remove download backup ${fileName}`, error);
  }

  trackChartDownload(destination, options);

  console.log(`Finished downloading ${fileName}`);
  return {status: 'installed', fileName};
}

function trackChartDownload(
  destination: ChartDestination,
  options: {source?: ChartDownloadSource; md5?: string},
) {
  track({
    event: 'chart_downloaded',
    source: options.source ?? 'unknown',
    format: 'sng',
    destination: destination.kind,
    folder_access: supportsDirectoryPicker() ? 'picker' : 'file-input',
    md5: options.md5,
  });
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
