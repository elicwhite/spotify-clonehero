/**
 * A shape-only report of what the browser hands back for a user's Songs
 * folder, for diagnosing "the scan found zero charts" without asking anyone to
 * send their library.
 *
 * The scan drops a chart silently in three places — the entry is missing from
 * the listing, its name is not exactly `song.ini`, or the parsed metadata has
 * no name and no artist — and a user cannot tell those apart from a count of
 * zero. This walk records which one happened.
 *
 * Nothing here records what a chart *is*. Folder names, song names, artists,
 * charters and file contents never enter the report; only counts, lengths,
 * extensions, and the fixed literals the scanner itself matches on. See
 * {@link ScanDiagnosticsReport} for the full list of what a report can hold.
 */
import {parse} from '@/lib/ini-parser';

/** How many chart folders to look at before summarizing. */
const SAMPLE_LIMIT = 40;

/** How deep to walk before giving up on a branch. */
const MAX_DEPTH = 5;

/**
 * How many directories to open before stopping. A library of 60k `.sng` files
 * fills no sample slots, so without this the walk would read the whole tree
 * and the page would look frozen.
 */
const MAX_DIRECTORIES = 2000;

/**
 * Windows refuses to open a path past this, and Chromium inherits the limit,
 * so a library that scans on one machine and not another may simply be nested
 * deeper. The report counts how many sampled charts are near it.
 */
const WINDOWS_MAX_PATH = 260;

/** What a single sampled folder looked like. */
export type SampledFolder = {
  /** Levels below the folder the user picked. */
  depth: number;
  /** Characters in this folder's own name. Never the name itself. */
  nameLength: number;
  /** Characters from the picked folder down to this one, separators included. */
  pathLength: number;
  /** True when the folder's name is not plain ASCII. */
  nameHasNonAscii: boolean;
  /**
   * True when the name holds a character Windows forbids. Chromium filters
   * directory entries by Windows rules on every platform, so such an entry can
   * be missing from the listing entirely.
   */
  nameHasWindowsIllegalChar: boolean;
  directoryCount: number;
  fileCount: number;
  /** Lower-cased file extensions and how many of each. Never file names. */
  extensions: Record<string, number>;
  /**
   * `exact` when the file is named exactly `song.ini`, which is what the scan
   * matches; `case-mismatch` when it is spelled another way, so the scan skips
   * it. A folder without one at all never reaches the sample.
   */
  songIni: 'exact' | 'case-mismatch';
  /** The spelling found, only ever a variant of `song.ini`. */
  songIniName: string;
  ini?: IniShape;
  /** Set when reading or listing this folder threw. */
  error?: string;
};

/** What a `song.ini` looked like, without any of its values. */
export type IniShape = {
  byteLength: number;
  /** `utf-8`, `utf-16le`, `utf-16be` — decided by the byte-order mark. */
  encoding: string;
  /** True when the file starts with a byte-order mark of any kind. */
  hasByteOrderMark: boolean;
  /**
   * Section headers as written, kept only when they are plain letters and
   * spaces inside brackets. Anything else is reported as `[?]` so a malformed
   * file cannot smuggle content into the report.
   */
  sectionHeaders: string[];
  /** True when a section lower-cases to `song`. */
  hasSongSection: boolean;
  /** Whether the keys exist. Never their values. */
  hasName: boolean;
  hasArtist: boolean;
  hasCharter: boolean;
  /** Lines the parser could not read at all. */
  badLineCount: number;
};

export type ScanDiagnosticsReport = {
  version: 1;
  userAgent: string;
  /** `navigator.platform`, which still says Win32 vs MacIntel. */
  platform: string;
  /** True when the folder the user picked is itself a chart. */
  rootIsChart: boolean;
  rootEntryCount: number;
  directoriesVisited: number;
  /** Directories the browser refused to list, and why. */
  listingErrors: {depth: number; error: string}[];
  sngFilesFound: number;
  /** Folders that hold a `song.ini` the scan would accept. */
  chartsScannable: number;
  /** Folders that hold a `song.ini` the scan would skip. */
  chartsMissed: number;
  /** Deepest level reached, and how many sampled paths approach MAX_PATH. */
  maxDepthSeen: number;
  pathsNearWindowsLimit: number;
  sample: SampledFolder[];
  /**
   * Why the walk stopped short, or null when it saw the whole tree. A
   * diagnostic that quietly reads part of a library would answer "no charts
   * here" for a library whose charts it never reached.
   */
  stoppedEarly: 'sample-limit' | 'directory-limit' | null;
  /** True when a branch was cut off at {@link MAX_DEPTH}. */
  depthLimitHit: boolean;
  /** A one-line reading of the numbers above, for the person pasting this. */
  verdict: string;
};

