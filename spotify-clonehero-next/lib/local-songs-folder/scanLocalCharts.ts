import pLimit, {type LimitFunction} from 'p-limit';
import {parse} from '@/lib/ini-parser';
import {readSongIni} from '@eliwhite/parse-sng';
import {removeStyleTags} from '@/lib/ui-utils';
import {chartFileFormatOf} from '@/lib/chart-files/chart-file-names';
import type {ChartHandleInfo} from '@/lib/chart-files/chart-package';

// Caps concurrent FS ops across the whole recursive scan. Without a shared
// limit, Promise.all at every level would multiply with depth and exhaust
// file handles on large libraries.
const SCAN_CONCURRENCY = 32;

type EntryHandle = FileSystemDirectoryHandle | FileSystemFileHandle;

async function listEntries(
  dir: FileSystemDirectoryHandle,
): Promise<Array<[string, EntryHandle]>> {
  const iter = await dir.entries();
  return await Array.fromAsync(iter);
}

export type SongIniData = {
  name: string;
  artist: string;
  charter: string;
  genre?: string | null;
  diff_drums?: number | null;
  diff_drums_real?: number | null;
  diff_guitar?: number | null;
  song_length?: number | null;
  frets?: string | null;
};

export type SongAccumulator = {
  artist: string;
  song: string; // Change this to Name to match Encore
  modifiedTime: string;
  charter: string;
  genre: string;
  data: SongIniData;
  file: string; // This will throw if you access it
  handleInfo: ChartHandleInfo;
};

export type LocalChartScanIssue = {
  kind: 'directory' | 'song-ini' | 'sng';
  path: string;
  message: string;
};

/**
 * A folder that holds a chart file, but gave the scan no metadata to record.
 *
 * Chrome's File System Access API refuses a file named exactly `song.ini`, so
 * on Windows such a folder is a whole chart the scan cannot see: the entry is
 * missing from the listing, or opening it fails. The folder is recorded here
 * so `songIniRescue` can read the same file through a `webkitdirectory`
 * selection, which the restriction does not apply to.
 */
export type BlockedChartFolder = {
  /** From the picked folder down, as `Songs/Artist - Song`. */
  path: string;
  handleInfo: ChartHandleInfo;
};

export type LocalChartScanResult = {
  issues: LocalChartScanIssue[];
  needSongIniRescue: BlockedChartFolder[];
};

export default async function scanLocalCharts(
  directoryHandle: FileSystemDirectoryHandle,
  accumulator: SongAccumulator[],
  callbackPerSong: () => void,
): Promise<LocalChartScanResult> {
  const limit = pLimit(SCAN_CONCURRENCY);
  // A root that cannot be listed is a failed scan, not a skipped chart, so
  // this listing is the one that is allowed to reject.
  const entries = await listEntries(directoryHandle);
  const issues: LocalChartScanIssue[] = [];
  const needSongIniRescue: BlockedChartFolder[] = [];
  const {subdirs, sngFiles, songIniHandle, hasChartFile} =
    partitionEntries(entries);
  const path = directoryHandle.name;

  // The user may pick one chart's own folder rather than a folder of charts.
  // Such a chart has no parent handle, so it addresses its own files.
  const rootHandleInfo = {
    dirHandle: directoryHandle,
    fileName: directoryHandle.name,
  };
  const {songIniData, songIniMTime, opened} = songIniHandle
    ? await readSongIniData(songIniHandle, path, issues)
    : {songIniData: null, songIniMTime: 0, opened: false};
  pushChart(
    accumulator,
    callbackPerSong,
    songIniData,
    songIniMTime,
    rootHandleInfo,
  );
  recordIfBlocked(needSongIniRescue, {
    hasChartFile,
    songIniOpened: opened,
    path,
    handleInfo: rootHandleInfo,
  });

  await Promise.all([
    ...subdirs.map(sub =>
      scanLocalChartsDirectory(
        directoryHandle,
        sub,
        accumulator,
        callbackPerSong,
        limit,
        `${path}/${sub.name}`,
        issues,
        needSongIniRescue,
      ),
    ),
    ...sngFiles.map(sng =>
      scanLocalSngFile(
        directoryHandle,
        sng,
        accumulator,
        callbackPerSong,
        limit,
        `${path}/${sng.name}`,
        issues,
      ),
    ),
  ]);

  return {issues, needSongIniRescue};
}

