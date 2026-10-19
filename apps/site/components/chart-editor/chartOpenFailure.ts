/**
 * Why the editor refused a chart, as a closed set (plan 0105 Stage 4).
 *
 * The gap between a landing view and `chart_opened` is the funnel's most
 * likely silent drop, and the most likely cause is a user arriving with a
 * chart the editor will not take. The reason has to say which refusal it
 * was — a single open string field is how `add_lyrics_align_failed` came to
 * report `"unknown"` for all 47 of its failures.
 *
 * It lives beside the editor rather than inside `TrackEditPage` because it is
 * a pure classifier with its own tests, and a 1200-line page component is no
 * place for one. `DifficultyGenerationFlow` does not use it: that surface
 * inspects a dropped chart branch by branch, so it names each reason where it
 * decides — strictly better than recovering the reason from a message
 * afterwards.
 */

import type {ChartOpenFailureReason} from '@/lib/analytics/track';

export const NO_SUPPORTED_TRACK_MESSAGE =
  'No guitar, bass, drum, or vocal track found in chart.';

export const NO_AUDIO_MESSAGE = 'No audio files found in chart package';

/**
 * Which refusal a failed load was.
 *
 * Compares against the messages the loaders themselves throw, so the two
 * chart branches are exact rather than heuristic. `chartAccepted` separates
 * the two remaining cases: a chart that never parsed, and a chart that was
 * fine until the store or the router failed. Folding those together would
 * put a full disk in the column the funnel reads as "users arriving with
 * charts we refuse", and quietly overstate it.
 */
export function chartOpenFailureReason(
  err: unknown,
  chartAccepted = false,
): ChartOpenFailureReason {
  const message = err instanceof Error ? err.message : '';
  if (message === NO_SUPPORTED_TRACK_MESSAGE) return 'no-supported-track';
  if (message === NO_AUDIO_MESSAGE) return 'no-audio';
  return chartAccepted ? 'storage-error' : 'parse-error';
}
