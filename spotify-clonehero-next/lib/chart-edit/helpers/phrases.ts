/**
 * Vocal phrase marker helpers.
 *
 * Phrases bracket lyric runs in `vocalTracks.parts.vocals.notePhrases`. The
 * highway renders each phrase as two text-event markers (`phrase-start` at
 * `phrase.tick`, `phrase-end` at `phrase.tick + phrase.length`).
 *
 * `movePhraseStart` repositions the start without touching the end (length
 * shrinks/grows). `movePhraseEnd` repositions the end without touching the
 * start. Both clamp against neighboring phrases so they never invert or
 * cross. All mutations are in-place.
 */

import type {ChartDocument, NormalizedVocalPart} from '../types';

const VOCALS_PART = 'vocals';

/** Minimum length (in ticks) a phrase can be reduced to via drag. */
const MIN_PHRASE_LENGTH = 1;

export function phraseStartId(tick: number): string {
  return String(tick);
}

export function phraseEndId(endTick: number): string {
  return String(endTick);
}

function getVocalsPart(doc: ChartDocument): NormalizedVocalPart | null {
  return doc.parsedChart.vocalTracks?.parts?.[VOCALS_PART] ?? null;
}

/** All phrase start ticks. */
export function listPhraseStartTicks(doc: ChartDocument): number[] {
  const part = getVocalsPart(doc);
  if (!part) return [];
  return part.notePhrases.map(p => p.tick);
}

/** All phrase end ticks (`phrase.tick + phrase.length`). */
export function listPhraseEndTicks(doc: ChartDocument): number[] {
  const part = getVocalsPart(doc);
  if (!part) return [];
  return part.notePhrases.map(p => p.tick + p.length);
}

/**
 * Move a phrase's start tick. End tick is preserved (length adjusts).
 *
 * Clamps to (prev phrase end, currentEnd - MIN_PHRASE_LENGTH]. Returns the
 * resulting start tick (equals `oldStartTick` if the phrase isn't found or
 * the move is fully clamped).
 */
export function movePhraseStart(
  doc: ChartDocument,
  oldStartTick: number,
  newStartTick: number,
): number {
  const part = getVocalsPart(doc);
  if (!part) return oldStartTick;

  const phrases = part.notePhrases;
  const idx = phrases.findIndex(p => p.tick === oldStartTick);
  if (idx === -1) return oldStartTick;

  const phrase = phrases[idx];
  const endTick = phrase.tick + phrase.length;
  const prev = phrases[idx - 1];
  const lowerBound = prev ? prev.tick + prev.length : 0;
  const upperBound = endTick - MIN_PHRASE_LENGTH;
  const clamped = Math.max(lowerBound, Math.min(upperBound, newStartTick));
  if (clamped === oldStartTick) return oldStartTick;

  phrase.tick = clamped;
  phrase.length = endTick - clamped;
  phrases.sort((a, b) => a.tick - b.tick);
  return clamped;
}

/**
 * Move a phrase's end tick. Start tick is preserved (length adjusts).
 *
 * Clamps to [start + MIN_PHRASE_LENGTH, next phrase start). Returns the
 * resulting end tick (equals `oldEndTick` if the phrase isn't found or the
 * move is fully clamped).
 */
export function movePhraseEnd(
  doc: ChartDocument,
  oldEndTick: number,
  newEndTick: number,
): number {
  const part = getVocalsPart(doc);
  if (!part) return oldEndTick;

  const phrases = part.notePhrases;
  const idx = phrases.findIndex(p => p.tick + p.length === oldEndTick);
  if (idx === -1) return oldEndTick;

  const phrase = phrases[idx];
  const next = phrases[idx + 1];
  const lowerBound = phrase.tick + MIN_PHRASE_LENGTH;
  const upperBound = next ? next.tick : Number.POSITIVE_INFINITY;
  const clamped = Math.max(lowerBound, Math.min(upperBound, newEndTick));
  if (clamped === oldEndTick) return oldEndTick;

  phrase.length = clamped - phrase.tick;
  return clamped;
}
