/**
 * ZIP packaging for chart export.
 *
 * Takes a generic list of file entries and produces a .zip Blob.
 * Uses fflate for fast, synchronous, browser-native ZIP compression.
 */

import {zipSync} from 'fflate';
import type {FileEntry} from './types';

/**
 * Package file entries into a ZIP blob.
 *
 * @param files - Array of {filename, data} entries to include.
 * @returns A Blob with MIME type application/zip.
 */
export function exportAsZip(files: FileEntry[]): Blob {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    entries[f.filename] = f.data;
  }
  const zipData = zipSync(entries);
  return new Blob([zipData as Uint8Array<ArrayBuffer>], {type: 'application/zip'});
}
