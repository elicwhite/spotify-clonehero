/**
 * Class-(b) RE-PREDICT tempo remap — plan 0061 §3 / §3a / §7.
 *
 * A structural tempo-map correction (half/double-time flip, tap-tempo fit,
 * meter change) changes what the lattice *means*: every note's tick was
 * assigned under a wrong-shaped grid, so keep-ms would fossilize the old
 * quantization into the corrected chart. RE-PREDICT throws the snapped note
 * positions away and re-derives each note fresh from the retained decoded
 * onset times through the corrected lattice — the onsets never encoded the
 * wrong lattice, so re-quantizing *them* avoids compounding the old error
 * (the measured winner for this edit class, plan 0061 appendix).
 *
 * The op is:
 *   1. Take the caller's structurally-corrected `Synctrack` (the octave
 *      rescale / tap fit). This is the warp's INCUMBENT input, not the map
 *      that gets committed.
 *   2. Re-run the SHIPPED windowed KS-warp ({@link warpGridReach}) with that
 *      grid as incumbent, re-fitting drift against the kick/snare onsets at
 *      the corrected octave. The committed tempo map is the WARPED output
 *      (or the corrected grid verbatim when the warp gate abstains).
 *   3. Install the warped grid (keeping every existing event's audio time via
 *      `swapSynctrack`) and REPLACE the ExpertDrums notes with a fresh snap of
 *      the decoded onsets against the warped lattice — reusing
 *      `buildDrumsTrackFromOnsets` (the same snap stage the audio-flow
 *      pipeline runs), never the notes' stored msTime.
 *   4. Steps 3-6 of the class-(a) sequence (section whole-note snap, exact
 *      lyric re-tick, collision nudge, `retimeChart`) apply either way.
 *
 * When the project has no decoded onsets (never transcribed by this app), the
 * op falls back to bounded RESNAP — `remapKeepMs` against the corrected grid,
 * still better than keep-ms for a structural correction — carrying a
 * disclosure flag so the UI can note the audio-derived path was unavailable.
 *
 * Reuses `warpGridReach` and the chart-builder snap stage verbatim — no forked
 * warp/snap implementation (plan 0061 §7 "Pipeline call surface").
 */

import type {ChartDocument} from '@/lib/chart-edit';
import {remapKeepMs, nudgeNoteCollisions, retimeChart} from '@/lib/chart-edit';
import {swapSynctrack} from '@/lib/tempo-map/swap-synctrack';
import {
  warpGridReach,
  REACH_NOTE_MS_TOL,
  type KSWarpReachDiag,
} from '@/lib/tempo-map/ks-warp';
import type {Synctrack} from '@/lib/tempo-map/types';
import type {DecodedOnsetsFile, RawDrumEvent} from '../ml/types';
import {buildDrumsTrackFromOnsets, type TempoLike} from './chart-builder';

/** One retained decoded onset (a `DecodedOnsetsFile` entry). Shape-compatible
 * with `RawDrumEvent`, which is what the snap stage consumes. */
export type DecodedOnset = DecodedOnsetsFile['onsets'][number];

/** Which note-handling op actually produced a committed candidate. */
export type RepredictOp = 're-predict' | 'resnap';

export interface RepredictResult {
  /** The committed candidate document (a new doc; the input is not mutated). */
  doc: ChartDocument;
  /** The op that ran. */
  op: RepredictOp;
  /**
   * True when decoded onsets were unavailable and the op fell back to bounded
   * RESNAP. The UI surfaces this as a disclosure that the audio-derived
   * re-predict path wasn't available (plan 0061 §3a).
   */
  usedResnapFallback: boolean;
  /** KS-warp re-fit diagnostics (null on the RESNAP fallback path). */
  warpDiag: KSWarpReachDiag | null;
}

export interface RepredictOptions {
  /** Abstain band forwarded to the class-(a) post-passes (see `remapKeepMs`). */
  snapToleranceMs?: number;
}

const EXPERT_DRUMS = (
  t: ChartDocument['parsedChart']['trackData'][number],
): boolean => t.instrument === 'drums' && t.difficulty === 'expert';

/** Kick+snare raw onset times (ms) — the warp's drift anchors, matching
 * `finalizeSynctrack`'s SF.decode("raw", ...) contract (uncorrected times). */
function ksOnsetsMs(onsets: readonly DecodedOnset[]): number[] {
  return onsets
    .filter(o => o.drumClass === 'BD' || o.drumClass === 'SD')
    .map(o => o.timeSeconds * 1000);
}

/** All raw onset times (ms) — the note_ms self-guard's evidence set. */
function allOnsetsMs(onsets: readonly DecodedOnset[]): number[] {
  return onsets.map(o => o.timeSeconds * 1000);
}

/**
 * Run the class-(b) RE-PREDICT remap (or its RESNAP fallback).
 *
 * `doc`'s events must still carry their pre-edit `msTime` (the audio anchor).
 * `correctedSync` is the structurally-corrected grid produced by the caller
 * (octave rescale / tap fit — plan 0061 §7, phase 61-7 owns that control).
 * `onsets` is the project's retained decoded onsets, or `null` for a
 * never-transcribed project (→ RESNAP fallback).
 *
 * Pure with respect to `doc` (builds a fresh chart; never mutates the input).
 */
