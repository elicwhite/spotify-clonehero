/**
 * Batch conversion of on-disk chart folders to sibling `.sng` files.
 *
 * `scanLocalCharts` surfaces every chart in a picked directory — both folder
 * charts and existing `.sng` files. This module picks out the folder charts,
 * packages each with `exportAsSng`, and writes a `<folderName>.sng` next to the
 * folder it came from.
 */

import pMap from 'p-map';
import {readChartDirectory} from '@/components/chart-picker/chart-file-readers';
import {exportAsSng} from '@/lib/chart-export';
import type {SongAccumulator} from '@/lib/local-songs-folder/scanLocalCharts';

// Chart folders converted in parallel. Bounded because each task buffers a whole
// chart's files plus its packaged .sng in memory at once; the gain over serial
// is overlapping the per-chart folder read and .sng write I/O.
const CONVERT_CONCURRENCY = 12;

/**
 * Filter a scan result down to the charts that can be converted to `.sng`.
 *
 * Charts already stored as `.sng` (surfaced by the scan with a `.sng` file
 * name) are skipped — they are already packaged. Only folder charts remain.
 */
export function selectChartFoldersToConvert(
  charts: SongAccumulator[],
): SongAccumulator[] {
  return charts.filter(
    chart => !chart.handleInfo.fileName.toLowerCase().endsWith('.sng'),
  );
}

/** The `.sng` file name a chart folder converts to. */
export function sngFileNameForFolder(folderName: string): string {
  return `${folderName}.sng`;
}

/**
 * Convert a single folder chart to a `.sng` and write it next to the folder.
 *
 * Reads the folder's files, packages them with `exportAsSng`, and writes
 * `<folderName>.sng` into the folder's parent directory (overwriting any
 * existing file of that name). The parent handle must have been opened with
 * `readwrite` permission.
 */
export async function convertChartFolderToSng(
  chart: SongAccumulator,
): Promise<void> {
  const {parentDir, fileName} = chart.handleInfo;

  const folderHandle = await parentDir.getDirectoryHandle(fileName);
  const {files} = await readChartDirectory(folderHandle);
  const sngBytes = exportAsSng(files);

  const sngHandle = await parentDir.getFileHandle(
    sngFileNameForFolder(fileName),
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
  charts: SongAccumulator[],
  options: {
    concurrency?: number;
    onProgress?: (progress: ConvertFoldersProgress) => void;
    // Seam for tests to drive the orchestration without touching the file system.
    convert?: (chart: SongAccumulator) => Promise<void>;
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
          `Failed to convert ${chart.handleInfo.fileName} to .sng`,
          e,
        );
      }
      onProgress?.({written, failed, total});
    },
    {concurrency},
  );

  return {written, failed};
}