/**
 * Record a folder the rescue may be able to read: one that holds a chart file
 * and whose `song.ini` the browser did not give the scan. A folder with no
 * chart file in it is not a chart, so its missing `song.ini` says nothing, and
 * a `song.ini` that was read is nothing a second reader can improve on.
 */
function recordIfBlocked(
  needSongIniRescue: BlockedChartFolder[],
  {
    hasChartFile,
    songIniOpened,
    path,
    handleInfo,
  }: {
    hasChartFile: boolean;
    songIniOpened: boolean;
    path: string;
    handleInfo: ChartHandleInfo;
  },
) {
  if (!hasChartFile || songIniOpened) return;
  needSongIniRescue.push({path, handleInfo});
}

/** The four things a scan cares about among a directory's entries. */
function partitionEntries(entries: Array<[string, EntryHandle]>) {
  const subdirs: FileSystemDirectoryHandle[] = [];
  const sngFiles: FileSystemFileHandle[] = [];
  let songIniHandle: FileSystemFileHandle | null = null;
  // Says the folder is a chart even when its `song.ini` never came back from
  // the browser. Any `.chart` or `.mid` counts: a folder that holds one is a
  // chart folder, whichever of its files is the one the game plays.
  let hasChartFile = false;

  for (const [, subHandle] of entries) {
    if (subHandle.kind === 'directory') {
      subdirs.push(subHandle);
      continue;
    }
    if (subHandle.name.toLowerCase().endsWith('.sng')) {
      sngFiles.push(subHandle);
    } else if (subHandle.name === 'song.ini') {
      songIniHandle = subHandle;
    }
    if (chartFileFormatOf(subHandle.name) != null) {
      hasChartFile = true;
    }
  }

  return {subdirs, sngFiles, songIniHandle, hasChartFile};
}

/**
 * A chart folder's metadata, or nulls when the `song.ini` cannot be used.
 *
 * `opened` says the file was read and parsed. Metadata that is null with
 * `opened` true is a `song.ini` that holds no `[Song]` section, which no
 * rescue can improve on.
 */
async function readSongIniData(
  songIniHandle: FileSystemFileHandle,
  path: string,
  issues: LocalChartScanIssue[],
): Promise<{
  songIniData: SongIniData | null;
  songIniMTime: number;
  opened: boolean;
}> {
  let file: File;
  try {
    file = await songIniHandle.getFile();
  } catch (error) {
    reportScanIssue(
      issues,
      'song-ini',
      `${path}/song.ini`,
      `Could not read ${path}/song.ini`,
      error,
    );
    return {songIniData: null, songIniMTime: 0, opened: false};
  }

  try {
    const values = parse(new Uint8Array(await file.arrayBuffer()));
    // The ini parser returns loose string maps; the [Song] section is assumed
    // to carry the fields SongIniData names.
    const songIniData = (values.iniObject['song'] ??
      null) as unknown as SongIniData | null;
    return {songIniData, songIniMTime: file.lastModified, opened: true};
  } catch (error) {
    reportScanIssue(
      issues,
      'song-ini',
      `${path}/song.ini`,
      `Could not parse ${path}/song.ini`,
      error,
    );
    return {songIniData: null, songIniMTime: 0, opened: false};
  }
}

/**
 * One scanned chart, or null when the metadata has neither a name nor an
 * artist, which says the folder is not a chart.
 *
 * Takes `song.ini` metadata rather than a handle, so a rescue that read the
 * same file through a `webkitdirectory` selection makes the same chart.
 */