export function repredictTempo(
  doc: ChartDocument,
  correctedSync: Synctrack,
  onsets: DecodedOnsetsFile | null,
  options: RepredictOptions = {},
): RepredictResult {
  // No decoded onsets → bounded RESNAP against the corrected grid. This is
  // `remapKeepMs` (swapSynctrack quantizeNotes + class-(a) steps 3-6), which
  // is exactly plan 0061 §3 class-(b) step 3's fallback.
  if (!onsets || onsets.onsets.length === 0) {
    return {
      doc: remapKeepMs(doc, correctedSync, options),
      op: 'resnap',
      usedResnapFallback: true,
      warpDiag: null,
    };
  }

  // Re-fit drift against the onsets at the corrected octave. The committed map
  // is the WARPED output; a gate abstention leaves the corrected grid as-is.
  const {grid, diag} = warpGridReach(
    correctedSync,
    ksOnsetsMs(onsets.onsets),
    allOnsetsMs(onsets.onsets),
  );
  const warpedSync = grid ?? correctedSync;

  // Install the warped grid, re-ticking sections (whole-note snap), lyrics
  // (exact), and every other track's events by their preserved audio time.
  const installed = swapSynctrack(doc.parsedChart, warpedSync, {
    quantizeNotes: true,
    sectionPolicy: 'snap-whole-note',
    ...(options.snapToleranceMs !== undefined
      ? {snapToleranceMs: options.snapToleranceMs}
      : {}),
  });

  // Replace the ExpertDrums NOTES with a fresh snap of the decoded onsets
  // against the warped tick-domain tempos (the snap stage the audio-flow
  // pipeline runs). Star power / solos / flex lanes already re-ticked by
  // swapSynctrack are preserved — only the notes are re-derived.
  const tempoLike: TempoLike[] = installed.tempos.map(t => ({
    tick: t.tick,
    beatsPerMinute: t.beatsPerMinute,
  }));
  const {track: freshDrums} = buildDrumsTrackFromOnsets(
    onsets.onsets as RawDrumEvent[],
    tempoLike,
    installed.resolution,
    onsets.flow,
  );

  const drumsIdx = installed.trackData.findIndex(EXPERT_DRUMS);
  if (drumsIdx >= 0) {
    installed.trackData[drumsIdx] = {
      ...installed.trackData[drumsIdx],
      noteEventGroups: freshDrums.noteEventGroups,
    };
  } else {
    installed.trackData.push(freshDrums);
  }

  // Class-(a) steps 5-6: collision nudge per track, then final retime so every
  // event's msTime matches its tick (the fresh drum notes get real times here).
  for (const track of installed.trackData) {
    track.noteEventGroups = nudgeNoteCollisions(track.noteEventGroups);
  }
  retimeChart(installed);

  return {
    doc: {...doc, parsedChart: installed},
    op: 're-predict',
    usedResnapFallback: false,
    warpDiag: diag,
  };
}

// ---------------------------------------------------------------------------
// Op-disagreement plumbing (plan 0061 §3a) — DEAD CODE, feature-flagged OFF.
//
// The op-disagreement check surfaces a KEEP-MS vs RE-PREDICT choice to the
// user only when the two ops disagree by more than a calibrated ms threshold.
// v1 has NO non-previewed class-(b) entry point (the only trigger, §7's
// half/double + tap-tempo control, always previews before committing — the
// preview IS the op choice), so this never runs live. The concrete ms
// threshold is an unresolved Eli decision (§3a's "UNRESOLVED" note); this is
// wired as dead code so a FUTURE non-previewed entry point (e.g. a batch "fix
// common issues" scanner) can enable it without re-deriving the plumbing.
// ---------------------------------------------------------------------------

/**
 * Feature flag for the op-disagreement check — OFF in v1. See the block
 * comment above. Nothing in the live edit path reads {@link computeOpDisagreement}.
 */
export const OP_DISAGREEMENT_CHECK_ENABLED = false;

export interface OpDisagreement {
  /** Per-note |keepMs.msTime - repredict.msTime| over the ExpertDrums notes,
   * paired in ascending-tick order over the shorter of the two note lists
   * (the ops can re-derive different note counts). */
  perNoteDeltaMs: number[];
  medianMs: number;
  p90Ms: number;
}

function expertDrumMsTimes(doc: ChartDocument): number[] {
  const track = doc.parsedChart.trackData.find(EXPERT_DRUMS);
  if (!track) return [];
  return track.noteEventGroups
    .flat()
    .map(n => n.msTime)
    .sort((a, b) => a - b);
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] * (hi - idx) + sortedAsc[hi] * (idx - lo);
}

/**
 * Compute the per-note ms disagreement between a KEEP-MS candidate and a
 * RE-PREDICT candidate (plan 0061 §3a step 2). DEAD CODE — see
 * {@link OP_DISAGREEMENT_CHECK_ENABLED}. Pairs ExpertDrums notes in
 * ascending-time order over the shorter list.
 */
