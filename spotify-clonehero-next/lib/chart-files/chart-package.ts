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
import {
  folderSourceFromFileList,
  folderSourceFromHandle,
  type FolderFile,
  type FolderSource,
} from '@/lib/file-access/folderSource';
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
export const ONE_CHART_AT_A_TIME_MESSAGE =
  'Drop one chart at a time: a single folder, .zip or .sng.';

async function readBytes(file: FolderFile): Promise<Uint8Array> {
  return new Uint8Array(await (await file.file()).arrayBuffer());
}

/** Dotfiles are never part of a chart: .DS_Store, .git, and friends. */
function visible<T extends {name: string}>(items: T[]): T[] {
  return items.filter(item => !item.name.startsWith('.'));
}

async function packageFrom(
  name: string,
  files: FolderFile[],
): Promise<LoadedFiles> {
  // Every file goes through: the chart and ini become the parsed structure and
  // everything else (audio stems, album art, background.png, video) lands in
  // `chartDoc.assets`, so writeChartFolder can round-trip the package.
  return {
    files: await Promise.all(
      files.map(async file => ({
        fileName: file.name,
        data: await readBytes(file),
      })),
    ),
    sourceFormat: 'folder',
    // Named after the folder the chart was actually read from, not the one the
    // user happened to choose: this is the export's filename and the project's
    // fallback song name, so a descent has to carry the name with it.
    originalName: name,
  };
}

/**
 * The one place that decides which of a folder's files are the chart.
 *
 * Reads a single level, because a chart package is flat. If the chosen folder
 * has no files of its own but holds exactly one subfolder, that subfolder is
 * read instead: picking the parent of a song folder is an easy slip, and the
 * zip reader already tolerates the equivalent. Anything less certain than that
 * — several subfolders, or a deeper tree — is the user's to resolve, since
 * guessing at which song they meant would be worse than asking.
 *
 * Every failure throws with a message about the folder. Returning no files
 * instead surfaces to the user as a chart parsing error, which is not what
 * went wrong.
 */
async function readFolder(source: FolderSource): Promise<LoadedFiles> {
  const {files, subfolders} = await source.list();

  const ownFiles = visible(files);
  if (ownFiles.length > 0) return packageFrom(source.name, ownFiles);

  const candidates = visible(subfolders);
  if (candidates.length === 0) throw new Error(EMPTY_FOLDER_MESSAGE);
  if (candidates.length > 1) throw new Error(SELECT_SONG_FOLDER_MESSAGE);

  const [subfolder] = candidates;
  const inside = visible((await subfolder.list()).files);
  // One descent, not a search: a chart two or more levels down is as likely to
  // be the wrong one as the right one.
  if (inside.length === 0) throw new Error(SELECT_SONG_FOLDER_MESSAGE);
  return packageFrom(subfolder.name, inside);
}

/** Folder reader for a File System Access directory handle (Chromium). */
export function readChartDirectory(
  dirHandle: FileSystemDirectoryHandle,
): Promise<LoadedFiles> {
  return readFolder(folderSourceFromHandle(dirHandle));
}

/**
 * Where a scanned chart lives, and how its files are opened again.
 *
 * A chart found inside the scanned library is addressed by its parent folder
 * and its own name, so it can also be written back beside its siblings. The
 * folder the user picks has no parent handle the File System Access API can
 * supply, so a chart that *is* that folder carries the folder handle instead
 * and cannot be written next to anything. A chart from a file input has no
 * handle at all, only its own folder or `.sng` file: it can be read again, but
 * never written.
 */
export type ChartHandleInfo =
  | {parentDir: FileSystemDirectoryHandle; fileName: string}
  | {dirHandle: FileSystemDirectoryHandle; fileName: string}
  | {selection: FolderSource | FolderFile; fileName: string};

/** Read every file of a chart the scanner found, folder or `.sng`. */
export async function readChartHandle(
  info: ChartHandleInfo,
): Promise<LoadedFiles> {
  if ('selection' in info) {
    const {selection} = info;
    return 'list' in selection
      ? await readFolder(selection)
      : await readSngFile(await selection.file());
  }
  if ('dirHandle' in info) {
    return await readChartDirectory(info.dirHandle);
  }
  if (info.fileName.toLowerCase().endsWith('.sng')) {
    const fileHandle = await info.parentDir.getFileHandle(info.fileName);
    return await readSngFile(await fileHandle.getFile());
  }
  return await readChartDirectory(
    await info.parentDir.getDirectoryHandle(info.fileName),
  );
}

/**
 * Folder reader for browsers without the File System Access API, fed by an
 * `<input type="file" webkitdirectory>` selection.
 */
export async function readChartFileList(
  selection: File[],
): Promise<LoadedFiles> {
  const folder = folderSourceFromFileList(selection);
  // Which is a different failure from an empty folder, and only the selection
  // can tell them apart: by the time readFolder sees them, both are nothing.
  if (folder == null) {
    throw new Error(
      selection.length > 0 ? NOT_A_FOLDER_MESSAGE : EMPTY_FOLDER_MESSAGE,
    );
  }
  return await readFolder(folder);
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
  const folders = droppedFolders(dataTransfer);
  const file: File | undefined = dataTransfer.files[0];

  // One package at a time. Reading the first of several and saying nothing
  // would look like the rest had been merged into it, and drop order is not
  // something the user controls.
  if (folders.length > 1) throw new Error(ONE_CHART_AT_A_TIME_MESSAGE);
  if (folders.length === 1) {
    return {kind: 'chart', loaded: await readFolder(folders[0])};
  }

  if (!file) return {kind: 'nothing'};
  if (dataTransfer.files.length > 1) {
    throw new Error(ONE_CHART_AT_A_TIME_MESSAGE);
  }

  const format = detectFormat(file);
  return format
    ? {kind: 'chart', loaded: await readChartFile(file, format)}
    : {kind: 'file', file};
}

/** The dropped items that are directories, as folder sources. */
function droppedFolders(dataTransfer: DataTransfer): FolderSource[] {
  return Array.from(dataTransfer.items)
    .map(item => (item.kind === 'file' ? item.webkitGetAsEntry?.() : null))
    .filter((entry): entry is FileSystemDirectoryEntry =>
      Boolean(entry?.isDirectory),
    )
    .map(entrySource);
}

/** A dropped directory entry as a folder source. */
function entrySource(directory: FileSystemDirectoryEntry): FolderSource {
  return {
    name: directory.name,
    handle: null,
    list: async () => {
      const children = await readDirectoryEntries(directory);
      return {
        files: children
          .filter((child): child is FileSystemFileEntry => child.isFile)
          .map(child => ({
            name: child.name,
            file: () =>
              new Promise<File>((resolve, reject) =>
                child.file(resolve, reject),
              ),
          })),
        subfolders: children
          .filter(
            (child): child is FileSystemDirectoryEntry => child.isDirectory,
          )
          .map(entrySource),
      };
    },
  };
}
