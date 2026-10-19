import {scanIni} from '@eliwhite/scan-chart';

/**
 * Compute the normalized chart delay in milliseconds from chart metadata.
 *
 * `delay` (ms, from song.ini) takes precedence.
 * `chart_offset` (also ms: scan-chart converts the .chart Offset field from
 * seconds) is only used as a fallback if `delay` is not set. They are NOT combined — this matches
 * YARG's behavior.
 *
 * Positive value: audio has lead-in silence before the chart starts.
 * Negative value: chart starts before the audio.
 *
 * Usage:
 *   chartTimeMs = audioTimeMs - chartDelayMs   (reading: where is the chart?)
 *   audioTimeMs = chartTimeMs + chartDelayMs   (seeking: play audio at chart position)
 */
export function getChartDelayMs(
  metadata: {delay?: number; chart_offset?: number} | undefined,
): number {
  if (!metadata) return 0;
  // delay takes precedence; chart_offset is fallback only
  if (metadata.delay != null && metadata.delay !== 0) {
    return metadata.delay;
  }
  if (metadata.chart_offset != null) {
    return metadata.chart_offset;
  }
  return 0;
}

/**
 * `parseChartFile` sees only the chart file, so the `delay` a song.ini sets
 * never reaches the metadata it returns, and `getChartDelayMs` would fall back
 * to the .chart `Offset` (or none). This reads `delay` from the folder's
 * song.ini the way `parseChartAndIni` does and puts it on the parsed chart, so
 * the chart delay matches what the chart editor applies to the same files.
 */
export function applyIniDelay<T extends {metadata: {delay?: number}}>(
  chart: T,
  files: {fileName: string; data: Uint8Array}[],
): T {
  const delay = scanIni(files).metadata?.delay;
  if (delay !== undefined) chart.metadata.delay = delay;
  return chart;
}
