/**
 * Diagnostics for live practice scoring.
 *
 * When a player reports "good" hits being scored as Miss/Extra, the cause is
 * almost always one of: wrong pad (lane/cymbal mismatch), a timing error outside
 * the ±window, or a double hit colliding on one note. This module turns a scored
 * attempt into a human-readable record explaining each note and each extra hit,
 * and stashes those records in a persistent buffer on `window` so they survive
 * across loop passes and can be inspected later (e.g. via DevTools or the
 * chrome-devtools MCP):
 *
 *   window.__drumFillScoringLog   // AttemptDebug[]
 *
 * The diagnosis logic is pure and unit-tested; only {@link recordAttemptDebug}
 * touches `window`.
 */

import type {DrumLane} from '@/lib/drum-fills/midi/padMapping';
import {
  type ExpectedNote,
  type MatchResult,
  type TimingWindows,
  DEFAULT_WINDOWS,
} from '@/lib/drum-fills/midi/hitMatcher';

/** Key for the persistent scoring log on `window`. */
export const SCORING_LOG_KEY = '__drumFillScoringLog';
/** Cap so a long session doesn't grow the buffer without bound. */
const LOG_LIMIT = 1000;

/** A buffered hit enriched with the raw MIDI info we dropped for scoring. */
export interface DebugHit {
  /** Raw MIDI note number that produced this hit. */
  noteNumber: number;
  velocity: number;
  lane: DrumLane;
  isCymbal: boolean;
  /** Loop-relative ms (calibration-corrected) used for matching. */
  loopRelMs: number;
}

/** Why a hit ended up as an extra (matched no expected note). */
export interface ExtraDiagnosis {
  hit: DebugHit;
  reason: string;
  /** Δms to the nearest note with the same lane + voicing, or null if none. */
  nearestSameClassDeltaMs: number | null;
  /** The nearest expected note of any lane, for lane/voicing mismatch hints. */
  nearestAny: {lane: DrumLane; isCymbal: boolean; deltaMs: number} | null;
}

export interface AttemptNoteDebug {
  id: string;
  lane: DrumLane;
  isCymbal: boolean;
  noteMs: number;
  judgment: 'perfect' | 'good' | 'miss';
  deltaMs: number | null;
}

/** A full record of one scored attempt. */
export interface AttemptDebug {
  /** 1-based attempt index within this page session. */
  attempt: number;
  calibrationOffsetMs: number;
  /** Playback tempo (percent) the attempt was played at. */
  tempoPct: number;
  counts: MatchResult['counts'];
  score: number;
  expected: {id: string; lane: DrumLane; isCymbal: boolean; msTime: number}[];
  notes: AttemptNoteDebug[];
  hits: DebugHit[];
  extras: ExtraDiagnosis[];
}

/** Human-readable pad label, e.g. "yellow cymbal" or "red". */
export function describeLane(lane: DrumLane, isCymbal: boolean): string {
  if (lane === 'kick' || lane === 'red') return lane;
  return `${lane} ${isCymbal ? 'cymbal' : 'tom'}`;
}

/**
 * Explain why a single hit matched no expected note. Compares it against the
 * full expected pattern: a same-pad note inside the window means a collision
 * (double hit), a same-pad note outside means timing, a near note on a different
 * pad means a lane/voicing mismatch.
 */
