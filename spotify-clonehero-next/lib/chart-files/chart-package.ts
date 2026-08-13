/**
 * Readers for chart packages: folders, .zip, and .sng files.
 *
 * All produce a common { files, sourceFormat } shape that can be
 * fed to chart-edit's readChart() and later to the export pipeline.
 */

import {unzipSync} from 'fflate';
import {SngStream} from '@eliwhite/parse-sng';
import type {SngHeader} from '@eliwhite/parse-sng';
import {getExtension} from '@/lib/src-shared/utils';
import {readDirectoryEntries} from './entries';
import type {File as FileEntry} from '@eliwhite/scan-chart';

export type SourceFormat = 'folder' | 'zip' | 'sng';

export interface LoadedFiles {
  files: FileEntry[];
  sourceFormat: SourceFormat;
  /** Original file/folder name for use as the download filename. */
  originalName: string;
  /** Original SNG header metadata (only present for .sng input). */
  sngMetadata?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Folder
// ---------------------------------------------------------------------------

/** Thrown when a selection is not something a chart can be read out of. */
export const NOT_A_FOLDER_MESSAGE =
  'Your browser did not return a folder. Select a .zip or .sng file instead.';
export const SELECT_SONG_FOLDER_MESSAGE =
  'Select the song’s own folder: the one with the chart file in it.';
export const EMPTY_FOLDER_MESSAGE = 'That folder has no files in it.';

/**
 * A file inside a picked folder, and the path segments locating it below that
 * folder — `['Song Name', 'notes.chart']`. The root segment is the folder the
 * user chose. Every way of picking a folder can produce these: a directory
 * handle by walking it, a `webkitdirectory` input from `webkitRelativePath`, a
 * drop from its `FileSystemEntry`s.
 */
export interface FolderEntry {
  segments: string[];
  read: () => Promise<Uint8Array>;
}

/**
 * The one place that decides which of a folder's files are the chart.
 *
 * Reads a single level, because a chart package is flat. If the chosen folder
 * has no files of its own but everything sits under one subfolder, that
 * subfolder is read instead: picking the parent of a song folder is an easy
 * slip, and the zip reader already tolerates the equivalent. Anything less
 * certain than that — several subfolders, or a deeper tree — is the user's to
 * resolve, since guessing at which song they meant would be worse than asking.
 *
 * Every failure throws with a message about the folder. Returning no files
 * instead surfaces to the user as a chart parsing error, which is not what
 * went wrong.
 */
export async function readFolderEntries(
  entries: FolderEntry[],
): Promise<LoadedFiles> {
  // Dotfiles are skipped, and dot-directories with them. The chosen folder's
  // own name is exempt: a chart kept in a hidden folder is still the chart the
  // user asked for.
  const visible = entries.filter(
    ({segments}) => !segments.slice(1).some(name => name.startsWith('.')),
  );

  if (visible.length === 0) throw new Error(EMPTY_FOLDER_MESSAGE);

  let chartEntries = visible.filter(({segments}) => segments.length === 2);

  if (chartEntries.length === 0) {
    const subdirectories = new Set(visible.map(({segments}) => segments[1]));
    chartEntries =
      subdirectories.size === 1
        ? visible.filter(({segments}) => segments.length === 3)
        : [];
    if (chartEntries.length === 0) {
      throw new Error(SELECT_SONG_FOLDER_MESSAGE);
    }
  }

  // Every file goes through: the chart and ini become the parsed structure and
  // everything else (audio stems, album art, background.png, video) lands in
  // `chartDoc.assets`, so writeChartFolder can round-trip the package.
  const files: FileEntry[] = await Promise.all(
    chartEntries.map(async ({segments, read}) => ({
      fileName: segments[segments.length - 1],
      data: await read(),
    })),
  );

  // Named after the folder the chart was actually read from, not the one the
  // user happened to choose: this is the export's filename and the project's
  // fallback song name, so descending into a subfolder has to carry its name.
  const chartPath = chartEntries[0].segments;
  return {
    files,
    sourceFormat: 'folder',
    originalName: chartPath[chartPath.length - 2],
  };
}

/** A file handle, as the entry `readFolderEntries` works in. */
function handleEntry(
  segments: string[],
  handle: FileSystemFileHandle,
): FolderEntry {
  return {
    segments,
    read: async () =>
      new Uint8Array(await (await handle.getFile()).arrayBuffer()),
  };
}

/** Folder reader for a File System Access directory handle (Chromium). */
export async function readChartDirectory(
  dirHandle: FileSystemDirectoryHandle,
): Promise<LoadedFiles> {
  const entries: FolderEntry[] = [];
  const subdirectories: FileSystemDirectoryHandle[] = [];

  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file') {
      entries.push(handleEntry([dirHandle.name, name], handle));
    } else {
      subdirectories.push(handle as FileSystemDirectoryHandle);
    }
  }

  // A lone subfolder is only descended into when the chosen folder has no
  // files of its own, so its contents are listed only in that case — a library
  // folder of hundreds of songs should not be enumerated just to be rejected.
  if (entries.length === 0 && subdirectories.length === 1) {
    const [subdirectory] = subdirectories;
    for await (const [name, handle] of subdirectory.entries()) {
      if (handle.kind !== 'file') continue;
      entries.push(
        handleEntry(
          [dirHandle.name, subdirectory.name, name],
          handle as FileSystemFileHandle,
        ),
      );
    }
  } else if (entries.length === 0 && subdirectories.length > 1) {
    throw new Error(SELECT_SONG_FOLDER_MESSAGE);
  }

  return readFolderEntries(entries);
}

