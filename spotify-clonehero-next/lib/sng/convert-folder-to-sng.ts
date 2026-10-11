/**
 * Batch conversion of on-disk chart folders to `.sng` files.
 *
 * `scanLocalCharts` surfaces every chart in a picked directory — both folder
 * charts and existing `.sng` files. This module picks out the folder charts and
 * packages each with `exportAsSng`. Where the folder came with a handle, each
 * `<folderName>.sng` is written next to the folder it came from; where it came
 * from a file input, the caller collects them into a `.zip` instead, at the
 * same paths.
 */

import pMap from 'p-map';
import {readChartLocation} from '@/lib/chart-files/chart-package';
import type {FolderSource} from '@/lib/file-access/folderSource';
import {exportAsSng} from '@/lib/chart-export';
import type {SongAccumulator} from '@/lib/local-songs-folder/scanLocalCharts';

// Chart folders converted in parallel. Bounded because each task buffers a whole
// chart's files plus its packaged .sng in memory at once; the gain over serial
// is overlapping the per-chart folder read and .sng write I/O.
const CONVERT_CONCURRENCY = 12;

/** A chart the converter can package: a folder inside the picked folder. */
export type ConvertibleChart = SongAccumulator & {
  location: {parent: FolderSource; entry: FolderSource; path: string};
};

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

/** The `.sng` file name a chart folder converts to. */
export function sngFileNameForFolder(folderName: string): string {
  return `${folderName}.sng`;
}

/** Read a chart folder's files and package them as one `.sng`. */
export async function packageChartAsSng(
  chart: ConvertibleChart,
): Promise<Uint8Array> {
  const {files} = await readChartLocation(chart.location);
  return exportAsSng(files);
}

/**
 * Where a chart's `.sng` goes inside a `.zip` of the picked folder: next to
 * the chart's folder, so unzipping into the picked folder puts it where
 * `convertChartFolderToSng` would have written it.
 */
export function sngZipPath(chart: ConvertibleChart): string {
  const [, ...below] = chart.location.path.split('/');
  return sngFileNameForFolder(below.join('/'));
}

/**
 * Convert a single folder chart to a `.sng` and write it next to the folder,
 * overwriting any existing file of that name. The folder the scan started
 * from must have been picked with `readwrite` permission.
 */
export async function convertChartFolderToSng(
  chart: ConvertibleChart,
): Promise<void> {
  const {parent, entry} = chart.location;
  // Every chart of one scan has a handle, or none does, and the caller only
  // asks for this when the picked folder had one.
  if (parent.handle == null) {
    throw new Error(`No folder handle to write ${entry.name}.sng beside`);
  }

  const sngBytes = await packageChartAsSng(chart);
  const sngHandle = await parent.handle.getFileHandle(
    sngFileNameForFolder(entry.name),
    {create: true},
  );
  const writable = await sngHandle.createWritable();
  await writable.write(sngBytes as Uint8Array<ArrayBuffer>);
  await writable.close();
}

export interface ConvertFoldersProgress {
  written: number;
  failed: number;
  total: number;
}

/**
 * Convert many chart folders to `.sng` with bounded parallelism.
 *
 * Each folder is converted independently, so a single chart's failure is
 * counted and reported but never aborts the rest. `onProgress` fires after every
 * chart settles (in completion order, not input order).
 */
export async function convertChartFolders(
  charts: ConvertibleChart[],
  options: {
    concurrency?: number;
    onProgress?: (progress: ConvertFoldersProgress) => void;
    // Seam for tests to drive the orchestration without touching the file system.
    convert?: (chart: ConvertibleChart) => Promise<void>;
  } = {},
): Promise<{written: number; failed: number}> {
  const {
    concurrency = CONVERT_CONCURRENCY,
    onProgress,
    convert = convertChartFolderToSng,
  } = options;

  const total = charts.length;
  let written = 0;
  let failed = 0;

  await pMap(
    charts,
    async chart => {
      try {
        await convert(chart);
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
