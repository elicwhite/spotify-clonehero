/**
 * Leading-silence recommendation detector (plan 0074 Design C, last bullet).
 *
 * Pure function over a `ChartDocument` plus an optional externally-detected
 * audio onset. It answers one question for the Chart Assist "Add leading
 * silence" card: should this chart get an amber call-to-action because it
 * looks like it is missing the whole-bar, real-tempo lead-in that
 * `lib/chart-edit/leading-silence.ts` (plan 0064) knows how to add?
 *
 * Lives beside `leading-silence.ts` rather than under `lib/chart-editor-core/`
 * because it reuses that module's exported constant (`COLLAPSE_BPM_MIN`) and
 * chart/synctrack helpers (`synctrackFromChart`) directly — same directory
 * keeps the detector and the machinery it inspects next to each other and
 * avoids a reverse dependency from the lower-level `chart-edit` lib up into
 * `chart-editor-core`.
 *
 * Two independent triggers, either one is sufficient:
 *
 * (a) `first-bpm-outlier` — the tempo map's opening marker is a synthetic
 *     collapse construct (`buildSyncLayout` tier (c) / negative-origin,
 *     BPM >= `COLLAPSE_BPM_MIN`) rather than real music. This is exactly the
 *     `isCollapse` check `planLeadingSilence` already makes; recognizing it
 *     here (before a plan is computed) is what drives the card's
 *     recommendation state.
 * (b) `early-audio-onset` — a caller-supplied detected audio onset (e.g. from
 *     an amplitude/silence detector run over the decoded PCM) lands earlier
 *     than the human-census threshold (`LEAD_MIN_MS`, plan 0064) relative to
 *     the chart's grid start (tick 0, ms 0 by the `buildSyncLayout`
 *     invariant), AND the chart's first note is also inside that threshold —
 *     the quantity `planLeadingSilence` actually sizes its pad from, so the
 *     recommendation can't point at a button that would decline to act. This
 *     module does not run onset detection itself — it is pure over chart +
 *     audio data, so callers own that measurement and pass `null` when it
 *     has not been computed yet (the trigger simply never fires).
 */

import type {ChartDocument} from './types';
import {synctrackFromChart} from './tempo-remap';
import {COLLAPSE_BPM_MIN, LEAD_MIN_MS} from './leading-silence';

/**
 * A caller-supplied detected audio onset, expressed in the SAME ms domain as
 * the chart (tick 0 == ms 0, per the `buildSyncLayout` invariant) — i.e.
 * already translated from raw-audio-sample time into chart time by the
 * caller (accounting for any existing `audioAnchor` padding). `onsetMs` may
 * be negative (onset detected before the chart's tick 0) or positive.
 */
export interface DetectedAudioOnset {
  onsetMs: number;
}

/** Ratio-free outlier threshold for trigger (a): reuses plan 0064's
 * `COLLAPSE_BPM_MIN` — the same BPM floor `planLeadingSilence` uses to
 * recognize a synthetic `buildSyncLayout` tier-(c)/negative-origin collapse
 * marker, so "large outlier vs the second marker" and "is a collapse
 * construct" are the same test, computed once, in one place. */
const OUTLIER_BPM_MIN = COLLAPSE_BPM_MIN;

/** Threshold for trigger (b): reuses plan 0064's `LEAD_MIN_MS` (human census
 * p10 first-note time, 2015ms rounded down) as the "how early is too early"
 * line for a detected audio onset relative to the chart's grid start. */
const EARLY_ONSET_THRESHOLD_MS = LEAD_MIN_MS;

export type LeadingSilenceRecommendationReason =
  | 'first-bpm-outlier'
  | 'early-audio-onset';

/** A fired recommendation. The function returns `null` when nothing is
 *  recommended, so the value's existence IS the recommendation. */
export interface LeadingSilenceRecommendation {
  reason: LeadingSilenceRecommendationReason;
  detail: string;
}

/**
 * Returns a recommendation when either trigger fires, else `null`. Trigger
 * (a) (first-BPM outlier) is checked before (b) (early audio onset); when
 * both would fire, (a) wins since it is the stronger, chart-only signal.
 */
export function detectLeadingSilenceRecommendation(
  doc: ChartDocument,
  audioOnset: DetectedAudioOnset | null,
): LeadingSilenceRecommendation | null {
  const chart = doc.parsedChart;
  const sync = synctrackFromChart(chart);

  if (sync.tempos.length > 1 && sync.tempos[0].bpm >= OUTLIER_BPM_MIN) {
    const first = sync.tempos[0].bpm;
    return {
      reason: 'first-bpm-outlier',
      detail:
        `Opening tempo marker is ${first.toFixed(1)} BPM, at or above the ` +
        `${OUTLIER_BPM_MIN} BPM collapse threshold. This looks like a ` +
        `collapsed lead-in rather than real tempo.`,
    };
  }

  // Both halves have to hold for the recommendation to be honest: the audio
  // starts early AND the chart has less lead-in than the census threshold.
  // `planLeadingSilence` sizes its pad from the FIRST NOTE's ms position, so
  // a chart whose first note already sits past `LEAD_MIN_MS` gets no pad —
  // recommending one there would send the user to a no-op button.
  if (audioOnset !== null && audioOnset.onsetMs < EARLY_ONSET_THRESHOLD_MS) {
    const firstNoteMs = firstNoteMsTime(doc);
    if (firstNoteMs !== null && firstNoteMs < EARLY_ONSET_THRESHOLD_MS) {
      return {
        reason: 'early-audio-onset',
        detail:
          `Detected audio onset at ${audioOnset.onsetMs.toFixed(0)}ms and ` +
          `first note at ${firstNoteMs.toFixed(0)}ms are both earlier than ` +
          `the ${EARLY_ONSET_THRESHOLD_MS}ms lead-in threshold.`,
      };
    }
  }

  return null;
}

/** Earliest charted note's ms position across every track, or null for a
 *  chart with no notes at all (nothing to give a lead-in to). */
function firstNoteMsTime(doc: ChartDocument): number | null {
  let earliest: number | null = null;
  for (const track of doc.parsedChart.trackData) {
    for (const group of track.noteEventGroups) {
      const note = group[0];
      if (!note) continue;
      if (earliest === null || note.msTime < earliest) earliest = note.msTime;
      // Note groups are tick-ordered, so the first group holds this track's
      // earliest note; no need to scan the rest.
      break;
    }
  }
  return earliest;
}