export function diagnoseExtra(
  hit: DebugHit,
  notes: ExpectedNote[],
  windows: TimingWindows = DEFAULT_WINDOWS,
): ExtraDiagnosis {
  let nearestSame: {delta: number} | null = null;
  let nearestAny: {note: ExpectedNote; delta: number} | null = null;
  for (const note of notes) {
    const delta = hit.loopRelMs - note.msTime;
    const abs = Math.abs(delta);
    if (!nearestAny || abs < Math.abs(nearestAny.delta)) {
      nearestAny = {note, delta};
    }
    if (note.lane === hit.lane && note.isCymbal === hit.isCymbal) {
      if (!nearestSame || abs < Math.abs(nearestSame.delta)) {
        nearestSame = {delta};
      }
    }
  }

  const pad = describeLane(hit.lane, hit.isCymbal);
  let reason: string;
  if (nearestSame && Math.abs(nearestSame.delta) <= windows.good) {
    reason = `${pad} note within ±${windows.good}ms (Δ${nearestSame.delta.toFixed(0)}ms) was already matched by another hit — likely a double/bounced hit`;
  } else if (nearestSame) {
    reason = `correct pad (${pad}) but Δ${nearestSame.delta.toFixed(0)}ms is outside the ±${windows.good}ms window`;
  } else if (nearestAny && Math.abs(nearestAny.delta) <= windows.good) {
    reason = `wrong pad: you hit ${pad} but the nearest note (Δ${nearestAny.delta.toFixed(0)}ms) is ${describeLane(nearestAny.note.lane, nearestAny.note.isCymbal)}`;
  } else if (nearestAny) {
    reason = `no expected note near this time (nearest is ${describeLane(nearestAny.note.lane, nearestAny.note.isCymbal)} at Δ${nearestAny.delta.toFixed(0)}ms)`;
  } else {
    reason = `no expected notes in this fill`;
  }

  return {
    hit,
    reason,
    nearestSameClassDeltaMs: nearestSame ? nearestSame.delta : null,
    nearestAny: nearestAny
      ? {
          lane: nearestAny.note.lane,
          isCymbal: nearestAny.note.isCymbal,
          deltaMs: nearestAny.delta,
        }
      : null,
  };
}

/** Build the full debug record for a scored attempt. */
export function buildAttemptDebug(params: {
  attempt: number;
  calibrationOffsetMs: number;
  tempoPct: number;
  notes: ExpectedNote[];
  hits: DebugHit[];
  match: MatchResult;
  score: number;
  windows?: TimingWindows;
}): AttemptDebug {
  const windows = params.windows ?? DEFAULT_WINDOWS;
  return {
    attempt: params.attempt,
    calibrationOffsetMs: params.calibrationOffsetMs,
    tempoPct: params.tempoPct,
    counts: params.match.counts,
    score: params.score,
    expected: params.notes.map(n => ({
      id: String(n.id),
      lane: n.lane,
      isCymbal: n.isCymbal,
      msTime: n.msTime,
    })),
    notes: params.match.judgments.map(j => ({
      id: String(j.note.id),
      lane: j.note.lane,
      isCymbal: j.note.isCymbal,
      noteMs: j.note.msTime,
      judgment: j.judgment,
      deltaMs: j.deltaMs,
    })),
    hits: params.hits,
    extras: params.match.extras.map(e => {
      const dh =
        params.hits.find(
          h =>
            h.lane === e.hit.lane &&
            h.isCymbal === e.hit.isCymbal &&
            h.loopRelMs === e.hit.msTime,
        ) ??
        ({
          noteNumber: -1,
          velocity: 0,
          lane: e.hit.lane,
          isCymbal: e.hit.isCymbal,
          loopRelMs: e.hit.msTime,
        } satisfies DebugHit);
      return diagnoseExtra(dh, params.notes, windows);
    }),
  };
}

/**
 * Append an attempt record to the persistent `window` buffer (newest last,
 * capped at {@link LOG_LIMIT}) and emit a one-line console summary. No-op
 * outside the browser.
 */
export function recordAttemptDebug(entry: AttemptDebug): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, AttemptDebug[] | undefined>;
  const buf = (w[SCORING_LOG_KEY] ??= []);
  buf.push(entry);
  if (buf.length > LOG_LIMIT) buf.splice(0, buf.length - LOG_LIMIT);

  const {perfect, good, miss, extra} = entry.counts;
  console.debug(
    `[scoring] attempt ${entry.attempt}: score ${entry.score} · P${perfect} G${good} M${miss} X${extra} · ${entry.tempoPct}% · cal ${entry.calibrationOffsetMs}ms`,
    entry,
  );
}