/**
 * Folder reader for browsers without the File System Access API, fed by an
 * `<input type="file" webkitdirectory>` selection. That input hands back every
 * file in the tree at once, each carrying its path below the chosen folder in
 * `webkitRelativePath`.
 */
export async function readChartFileList(
  selection: File[],
): Promise<LoadedFiles> {
  const entries: FolderEntry[] = selection
    .map(file => ({
      segments: (file.webkitRelativePath ?? '').split('/'),
      read: async () => new Uint8Array(await file.arrayBuffer()),
    }))
    // A path of one segment is a file the browser reported no folder for.
    .filter(({segments}) => segments.length > 1);

  // Which is a different failure from an empty folder, and only this adapter
  // can tell them apart: by the time readFolderEntries sees them, both are no
  // entries at all.
  if (entries.length === 0 && selection.length > 0) {
    throw new Error(NOT_A_FOLDER_MESSAGE);
  }

  return readFolderEntries(entries);
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

export async function readZipFile(file: File): Promise<LoadedFiles> {
  const buffer = await file.arrayBuffer();
  const unzipped = unzipSync(new Uint8Array(buffer));
  const files: FileEntry[] = [];

  for (const [path, data] of Object.entries(unzipped)) {
    // Strip directory prefix (e.g. "SongName/notes.chart" → "notes.chart")
    const fileName = path.split('/').pop()!;
    if (fileName && data.length > 0) {
      files.push({fileName, data});
    }
  }

  // Strip .zip extension for the original name
  const originalName = file.name.replace(/\.zip$/i, '');
  return {files, sourceFormat: 'zip', originalName};
}

// ---------------------------------------------------------------------------
// SNG
// ---------------------------------------------------------------------------

export async function readSngFile(file: File): Promise<LoadedFiles> {
  const buffer = await file.arrayBuffer();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });

  return new Promise<LoadedFiles>((resolve, reject) => {
    const sngStream = new SngStream(stream, {generateSongIni: true});
    let header: SngHeader;
    const files: FileEntry[] = [];

    sngStream.on('header', h => {
      header = h;
    });

    sngStream.on('file', async (fileName, fileStream, nextFile) => {
      const reader = fileStream.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      files.push({fileName, data: merged});

      if (nextFile) {
        nextFile();
      } else {
        resolve({
          files,
          sourceFormat: 'sng',
          originalName: file.name.replace(/\.sng$/i, ''),
          sngMetadata: header?.metadata,
        });
      }
    });

    sngStream.on('error', reject);
    sngStream.start();
  });
}

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

