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
export const ONE_CHART_AT_A_TIME_MESSAGE =
  'Drop one chart at a time: a single folder, .zip or .sng.';

/** A file inside a folder, read only if it turns out to be part of the chart. */
interface FolderFile {
  name: string;
  read: () => Promise<Uint8Array>;
}

/**
 * A folder, however it was picked. Every source can list its immediate
 * children — a directory handle by iterating it, a dropped entry through its
 * reader, a `webkitdirectory` selection by grouping paths — and that is all
 * `readFolder` needs to find the chart.
 *
 * `list` is called only when the folder's contents are actually needed, so a
 * library folder of hundreds of songs is never enumerated past the level that
 * shows it is not one song.
 */
interface FolderSource {
  name: string;
  list: () => Promise<{files: FolderFile[]; subfolders: FolderSource[]}>;
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
      files.map(async file => ({fileName: file.name, data: await file.read()})),
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

/** A File System Access directory handle as a folder source (Chromium). */
function handleSource(handle: FileSystemDirectoryHandle): FolderSource {
  return {
    name: handle.name,
    list: async () => {
      const files: FolderFile[] = [];
      const subfolders: FolderSource[] = [];
      for await (const [name, child] of handle.entries()) {
        if (child.kind === 'file') {
          const fileHandle = child as FileSystemFileHandle;
          files.push({
            name,
            read: async () =>
              new Uint8Array(await (await fileHandle.getFile()).arrayBuffer()),
          });
        } else {
          subfolders.push(handleSource(child as FileSystemDirectoryHandle));
        }
      }
      return {files, subfolders};
    },
  };
}

/** Folder reader for a File System Access directory handle (Chromium). */
export function readChartDirectory(
  dirHandle: FileSystemDirectoryHandle,
): Promise<LoadedFiles> {
  return readFolder(handleSource(dirHandle));
}

/**
 * A `webkitdirectory` selection as a folder source. That input hands back
 * every file in the tree at once, each carrying its path below the chosen
 * folder in `webkitRelativePath`, so the tree is regrouped from those paths.
 */
interface PathEntry {
  segments: string[];
  read: () => Promise<Uint8Array>;
}

function pathSource(
  name: string,
  entries: PathEntry[],
  depth: number,
): FolderSource {
  return {
    name,
    list: async () => {
      const files = entries
        .filter(entry => entry.segments.length === depth + 1)
        .map(entry => ({name: entry.segments[depth], read: entry.read}));

      const deeper = entries.filter(entry => entry.segments.length > depth + 1);
      const subfolders = Array.from(
        new Set(deeper.map(entry => entry.segments[depth])),
      ).map(childName =>
        pathSource(
          childName,
          deeper.filter(entry => entry.segments[depth] === childName),
          depth + 1,
        ),
      );

      return {files, subfolders};
    },
  };
}

/**
 * Folder reader for browsers without the File System Access API, fed by an
 * `<input type="file" webkitdirectory>` selection.
 */
export function readChartFileList(selection: File[]): Promise<LoadedFiles> {
  const entries: PathEntry[] = selection
    .map(file => ({
      segments: (file.webkitRelativePath ?? '').split('/'),
      read: async () => new Uint8Array(await file.arrayBuffer()),
    }))
    // A path of one segment is a file the browser reported no folder for.
    .filter(({segments}) => segments.length > 1);

  // Which is a different failure from an empty folder, and only this adapter
  // can tell them apart: by the time readFolder sees them, both are nothing.
  if (entries.length === 0 && selection.length > 0) {
    return Promise.reject(new Error(NOT_A_FOLDER_MESSAGE));
  }
  if (entries.length === 0) {
    return Promise.reject(new Error(EMPTY_FOLDER_MESSAGE));
  }

  return readFolder(pathSource(entries[0].segments[0], entries, 1));
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
    list: async () => {
      const children = await readDirectoryEntries(directory);
      return {
        files: children
          .filter((child): child is FileSystemFileEntry => child.isFile)
          .map(child => ({
            name: child.name,
            read: async () => {
              const file = await new Promise<File>((resolve, reject) =>
                child.file(resolve, reject),
              );
              return new Uint8Array(await file.arrayBuffer());
            },
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