export function buildChart(
  songIniData: SongIniData | null,
  modifiedTime: number,
  handleInfo: ChartHandleInfo,
): SongAccumulator | null {
  if (songIniData == null || (!songIniData.name && !songIniData.artist)) {
    return null;
  }

  const chart = {
    artist: removeStyleTags(songIniData.artist ?? ''),
    song: removeStyleTags(songIniData.name ?? ''),
    modifiedTime: new Date(modifiedTime).toISOString(),
    charter: removeStyleTags(songIniData.charter || songIniData.frets || ''),
    genre: removeStyleTags(songIniData.genre ?? ''),
    data: convertValues(songIniData),
    handleInfo,
    file: '',
  };
  Object.defineProperty(chart, 'file', {
    get() {
      throw new Error('Charts from disk do not have a download URL');
    },
    enumerable: false, // Can't serialize to JSON
  });

  return chart;
}

/** Record one scanned chart, if the metadata makes one. */
function pushChart(
  accumulator: SongAccumulator[],
  callbackPerSong: () => void,
  songIniData: SongIniData | null,
  modifiedTime: number,
  handleInfo: ChartHandleInfo,
) {
  const chart = buildChart(songIniData, modifiedTime, handleInfo);
  if (chart == null) return;

  accumulator.push(chart);
  callbackPerSong();
}

async function scanLocalChartsDirectory(
  parentDirectoryHandle: FileSystemDirectoryHandle,
  currentDirectoryHandle: FileSystemDirectoryHandle,
  accumulator: SongAccumulator[],
  callbackPerSong: () => void,
  limit: LimitFunction,
  path: string,
  issues: LocalChartScanIssue[],
  needSongIniRescue: BlockedChartFolder[],
) {
  // Run listEntries + song.ini parse atomically inside one limit slot. This
  // bounds total in-flight FS-Access ops to ~`limit` instead of fanning out
  // tens of thousands of listings ahead of all parses (which Chrome's FS
  // queue would FIFO behind, starving the parses for seconds on a flat tree
  // with 60k+ subdirs).
  //
  // Recursion + .sng scanning happens OUTSIDE this slot — we release before
  // awaiting children so deep trees can't deadlock.
  type LeafResult = {
    subdirs: FileSystemDirectoryHandle[];
    sngFiles: FileSystemFileHandle[];
    songIniData: SongIniData | null;
    songIniMTime: number;
    songIniOpened: boolean;
    hasChartFile: boolean;
  } | null;

  const result: LeafResult = await limit(async () => {
    let entries: Array<[string, EntryHandle]>;
    try {
      entries = await listEntries(currentDirectoryHandle);
    } catch (e) {
      reportScanIssue(
        issues,
        'directory',
        path,
        `Could not list chart directory ${path}`,
        e,
      );
      return null;
    }

    const {subdirs, sngFiles, songIniHandle, hasChartFile} =
      partitionEntries(entries);
    const {songIniData, songIniMTime, opened} = songIniHandle
      ? await readSongIniData(songIniHandle, path, issues)
      : {songIniData: null, songIniMTime: 0, opened: false};

    return {
      subdirs,
      sngFiles,
      songIniData,
      songIniMTime,
      songIniOpened: opened,
      hasChartFile,
    };
  });

  if (result == null) return;

  const handleInfo = {
    parentDir: parentDirectoryHandle,
    fileName: currentDirectoryHandle.name,
  };

  // Push chart immediately on slot release so the counter starts ticking
  // before any children have been processed.
  pushChart(
    accumulator,
    callbackPerSong,
    result.songIniData,
    result.songIniMTime,
    handleInfo,
  );
  recordIfBlocked(needSongIniRescue, {
    hasChartFile: result.hasChartFile,
    songIniOpened: result.songIniOpened,
    path,
    handleInfo,
  });

  // Recurse + scan SNGs OUTSIDE the slot so the slot is freed for siblings.
  await Promise.all([
    ...result.subdirs.map(sub =>
      scanLocalChartsDirectory(
        currentDirectoryHandle,
        sub,
        accumulator,
        callbackPerSong,
        limit,
        `${path}/${sub.name}`,
        issues,
        needSongIniRescue,
      ),
    ),
    ...result.sngFiles.map(sng =>
      scanLocalSngFile(
        currentDirectoryHandle,
        sng,
        accumulator,
        callbackPerSong,
        limit,
        `${path}/${sng.name}`,
        issues,
      ),
    ),
  ]);
}