// The characters Windows forbids in a name, plus control characters. A space
// or a hyphen is ordinary in a chart folder and belongs nowhere near this.
const WINDOWS_ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/;

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

function encodingOf(bytes: Uint8Array): {encoding: string; bom: boolean} {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {encoding: 'utf-16le', bom: true};
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {encoding: 'utf-16be', bom: true};
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {encoding: 'utf-8', bom: true};
  }
  return {encoding: 'utf-8', bom: false};
}

/**
 * Section headers, redacted. A chart's sections are `[Song]` and the like, but
 * a corrupt file can hold anything between brackets, so only plain letters and
 * spaces survive verbatim.
 */
function safeSectionHeaders(text: string): string[] {
  const headers: string[] = [];
  for (const line of text.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[')) continue;
    headers.push(/^\[[A-Za-z ]{0,24}\]$/.test(trimmed) ? trimmed : '[?]');
  }
  return headers;
}

export function describeIni(bytes: Uint8Array): IniShape {
  const {encoding, bom} = encodingOf(bytes);
  // Decoded again rather than read off `iniObject`, whose section keys are
  // lower-cased. The spelling the file uses is the thing being diagnosed.
  const text = new TextDecoder(encoding).decode(bytes);
  const {iniObject, iniErrors} = parse(bytes);
  const song = iniObject['song'];

  return {
    byteLength: bytes.byteLength,
    encoding,
    hasByteOrderMark: bom,
    sectionHeaders: safeSectionHeaders(text),
    hasSongSection: song != null,
    hasName: song?.['name'] != null,
    hasArtist: song?.['artist'] != null,
    hasCharter: song?.['charter'] != null,
    badLineCount: iniErrors.length,
  };
}

function messageOf(error: unknown): string {
  if (error instanceof DOMException) return `${error.name}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read the numbers into a sentence, so the reporter and the maintainer read
 * the same conclusion rather than each interpreting the counts.
 */
export function verdictFor(r: Omit<ScanDiagnosticsReport, 'verdict'>): string {
  if (r.rootEntryCount === 0) {
    return 'The browser returned no entries at all for the folder you picked. Nothing below it can be scanned.';
  }
  if (r.rootIsChart) {
    return 'The folder you picked is itself a chart, not a folder of charts. Pick the folder that holds all your song folders.';
  }
  if (r.chartsMissed > 0 && r.chartsScannable === 0) {
    return `Every chart found spells song.ini differently from what the scan matches (${r.chartsMissed} of them). That is the bug.`;
  }
  if (r.chartsMissed > 0) {
    return `${r.chartsMissed} chart folders spell song.ini differently from what the scan matches, and ${r.chartsScannable} do not.`;
  }
  if (r.chartsScannable > 0) {
    return `${r.chartsScannable} chart folders look scannable, so the fault is after the folder walk.`;
  }
  if (r.listingErrors.length > 0) {
    return `The browser refused to list ${r.listingErrors.length} directories. See listingErrors.`;
  }
  // Everything below concludes something from an absence, so it may only be
  // said about a tree the walk actually finished.
  if (r.stoppedEarly === 'directory-limit') {
    return `Stopped after ${r.directoriesVisited} directories without finding a chart folder. This library is larger than the check reads.`;
  }
  if (r.depthLimitHit) {
    return `No chart folders in the first ${MAX_DEPTH} levels, and there are folders deeper than that. Your charts are probably nested further down than the scan expects.`;
  }
  if (r.sngFilesFound > 0) {
    return `Found ${r.sngFilesFound} .sng files and no chart folders, and the whole tree was read. This library looks like it is all .sng.`;
  }
  return 'No charts and no .sng files were found below the folder you picked.';
}

/**
 * Walk `root` and describe what the browser returned. Reads `song.ini` files
 * and nothing else; audio and chart files are counted by extension only.
 */
export async function collectScanDiagnostics(
  root: FileSystemDirectoryHandle,
  onProgress: (visited: number) => void = () => {},
): Promise<ScanDiagnosticsReport> {
  const sample: SampledFolder[] = [];
  const listingErrors: {depth: number; error: string}[] = [];
  let directoriesVisited = 0;
  let sngFilesFound = 0;
  let maxDepthSeen = 0;
  let rootEntryCount = 0;
  let rootIsChart = false;
  let stoppedEarly: ScanDiagnosticsReport['stoppedEarly'] = null;
  let depthLimitHit = false;

  async function visit(
    dir: FileSystemDirectoryHandle,
    depth: number,
    pathLength: number,
  ): Promise<void> {
    if (depth > MAX_DEPTH) {
      depthLimitHit = true;
      return;
    }
    if (sample.length >= SAMPLE_LIMIT) {
      stoppedEarly = 'sample-limit';
      return;
    }
    if (directoriesVisited >= MAX_DIRECTORIES) {
      stoppedEarly = 'directory-limit';
      return;
    }

    directoriesVisited++;
    maxDepthSeen = Math.max(maxDepthSeen, depth);
    onProgress(directoriesVisited);

    let entries: [string, FileSystemHandle][];
    try {
      entries = await Array.fromAsync(dir.entries());
    } catch (error) {
      listingErrors.push({depth, error: messageOf(error)});
      return;
    }

    const subdirs: FileSystemDirectoryHandle[] = [];
    const extensions: Record<string, number> = {};
    let fileCount = 0;
    let songIniHandle: FileSystemFileHandle | null = null;

    for (const [, handle] of entries) {
      if (handle.kind === 'directory') {
        subdirs.push(handle as FileSystemDirectoryHandle);
        continue;
      }
      fileCount++;
      const ext = extensionOf(handle.name);
      extensions[ext] = (extensions[ext] ?? 0) + 1;
      if (handle.name.toLowerCase() === 'song.ini') {
        songIniHandle = handle as FileSystemFileHandle;
      }
      if (handle.name.toLowerCase().endsWith('.sng')) sngFilesFound++;
    }

    if (depth === 0) {
      rootEntryCount = entries.length;
      rootIsChart = songIniHandle != null;
    }

    // Only folders that look like a chart are worth a sample slot; a library
    // is mostly folders of folders and those say nothing.
    if (songIniHandle) {
      const folder: SampledFolder = {
        depth,
        nameLength: dir.name.length,
        pathLength,
        nameHasNonAscii: /[^\x20-\x7e]/.test(dir.name),
        nameHasWindowsIllegalChar: WINDOWS_ILLEGAL.test(dir.name),
        directoryCount: subdirs.length,
        fileCount,
        extensions,
        songIni: songIniHandle.name === 'song.ini' ? 'exact' : 'case-mismatch',
        songIniName: songIniHandle.name,
      };
      try {
        const file = await songIniHandle.getFile();
        folder.ini = describeIni(new Uint8Array(await file.arrayBuffer()));
      } catch (error) {
        folder.error = messageOf(error);
      }
      sample.push(folder);
    }

    for (const sub of subdirs) {
      await visit(sub, depth + 1, pathLength + 1 + sub.name.length);
    }
  }

  await visit(root, 0, root.name.length);

  const chartsScannable = sample.filter(f => f.songIni === 'exact').length;
  const withoutVerdict = {
    version: 1 as const,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    rootIsChart,
    rootEntryCount,
    directoriesVisited,
    listingErrors,
    sngFilesFound,
    chartsScannable,
    chartsMissed: sample.length - chartsScannable,
    maxDepthSeen,
    pathsNearWindowsLimit: sample.filter(
      f => f.pathLength >= WINDOWS_MAX_PATH - 60,
    ).length,
    sample,
    stoppedEarly,
    depthLimitHit,
  };

  return {...withoutVerdict, verdict: verdictFor(withoutVerdict)};
}
