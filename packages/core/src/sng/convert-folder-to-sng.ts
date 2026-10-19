/**
 * Batch conversion of on-disk chart folders to `.sng` files.
 *
 * `scanLocalCharts` surfaces every chart in a picked folder — both folder
 * charts and existing `.sng` files. This module picks out the folder charts,
 * packages each with `exportAsSng`, and hands each `<folderName>.sng` to a
 * saver: one that writes it next to its folder through the picked folder's
 * handle, or one that adds it to a `.zip` at the same path where there is no
 * handle to write through.
 */

import pMap from 'p-map';
import {
  readChartLocation,
  type ChartLocation,
} from '../chart-files/chart-package';
import type {FolderSource} from '../file-access/folderSource';
import {exportAsSng} from '../chart-export';
import type {SongAccumulator} from '../local-songs-folder/scanLocalCharts';
import type {PartedZip} from './partedZip';

// Chart folders converted in parallel. Bounded because each task buffers a whole
// chart's files plus its packaged .sng in memory at once; the gain over serial
// is overlapping the per-chart folder read and .sng write I/O.
const CONVERT_CONCURRENCY = 12;

/** A chart the converter can package: a folder inside the picked folder. */
export type ConvertibleChart = SongAccumulator & {
  location: ChartLocation & {parent: FolderSource; entry: FolderSource};
};

/** Where one converted chart's `.sng` goes. */
export type SaveSng = (
  chart: ConvertibleChart,
  sng: Uint8Array,
) => void | Promise<void>;

/**
 * Filter a scan result down to the charts that can be converted to `.sng`.
 *
 * Charts already stored as `.sng` are skipped — they are already packaged. The
 * scanned folder itself is skipped too: it has no parent folder for the `.sng`
 * to sit beside.
 */
export function selectChartFoldersToConvert(
  charts: SongAccumulator[],
): ConvertibleChart[] {
  return charts.filter(
    (chart): chart is ConvertibleChart =>
      chart.location.parent != null && chart.location.entry.kind === 'folder',
  );
}

/**
 * Where a chart's `.sng` goes, relative to the picked folder: next to the
 * chart's own folder.
 */
export function sngPathFor(chart: ConvertibleChart): string {
  const [, ...below] = chart.location.path.split('/');
  return `${below.join('/')}.sng`;
}

/**
 * Write each `.sng` into the picked folder at `sngPathFor`, overwriting any
 * file of that name. The folder must have been picked with `readwrite`.
 */
export function saveIntoFolder(root: FileSystemDirectoryHandle): SaveSng {
  return async (chart, sng) => {
    const segments = sngPathFor(chart).split('/');
    let folder = root;
    for (const name of segments.slice(0, -1)) {
      folder = await folder.getDirectoryHandle(name);
    }
    const file = await folder.getFileHandle(segments[segments.length - 1], {
      create: true,
    });
    const writable = await file.createWritable();
    await writable.write(sng as Uint8Array<ArrayBuffer>);
    await writable.close();
  };
}

/** Add each `.sng` to a `.zip` at `sngPathFor`, for unzipping into the folder. */
export function saveIntoZip(zip: PartedZip): SaveSng {
  return (chart, sng) => zip.add(sngPathFor(chart), sng);
}

export interface ConvertFoldersProgress {
  written: number;
  failed: number;
  total: number;
}

/**
 * Convert many chart folders to `.sng` with bounded parallelism, handing each
 * one to `save`.
 *
 * Each folder is converted independently, so a single chart's failure is
 * counted and reported but never aborts the rest. `onProgress` fires after every
 * chart settles (in completion order, not input order).
 */
export async function convertChartFolders(
  charts: ConvertibleChart[],
  save: SaveSng,
  options: {
    concurrency?: number;
    onProgress?: (progress: ConvertFoldersProgress) => void;
  } = {},
): Promise<{written: number; failed: number}> {
  const {concurrency = CONVERT_CONCURRENCY, onProgress} = options;

  const total = charts.length;
  let written = 0;
  let failed = 0;

  await pMap(
    charts,
    async chart => {
      try {
        const {files} = await readChartLocation(chart.location);
        await save(chart, exportAsSng(files));
        written++;
      } catch (e) {
        failed++;
        console.error(
          `Failed to convert ${chart.location.entry.name} to .sng`,
          e,
        );
      }
      onProgress?.({written, failed, total});
    },
    {concurrency},
  );

  return {written, failed};
}
