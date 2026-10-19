/**
 * Container packaging: a flat chart file list plus a choice of container,
 * out the other side a downloadable Blob.
 *
 * The last step of every export flow in the app. Kept here so the three
 * callers (the editor's export dialog, /drum-difficulties, /add-lyrics) share one
 * definition of what a `.zip` and a `.sng` download are, rather than each
 * re-deriving the MIME type and the sng-bytes-to-Blob wrapping.
 */

import type {File as FileEntry} from '@eliwhite/scan-chart';
import {exportAsZip} from './zip';
import {exportAsSng} from './sng';

/** The outer container a chart package is downloaded as. Distinct from the
 *  chart file's own format (`.chart` / `.mid`) inside it. */
export type PackageFormat = 'zip' | 'sng';

export interface ChartPackage {
  blob: Blob;
  /** The container's file extension, without the dot — suitable for
   *  {@link chartPackageFileName}. */
  extension: PackageFormat;
}

/**
 * Package assembled chart files into the requested container.
 *
 * `.sng` is an uncompressed container that pulls song.ini into its header
 * metadata (see {@link exportAsSng}); `.zip` is a plain Clone Hero song
 * folder. Neither branch inspects or rewrites the entries — whatever the
 * caller assembled is what ships.
 */
export function packageChartFiles(
  files: FileEntry[],
  format: PackageFormat,
): ChartPackage {
  if (format === 'sng') {
    const sngBytes = exportAsSng(files);
    return {
      blob: new Blob([sngBytes as Uint8Array<ArrayBuffer>], {
        type: 'application/octet-stream',
      }),
      extension: 'sng',
    };
  }

  return {blob: exportAsZip(files), extension: 'zip'};
}
