/**
 * Serialize a `ChartDocument`'s chart file in a specific format, regardless
 * of the format it was parsed from.
 *
 * `writeChartFolder` always writes in `doc.parsedChart.format` — this
 * overrides that field on a shallow copy of the doc before delegating, so
 * callers (e.g. the export dialog's "Chart file" selector) can request
 * `notes.chart` or `notes.mid` independent of the project's stored format.
 * The input doc is never mutated.
 */

import {writeChartFolder} from '@eliwhite/scan-chart';
import type {ChartDocument} from './types';

export interface WrittenChartFile {
  fileName: string;
  data: Uint8Array;
}

/** Re-serialize `doc`'s chart in `format`, returning just the chart file
 * (`notes.chart` or `notes.mid`) from `writeChartFolder`'s output — song.ini
 * and any other entries are discarded, since callers already have their own
 * metadata/asset handling. Throws if `writeChartFolder` didn't produce a
 * chart file in the requested format. */
export function writeChartFileAs(
  doc: ChartDocument,
  format: 'chart' | 'mid',
): WrittenChartFile {
  const overriddenDoc: ChartDocument = {
    ...doc,
    parsedChart: {...doc.parsedChart, format},
  };
  const files = writeChartFolder(overriddenDoc);
  const expectedFileName = format === 'mid' ? 'notes.mid' : 'notes.chart';
  const chartFile = files.find(f => f.fileName === expectedFileName);
  if (!chartFile) {
    throw new Error(
      `writeChartFolder did not produce a ${expectedFileName} file`,
    );
  }
  return {fileName: chartFile.fileName, data: chartFile.data};
}