async function scanLocalSngFile(
  parentDirectoryHandle: FileSystemDirectoryHandle,
  fileHandle: FileSystemFileHandle,
  accumulator: SongAccumulator[],
  callbackPerSong: () => void,
  limit: LimitFunction,
  path: string,
  issues: LocalChartScanIssue[],
) {
  await limit(() =>
    scanLocalSngFileInner(
      parentDirectoryHandle,
      fileHandle,
      accumulator,
      callbackPerSong,
      path,
      issues,
    ),
  );
}

async function scanLocalSngFileInner(
  parentDirectoryHandle: FileSystemDirectoryHandle,
  fileHandle: FileSystemFileHandle,
  accumulator: SongAccumulator[],
  callbackPerSong: () => void,
  path: string,
  issues: LocalChartScanIssue[],
) {
  const file = await fileHandle.getFile();
  let metadata: {[key: string]: string};

  try {
    metadata = await readSongIni(file.stream());
  } catch (e) {
    reportScanIssue(
      issues,
      'sng',
      path,
      `Could not read SNG metadata from ${path}`,
      e,
    );
    return;
  }

  // The SNG header's metadata mirrors the [Song] section of song.ini — same
  // key/value shape. convertValues() coerces numeric/boolean strings below.
  pushChart(
    accumulator,
    callbackPerSong,
    metadata as unknown as SongIniData,
    file.lastModified,
    {parentDir: parentDirectoryHandle, fileName: fileHandle.name},
  );
}

function reportScanIssue(
  issues: LocalChartScanIssue[],
  kind: LocalChartScanIssue['kind'],
  path: string,
  message: string,
  error: unknown,
) {
  console.warn(message, error);
  issues.push({kind, path, message});
}

function convertValues(songIniData: SongIniData): SongIniData {
  const mappedEntries = Object.entries(songIniData).map(([key, value]) => {
    // @ts-ignore Checking if type is int
    const tryIntValue = parseInt(value, 10);
    if (value == tryIntValue || value == tryIntValue.toString()) {
      return [key, tryIntValue];
    }

    if (value == 'True') {
      return [key, true];
    } else if (value == 'False') {
      return [key, false];
    }

    return [key, value];
  });

  return Object.fromEntries(mappedEntries);
}

export type ChartInstalledChecker = (
  artist: string,
  song: string,
  charter: string,
) => boolean;

export type SongInstalledChecker = (artist: string, song: string) => boolean;

function createChartLookupKey(artist: string, song: string, charter: string) {
  return `${artist} - ${song} - ${charter}`;
}

function createSongLookupKey(artist: string, song: string) {
  return `${artist} - ${song}`;
}

export function createIsInstalledFilter(installedSongs: SongAccumulator[]): {
  isChartInstalled: ChartInstalledChecker;
  isSongInstalled: SongInstalledChecker;
} {
  const installedCharts = new Set<string>();
  const installedSongKeys = new Set<string>();

  for (const installedSong of installedSongs) {
    const {artist, song, charter} = installedSong;
    installedCharts.add(createChartLookupKey(artist, song, charter));
    installedSongKeys.add(createSongLookupKey(artist, song));
  }

  return {
    isChartInstalled(artist: string, song: string, charter: string) {
      return installedCharts.has(createChartLookupKey(artist, song, charter));
    },
    isSongInstalled(artist: string, song: string) {
      return installedSongKeys.has(createSongLookupKey(artist, song));
    },
  };
}
