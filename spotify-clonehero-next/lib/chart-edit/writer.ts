/**
 * Chart writer — serializes a ChartDocument back to a set of FileEntry files.
 *
 * Delegates format-specific serialization to writer-chart, writer-mid, and writer-ini.
 * Returns a complete file set ready for ZIP packaging or OPFS storage.
 */

import type { ChartDocument, FileEntry } from './types';
import { serializeChart } from './writer-chart';
import { serializeMidi } from './writer-mid';
import { serializeIni } from './writer-ini';

const encoder = new TextEncoder();

/**
 * Serialize a ChartDocument to an array of FileEntry files.
 *
 * The output includes:
 * - The chart file (notes.chart or notes.mid, based on originalFormat)
 * - song.ini (from metadata)
 * - All pass-through assets (audio, video, images, extra chart files)
 */
export function writeChart(doc: ChartDocument): FileEntry[] {
  const result: FileEntry[] = [];

  // 1. Serialize chart data to the original format
  if (doc.originalFormat === 'chart') {
    const chartText = serializeChart(doc);
    result.push({
      fileName: 'notes.chart',
      data: encoder.encode(chartText),
    });
  } else {
    const midiData = serializeMidi(doc);
    result.push({
      fileName: 'notes.mid',
      data: midiData,
    });
  }

  // 2. Serialize metadata to song.ini
  const iniText = serializeIni(doc.metadata);
  result.push({
    fileName: 'song.ini',
    data: encoder.encode(iniText),
  });

  // 3. Include all pass-through assets
  for (const asset of doc.assets) {
    result.push(asset);
  }

  return result;
}