export function detectFormat(file: File): 'zip' | 'sng' | null {
  const ext = getExtension(file.name).toLowerCase();
  if (ext === 'zip') return 'zip';
  if (ext === 'sng') return 'sng';
  return null;
}

/** Reads a single file that is already known to be a chart package. */
export function readChartFile(
  file: File,
  format: 'zip' | 'sng',
): Promise<LoadedFiles> {
  return format === 'zip' ? readZipFile(file) : readSngFile(file);
}

/**
 * What a drop turned out to be. A file that is not a chart package comes back
 * as `file` rather than an error, because what to do with it is the drop
 * zone's business: the landing sections start a transcription from a dropped
 * audio file, everyone else says it isn't a chart.
 */
export type DroppedChart =
  | {kind: 'chart'; loaded: LoadedFiles}
  | {kind: 'file'; file: File}
  | {kind: 'nothing'};

/**
 * Read whatever was dropped: a chart folder, a .zip or a .sng.
 *
 * Folders arrive through `webkitGetAsEntry`, which every current browser
 * implements — unlike `getAsFileSystemHandle` (Chromium only) and
 * `DataTransfer.files` (files only, no folder contents).
 *
 * Must be *called* synchronously from the drop handler: `dataTransfer` is
 * emptied once that handler returns, so both lists are taken from it before
 * this function's first await.
 */
export async function readDroppedChart(
  dataTransfer: DataTransfer,
): Promise<DroppedChart> {
  const entries = directoryEntries(dataTransfer);
  const file: File | undefined = dataTransfer.files[0];

  if (entries.length > 0) {
    return {
      kind: 'chart',
      loaded: await readFolderEntries(await walkFolder(entries[0])),
    };
  }

  if (!file) return {kind: 'nothing'};

  const format = detectFormat(file);
  return format
    ? {kind: 'chart', loaded: await readChartFile(file, format)}
    : {kind: 'file', file};
}

/** The dropped items that are directories, as filesystem entries. */
function directoryEntries(
  dataTransfer: DataTransfer,
): FileSystemDirectoryEntry[] {
  return Array.from(dataTransfer.items)
    .map(item => (item.kind === 'file' ? item.webkitGetAsEntry?.() : null))
    .filter((entry): entry is FileSystemDirectoryEntry =>
      Boolean(entry?.isDirectory),
    );
}

/** A dropped file entry, as the entry `readFolderEntries` works in. */
function droppedEntry(
  segments: string[],
  entry: FileSystemFileEntry,
): FolderEntry {
  return {
    segments,
    read: async () => {
      const file = await new Promise<File>((resolve, reject) =>
        entry.file(resolve, reject),
      );
      return new Uint8Array(await file.arrayBuffer());
    },
  };
}

/**
 * A dropped directory as `FolderEntry`s: its own files, or those of a lone
 * subfolder — the same shape, and the same reasoning, as the directory handle
 * reader above.
 */
async function walkFolder(
  directory: FileSystemDirectoryEntry,
): Promise<FolderEntry[]> {
  const children = await readDirectoryEntries(directory);
  const files = children.filter(
    (child): child is FileSystemFileEntry => child.isFile,
  );
  if (files.length > 0) {
    return files.map(child =>
      droppedEntry([directory.name, child.name], child),
    );
  }

  const subdirectories = children.filter(
    (child): child is FileSystemDirectoryEntry => child.isDirectory,
  );
  if (subdirectories.length > 1) throw new Error(SELECT_SONG_FOLDER_MESSAGE);
  if (subdirectories.length === 0) return [];

  const [subdirectory] = subdirectories;
  const grandchildren = await readDirectoryEntries(subdirectory);
  return grandchildren
    .filter((child): child is FileSystemFileEntry => child.isFile)
    .map(child =>
      droppedEntry([directory.name, subdirectory.name, child.name], child),
    );
}
