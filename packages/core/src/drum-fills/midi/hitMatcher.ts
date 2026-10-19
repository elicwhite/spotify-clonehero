/**
 * Hit matching: expected drum notes vs. timestamped MIDI hits.
 *
 * Pure logic — no DOM, no Web MIDI. The practice layer collects hits (already
 * timestamped and calibration-corrected) and the expected note pattern for a
 * fill, then calls {@link matchHits} to produce per-note judgments.
 *
 * Matching is greedy nearest-first within timing windows. A hit can only match
 * an expected note whose lane + class agree (same lane, and cymbal-vs-tom
 * matches). Unmatched hits become "extras"; unmatched notes become "misses".
 */

import type {DrumLane} from './padMapping';

/** Timing judgment for a matched note. */
export type Judgment = 'perfect' | 'good' | 'miss';

/**
 * Default timing windows in milliseconds.
 *
 * The hit (`good`) boundary of ±70 ms matches YARG's static symmetric drums
 * window: YARG.Core `Engine/Drums/EnginePreset.Instruments.cs` sets the drums
 * default MaxWindow/MinWindow to 0.14 s (full window) with FrontToBackRatio 1.0,
 * and `Engine/HitWindowSettings.cs` `GetFrontEnd`/`GetBackEnd` split that full
 * window into ±0.07 s front/back. Beyond ±70 ms is a miss. YARG matches the
 * first in-window note whose pad matches (forward scan) and treats any input
 * matching no in-window note as an overhit; we match nearest-first instead,
 * which is equivalent for a single hit and slightly more forgiving for clusters
 * — acceptable for a practice scorer.
 *
 * YARG has no perfect/good split. The ±50 ms `perfect` window is our own
 * pedagogical addition: it drives feedback granularity (green vs amber) and the
 * score weighting, never whether a note counts as hit. It sits at ±50 (not the
 * tighter ±30 a game might use) because real play telemetry showed the bulk of
 * accurate, in-pocket hits land 30–50 ms off the grid; ±30 under-credited them
 * and made complete clean fills feel unfairly low.
 */
export const DEFAULT_WINDOWS = {
  /** |delta| ≤ perfect → perfect (pedagogical inner window, not from YARG). */
  perfect: 50,
  /** |delta| ≤ good → hit; otherwise miss. Matches YARG's ±70 ms drums window. */
  good: 70,
} as const;

export interface TimingWindows {
  perfect: number;
  good: number;
}

/** An expected note in the fill pattern. */
export interface ExpectedNote {
  /** Stable identifier (e.g. index or tick) so callers can correlate results. */
  id: string | number;
  /** Target time in milliseconds (same clock domain as hits). */
  msTime: number;
  lane: DrumLane;
  /** True for cymbal voicing; false for tom/snare/kick. */
  isCymbal: boolean;
}

/** A timestamped, calibration-corrected MIDI hit. */
export interface TimedHit {
  /** Time the hit landed, in milliseconds (same clock domain as notes). */
  msTime: number;
  lane: DrumLane;
  isCymbal: boolean;
}

/** Result for a single expected note. */
export interface NoteJudgment {
  note: ExpectedNote;
  judgment: Judgment;
  /** The matched hit, if any. */
  hit: TimedHit | null;
  /** hit.msTime − note.msTime (positive = late), or null when missed. */
  deltaMs: number | null;
}

/** A hit that matched no expected note. */
export interface ExtraHit {
  hit: TimedHit;
}

export interface MatchResult {
  judgments: NoteJudgment[];
  extras: ExtraHit[];
  counts: {
    perfect: number;
    good: number;
    miss: number;
    extra: number;
  };
}

function classMatches(note: ExpectedNote, hit: TimedHit): boolean {
  return note.lane === hit.lane && note.isCymbal === hit.isCymbal;
}

interface Candidate {
  noteIdx: number;
  hitIdx: number;
  absDelta: number;
}

/**
 * Match timed hits against expected notes.
 *
 * Greedy assignment: all (note, compatible-hit) pairs within the `good` window
 * are ranked by absolute timing error and assigned closest-first, so flams and
 * simultaneous notes resolve to their nearest hits. Each note and each hit is
 * used at most once. Leftover hits become extras; leftover notes become misses.
 */
export function matchHits(
  notes: ExpectedNote[],
  hits: TimedHit[],
  windows: TimingWindows = DEFAULT_WINDOWS,
): MatchResult {
  // Build all viable candidate pairings within the good window.
  const candidates: Candidate[] = [];
  for (let n = 0; n < notes.length; n++) {
    const note = notes[n];
    for (let h = 0; h < hits.length; h++) {
      const hit = hits[h];
      if (!classMatches(note, hit)) continue;
      const delta = hit.msTime - note.msTime;
      const absDelta = Math.abs(delta);
      if (absDelta <= windows.good) {
        candidates.push({noteIdx: n, hitIdx: h, absDelta});
      }
    }
  }

  // Closest pairings first; ties broken deterministically by note then hit.
  candidates.sort(
    (a, b) =>
      a.absDelta - b.absDelta || a.noteIdx - b.noteIdx || a.hitIdx - b.hitIdx,
  );

  const noteToHit = new Array<number>(notes.length).fill(-1);
  const hitUsed = new Array<boolean>(hits.length).fill(false);

  for (const cand of candidates) {
    if (noteToHit[cand.noteIdx] !== -1) continue;
    if (hitUsed[cand.hitIdx]) continue;
    noteToHit[cand.noteIdx] = cand.hitIdx;
    hitUsed[cand.hitIdx] = true;
  }

  const judgments: NoteJudgment[] = [];
  const counts = {perfect: 0, good: 0, miss: 0, extra: 0};

  for (let n = 0; n < notes.length; n++) {
    const note = notes[n];
    const hIdx = noteToHit[n];
    if (hIdx === -1) {
      judgments.push({note, judgment: 'miss', hit: null, deltaMs: null});
      counts.miss += 1;
      continue;
    }
    const hit = hits[hIdx];
    const deltaMs = hit.msTime - note.msTime;
    const absDelta = Math.abs(deltaMs);
    const judgment: Judgment = absDelta <= windows.perfect ? 'perfect' : 'good';
    judgments.push({note, judgment, hit, deltaMs});
    counts[judgment] += 1;
  }

  const extras: ExtraHit[] = [];
  for (let h = 0; h < hits.length; h++) {
    if (!hitUsed[h]) {
      extras.push({hit: hits[h]});
      counts.extra += 1;
    }
  }

  return {judgments, extras, counts};
}
