/**
 * Turn a scored attempt into a single glanceable verdict for the across-the-room
 * practice banner: are you missing notes, or hitting them early / late / on-time?
 *
 * The drummer is several feet from the screen, so the banner shows ONE headline
 * word plus a signed timing number — not a per-note scatter. This module is the
 * pure decision: given the per-note judgments (signed timing error, negative =
 * early) and the extra-hit count, pick the verdict and the median offset.
 */

import {DEFAULT_WINDOWS} from '@/lib/drum-fills/midi/hitMatcher';
import {median} from '@/lib/drum-fills/midi/calibration';

/** A signed median within this many ms of the beat reads as on-time. Half the
 * perfect window, so it tracks the window constant rather than a magic number. */
export const DIALED_THRESHOLD_MS = DEFAULT_WINDOWS.perfect / 2;

/** Per-note timing for the verdict: hit notes carry a signed deltaMs, misses null. */
export interface NoteTiming {
  judgment: 'perfect' | 'good' | 'miss';
  /** hit − note time in ms (negative = early), or null when missed. */
  deltaMs: number | null;
}

export type Verdict = 'dialed' | 'rushing' | 'dragging' | 'keep-going';

export interface FeedbackVerdict {
  verdict: Verdict;
  /** Headline word, e.g. "RUSHING". */
  label: string;
  /** Signed median timing of hit notes (negative = early), or null when none. */
  medianMs: number | null;
  missCount: number;
  extraCount: number;
}

const LABELS: Record<Verdict, string> = {
  dialed: 'DIALED IN',
  rushing: 'RUSHING',
  dragging: 'DRAGGING',
  'keep-going': 'KEEP GOING',
};

/**
 * Compute the banner verdict from a pass's note judgments + extra count.
 *
 * - No hits, or misses on at least half the notes → "KEEP GOING" (the actionable
 *   problem is missing notes, not timing).
 * - Otherwise classify by the signed median timing of the hit notes:
 *   within ±{@link DIALED_THRESHOLD_MS} → "DIALED IN", earlier → "RUSHING",
 *   later → "DRAGGING".
 *
 * The miss/extra counts are returned separately so the banner can surface
 * "N MISSED" alongside the timing verdict.
 */
export function feedbackVerdict(
  judgments: NoteTiming[],
  extraCount: number,
): FeedbackVerdict {
  const hitDeltas = judgments
    .filter(j => j.deltaMs != null)
    .map(j => j.deltaMs as number);
  const missCount = judgments.filter(j => j.judgment === 'miss').length;
  const total = judgments.length;
  const medianMs = hitDeltas.length ? Math.round(median(hitDeltas)) : null;

  let verdict: Verdict;
  if (hitDeltas.length === 0 || missCount * 2 >= total) {
    verdict = 'keep-going';
  } else if (medianMs != null && Math.abs(medianMs) <= DIALED_THRESHOLD_MS) {
    verdict = 'dialed';
  } else if ((medianMs ?? 0) < 0) {
    verdict = 'rushing';
  } else {
    verdict = 'dragging';
  }

  return {verdict, label: LABELS[verdict], medianMs, missCount, extraCount};
}