export function computeOpDisagreement(
  keepMsDoc: ChartDocument,
  repredictDoc: ChartDocument,
): OpDisagreement {
  const a = expertDrumMsTimes(keepMsDoc);
  const b = expertDrumMsTimes(repredictDoc);
  const n = Math.min(a.length, b.length);
  const perNoteDeltaMs: number[] = [];
  for (let i = 0; i < n; i++) perNoteDeltaMs.push(Math.abs(a[i] - b[i]));
  const sorted = [...perNoteDeltaMs].sort((x, y) => x - y);
  return {
    perNoteDeltaMs,
    medianMs: percentile(sorted, 50),
    p90Ms: percentile(sorted, 90),
  };
}

/**
 * Whether two ops materially disagree (plan 0061 §3a step 3). DEAD CODE — see
 * {@link OP_DISAGREEMENT_CHECK_ENABLED}. `thresholdMs` is unresolved in v1.
 */
export function opsMateriallyDisagree(
  d: OpDisagreement,
  thresholdMs: number,
): boolean {
  return d.medianMs > thresholdMs;
}

// ---------------------------------------------------------------------------
// Guarded batch/automated path (plan 0061 §3a "guarded batch path") — DEAD
// CODE, feature-flagged OFF pending external certification (no known landing
// date). An automatic (non-preview) re-predict reverts to KEEP-MS on any song
// where it would worsen the post-snap note-to-onset fit beyond REACH_NOTE_MS_TOL.
// The interactive path (§7) uses accept/reject as its guard instead and never
// touches this. Shipping this un-flagged before certification would ship an
// unguarded claim (plan 0061 Risks).
// ---------------------------------------------------------------------------

/** Feature flag for the guarded batch re-predict path — OFF, certification
 * pending (plan 0061 §3a / Risks). {@link guardedBatchRepredict} throws while
 * this is false so it can never be shipped by accident. */
export const BATCH_REPREDICT_ENABLED = false;

/**
 * The batch guard's decision (plan 0061 §3a): revert an automated re-predict
 * to the KEEP-MS result when re-predict's median post-snap note fit is worse
 * than keep-ms's by more than `tolMs`. Pure; testable independently of the
 * flag.
 */
export function noteMsGuardPicksKeepMs(
  repredictMedianMs: number,
  keepMsMedianMs: number,
  tolMs: number = REACH_NOTE_MS_TOL,
): boolean {
  return repredictMedianMs > keepMsMedianMs + tolMs;
}

/** Median distance (ms) from each ExpertDrums note to its nearest decoded
 * onset — the batch guard's note-fit measure. */
export function medianNoteOnsetDistanceMs(
  doc: ChartDocument,
  onsets: readonly DecodedOnset[],
): number {
  const noteMs = expertDrumMsTimes(doc);
  if (noteMs.length === 0 || onsets.length === 0) return 0;
  const onsetMs = onsets.map(o => o.timeSeconds * 1000).sort((a, b) => a - b);
  const dists = noteMs.map(m => {
    // nearest onset by binary search
    let lo = 0;
    let hi = onsetMs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (onsetMs[mid] < m) lo = mid + 1;
      else hi = mid;
    }
    let best = Math.abs(onsetMs[lo] - m);
    if (lo > 0) best = Math.min(best, Math.abs(onsetMs[lo - 1] - m));
    return best;
  });
  dists.sort((a, b) => a - b);
  return percentile(dists, 50);
}

/**
 * Guarded batch/automated RE-PREDICT (plan 0061 §3a). DEAD CODE — gated OFF by
 * {@link BATCH_REPREDICT_ENABLED}; throws while the flag is false. Runs
 * RE-PREDICT, then reverts to the KEEP-MS result when re-predict worsens the
 * median note-to-onset fit beyond `tolMs` ({@link noteMsGuardPicksKeepMs}).
 */
export function guardedBatchRepredict(
  doc: ChartDocument,
  correctedSync: Synctrack,
  onsets: DecodedOnsetsFile | null,
  options: RepredictOptions = {},
  tolMs: number = REACH_NOTE_MS_TOL,
): RepredictResult {
  if (!BATCH_REPREDICT_ENABLED) {
    throw new Error(
      'guardedBatchRepredict is certification-pending and feature-flagged off ' +
        '(plan 0061 §3a); no automated re-predict path may run in v1.',
    );
  }
  const repredicted = repredictTempo(doc, correctedSync, onsets, options);
  if (!onsets || onsets.onsets.length === 0) return repredicted;

  const keepMs = remapKeepMs(doc, correctedSync, options);
  const repredictFit = medianNoteOnsetDistanceMs(
    repredicted.doc,
    onsets.onsets,
  );
  const keepMsFit = medianNoteOnsetDistanceMs(keepMs, onsets.onsets);
  if (noteMsGuardPicksKeepMs(repredictFit, keepMsFit, tolMs)) {
    return {
      doc: keepMs,
      op: 'resnap',
      usedResnapFallback: false,
      warpDiag: repredicted.warpDiag,
    };
  }
  return repredicted;
}
