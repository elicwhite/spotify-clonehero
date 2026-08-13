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

export async function readChartDirectory(
  dirHandle: FileSystemDirectoryHandle,
): Promise<LoadedFiles> {
  const files: FileEntry[] = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind !== 'file') continue;
    // Read every file in the folder and let scan-chart route them: the
    // chart/ini files become the parsed structure, everything else
    // (audio stems, album art, background.png, highway.png, video, etc.)
    // lands in `chartDoc.assets` so writeChartFolder can round-trip them.
    // The zip + sng readers below already pass everything through.
    if (name.startsWith('.')) continue; // skip dotfiles like .DS_Store
    const file = await (handle as FileSystemFileHandle).getFile();
    files.push({
      fileName: name,
      data: new Uint8Array(await file.arrayBuffer()),
    });
  }
  return {files, sourceFormat: 'folder', originalName: dirHandle.name};
}

/** Thrown when the selection is not something a chart can be read out of. */
export const NOT_A_FOLDER_MESSAGE =
  'Your browser did not return a folder. Select a .zip or .sng file instead.';
export const SELECT_SONG_FOLDER_MESSAGE =
  'Select the song’s own folder: the one with the chart file in it.';
export const EMPTY_FOLDER_MESSAGE = 'That folder has no files in it.';

/**
 * Folder reader for browsers without the File System Access API, fed by an
 * `<input type="file" webkitdirectory>` selection. That input hands back every
 * file in the tree at once, each carrying its path below the selected folder in
 * `webkitRelativePath`, so the directory structure `readChartDirectory` gets
 * from a handle has to be recovered from those paths.
 *
 * Every way this can fail throws with a message about the folder, because the
 * alternative — returning no files — surfaces to the user as a chart parsing
 * error, which is not what went wrong.
 */
export async function readChartFileList(
  selection: File[],
): Promise<LoadedFiles> {
  const entries = selection
    // A path of one segment is a file the browser did not report a folder for.
    // Nothing below can place such a file, so they are rejected outright rather
    // than silently dropped.
    .map(file => ({file, segments: (file.webkitRelativePath ?? '').split('/')}))
    .filter(({segments}) => segments.length > 1)
    // Skip dotfiles as readChartDirectory does, and dot-directories with them.
    // The selected folder's own name is exempt: the user chose it, and a chart
    // kept in a hidden folder is still the chart they meant.
    .filter(
      ({segments}) => !segments.slice(1).some(name => name.startsWith('.')),
    );

  if (entries.length === 0) {
    throw new Error(
      selection.length === 0 ? EMPTY_FOLDER_MESSAGE : NOT_A_FOLDER_MESSAGE,
    );
  }

  // Files directly inside the selected folder, matching readChartDirectory,
  // which reads one level and does not recurse.
  let chartEntries = entries.filter(({segments}) => segments.length === 2);

  if (chartEntries.length === 0) {
    // The selected folder holds no files of its own. If everything lives under
    // a single subdirectory, the user picked the parent of the song folder —
    // a common enough slip that the zip reader already tolerates its
    // equivalent — so read that subdirectory instead. Anything less certain
    // than that (several subfolders, or a still deeper tree) is the user's to
    // resolve; guessing at which song they meant would be worse than asking.
    const subdirectories = new Set(entries.map(({segments}) => segments[1]));
    chartEntries =
      subdirectories.size === 1
        ? entries.filter(({segments}) => segments.length === 3)
        : [];
    if (chartEntries.length === 0) {
      throw new Error(SELECT_SONG_FOLDER_MESSAGE);
    }
  }

  const files: FileEntry[] = await Promise.all(
    chartEntries.map(async ({file, segments}) => ({
      fileName: segments[segments.length - 1],
      data: new Uint8Array(await file.arrayBuffer()),
    })),
  );

  // Named after the folder the chart was actually read from, not the one the
  // user happened to select: this is the export's filename and the project's
  // fallback song name, so descending into a subfolder has to carry its name.
  const chartPath = chartEntries[0].segments;
  return {
    files,
    sourceFormat: 'folder',
    originalName: chartPath[chartPath.length - 2],
  };
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
// Detect format from a dropped File
// ---------------------------------------------------------------------------

export function detectFormat(file: File): 'zip' | 'sng' | null {
  const ext = getExtension(file.name).toLowerCase();
  if (ext === 'zip') return 'zip';
  if (ext === 'sng') return 'sng';
  return null;
}
