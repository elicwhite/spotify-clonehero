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
