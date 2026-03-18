/**
 * Data bridge: convert a ChartDocument to a ParsedChart.
 *
 * Serializes the internal chart model to .chart text format using
 * serializeChart(), then parses it with scan-chart's parseChartFile()
 * to produce a ParsedChart suitable for the highway renderer.
 *
 * This avoids any format mismatch risk -- parseChartFile handles all
 * tempo-to-ms calculations, note grouping, and flag resolution.
 */

import {parseChartFile} from '@eliwhite/scan-chart';
import type {ChartDocument} from './types';
import {serializeChart} from './writer';

export type ParsedChart = ReturnType<typeof parseChartFile>;

/** Default modifiers for pro drums chart parsing. */
const PRO_DRUMS_MODIFIERS = {
  song_length: 0,
  hopo_frequency: 0,
  eighthnote_hopo: false,
  multiplier_note: 0,
  sustain_cutoff_threshold: -1,
  chord_snap_threshold: 0,
  five_lane_drums: false,
  pro_drums: true,
} as const;

/**
 * Convert a ChartDocument to a ParsedChart via serialize -> parse round-trip.
 *
 * The resulting ParsedChart has ms-timed note events, tempo maps, time
 * signatures, sections, and track data ready for the highway renderer.
 *
 * @param doc - The internal chart document to convert.
 * @returns A ParsedChart with all timing data computed by scan-chart.
 */
export function chartDocumentToParsedChart(doc: ChartDocument): ParsedChart {
  const chartText = serializeChart(doc);
  const chartBytes = new TextEncoder().encode(chartText);
  return parseChartFile(chartBytes, 'chart', PRO_DRUMS_MODIFIERS);
}
