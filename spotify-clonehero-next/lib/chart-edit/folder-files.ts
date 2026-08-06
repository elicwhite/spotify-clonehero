/**
 * The two files a stored project is made of, from one serialization.
 *
 * `writeChartFolder` emits both the chart file and a `song.ini` on every
 * call. A host that saves only the chart drops every field a `.chart` file
 * has nowhere to carry (every `diff_*` but the lead guitar's, `icon`,
 * `loading_phrase`, custom keys), so both hosts take the pair from here and
 * write both — from one call, so the chart and the ini can never describe
 * different documents.
 */

import {writeChartFolder} from '@eliwhite/scan-chart';
import type {ChartDocument} from './types';
import type {WrittenChartFile} from './write-chart-file-as';

export interface ChartFolderFiles {
  /** `notes.chart` or `notes.mid`, whichever `doc.parsedChart.format` writes. */
  chart: WrittenChartFile;
  /** `song.ini`, holding the metadata the chart file cannot express. */
  ini: WrittenChartFile;
}

export function chartDocToFolderFiles(doc: ChartDocument): ChartFolderFiles {
  const files = writeChartFolder(doc);
  const chart = files.find(
    f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
  );
  if (!chart) {
    throw new Error('writeChartFolder did not produce a chart file');
  }
  const ini = files.find(f => f.fileName.toLowerCase() === 'song.ini');
  if (!ini) {
    throw new Error('writeChartFolder did not produce a song.ini');
  }
  return {chart, ini};
}
