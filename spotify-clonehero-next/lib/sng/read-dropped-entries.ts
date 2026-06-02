/**
 * Flatten a drag-and-drop (files and/or folders) into a flat list of file
 * entries. Dropping a folder pulls in every file it contains, recursively;
 * only the basename is kept (the SNG/zip package is a flat list of files).
 *
 * Uses the non-standard but widely supported `webkitGetAsEntry()` so that
 * dropped *directories* can be traversed — `DataTransfer.files` alone only
 * exposes top-level files, not folder contents.
 */

import type {FileEntry} from '@/components/chart-picker/chart-file-readers';

async function fileToEntry(file: File): Promise<FileEntry> {
  return {fileName: file.name, data: new Uint8Array(await file.arrayBuffer())};
}

function getFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** Read all entries of a directory, looping because readEntries() is batched. */
function readDirEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries(batch => {
        if (batch.length === 0) {
          resolve(all);
        } else {
          all.push(...batch);
          readBatch();
        }
      }, reject);
    };
    readBatch();
  });
}

async function walkEntry(entry: FileSystemEntry): Promise<FileEntry[]> {
  // Skip dotfiles like .DS_Store, matching readChartDirectory.
  if (entry.name.startsWith('.')) return [];

  if (entry.isFile) {
    const file = await getFile(entry as FileSystemFileEntry);
    return [await fileToEntry(file)];
  }

  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await readDirEntries(reader);
    const nested = await Promise.all(children.map(walkEntry));
    return nested.flat();
  }

  return [];
}

/**
 * Convert dropped DataTransferItems into a flat `FileEntry[]`.
 * Falls back to `DataTransfer.files` for any items that don't expose a
 * filesystem entry (so plain file drops still work everywhere).
 */
export async function readDroppedItems(
  dataTransfer: DataTransfer,
): Promise<FileEntry[]> {
  const items = Array.from(dataTransfer.items);
  const entries = items
    .map(item => (item.kind === 'file' ? item.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => e != null);

  if (entries.length > 0) {
    const results = await Promise.all(entries.map(walkEntry));
    return results.flat();
  }

  // Fallback: no filesystem entries available — use the plain file list.
  const files = Array.from(dataTransfer.files).filter(
    f => !f.name.startsWith('.'),
  );
  return Promise.all(files.map(fileToEntry));
}

/** Convert a plain FileList (e.g. from an <input multiple>) to FileEntry[]. */
export async function readFileList(fileList: FileList): Promise<FileEntry[]> {
  const files = Array.from(fileList).filter(f => !f.name.startsWith('.'));
  return Promise.all(files.map(fileToEntry));
}
