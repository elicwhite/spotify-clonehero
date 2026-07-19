/**
 * Vocal phrase marker helpers.
 *
 * Phrases bracket lyric runs in `vocalTracks.parts[partName].notePhrases`.
 * The highway renders each phrase as two text-event markers (`phrase-start`
 * at `phrase.tick`, `phrase-end` at `phrase.tick + phrase.length`).
 *
 * `movePhraseStart` repositions the start without touching the end (length
 * shrinks/grows). `movePhraseEnd` repositions the end without touching the
 * start. Both clamp against neighboring phrases so they never invert or
 * cross. All mutations are in-place.
 *
 * The `partName` argument selects which vocal part (`vocals`, `harm1`,
 * `harm2`, `harm3`) the helper operates on; defaults to `'vocals'`.
 */

import type {
  ChartDocument,
  NormalizedVocalPart,
  NormalizedVocalPhrase,
} from '../types';
import {DEFAULT_VOCALS_PART} from './lyrics';
import {applyEventTiming, makeChartTiming} from '../retime';

/** Minimum length (in ticks) a phrase can be reduced to via drag. */
const MIN_PHRASE_LENGTH = 1;

/** Default length (in beats, i.e. `resolution` ticks each) for a phrase
 *  created via "Add phrase here" — roughly one 4/4 bar. Clamped against
 *  neighboring phrases so the new phrase never overlaps them. */
const DEFAULT_PHRASE_LENGTH_BEATS = 4;

/**
 * Pack `{partName, tick}` into a stable id for a phrase-start entity.
 * Defaults to `'vocals'` so charts without harmonies keep ids that look
 * like `vocals:0`.
 */
export function phraseStartId(
  tick: number,
  partName: string = DEFAULT_VOCALS_PART,
): string {
  return `${partName}:${tick}`;
}

/**
 * Pack `{partName, endTick}` into a stable id for a phrase-end entity.
 * The "end tick" is `phrase.tick + phrase.length`.
 */
export function phraseEndId(
  endTick: number,
  partName: string = DEFAULT_VOCALS_PART,
): string {
  return `${partName}:${endTick}`;
}

/**
 * Unpack a phrase-start or phrase-end id of the form `{part}:{tick}`.
 */
export function parsePhraseId(
  id: string,
): {tick: number; partName: string} | null {
  const colon = id.indexOf(':');
  if (colon === -1) return null;
  const partName = id.slice(0, colon);
  const tick = Number.parseInt(id.slice(colon + 1), 10);
  if (!Number.isFinite(tick) || partName.length === 0) return null;
  return {tick, partName};
}

function getVocalPart(
  doc: ChartDocument,
  partName: string,
): NormalizedVocalPart | null {
  return doc.parsedChart.vocalTracks?.parts?.[partName] ?? null;
}

/** All phrase start ticks in the named vocal part. */
export function listPhraseStartTicks(
  doc: ChartDocument,
  partName: string = DEFAULT_VOCALS_PART,
): number[] {
  const part = getVocalPart(doc, partName);
  if (!part) return [];
  return part.notePhrases.map(p => p.tick);
}

/** All phrase end ticks (`phrase.tick + phrase.length`) in the named vocal part. */
export function listPhraseEndTicks(
  doc: ChartDocument,
  partName: string = DEFAULT_VOCALS_PART,
): number[] {
  const part = getVocalPart(doc, partName);
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
  partName: string = DEFAULT_VOCALS_PART,
): number {
  const part = getVocalPart(doc, partName);
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
  applyEventTiming(phrase, makeChartTiming(doc.parsedChart));
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
  partName: string = DEFAULT_VOCALS_PART,
): number {
  const part = getVocalPart(doc, partName);
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
  applyEventTiming(phrase, makeChartTiming(doc.parsedChart));
  return clamped;
}

/**
 * Create a new, empty (no lyrics/notes) phrase near `tick`, clamped so it
 * can't overlap the neighboring phrases. Returns the created phrase's
 * (possibly clamped) start tick, or `null` when `tick` already falls
 * inside an existing phrase, or there isn't at least `MIN_PHRASE_LENGTH`
 * ticks of room between the neighbors surrounding it.
 */
export function addPhrase(
  doc: ChartDocument,
  tick: number,
  partName: string = DEFAULT_VOCALS_PART,
): number | null {
  const part = getVocalPart(doc, partName);
  if (!part) return null;

  const phrases = part.notePhrases;
  const target = Math.max(0, tick);

  let prevEnd = 0;
  let nextStart = Number.POSITIVE_INFINITY;
  for (const p of phrases) {
    const end = p.tick + p.length;
    if (p.tick <= target && target < end) return null; // already inside a phrase
    if (end <= target && end > prevEnd) prevEnd = end;
    if (p.tick >= target && p.tick < nextStart) nextStart = p.tick;
  }
  if (nextStart - prevEnd < MIN_PHRASE_LENGTH) return null;

  const start = Math.max(
    prevEnd,
    Math.min(target, nextStart - MIN_PHRASE_LENGTH),
  );
  const resolution = doc.parsedChart.resolution;
  const desiredLength = resolution * DEFAULT_PHRASE_LENGTH_BEATS;
  const maxLength = Math.max(MIN_PHRASE_LENGTH, nextStart - start);
  const length = Math.max(
    MIN_PHRASE_LENGTH,
    Math.min(desiredLength, maxLength),
  );

  const phrase: NormalizedVocalPhrase = {
    tick: start,
    msTime: 0,
    length,
    msLength: 0,
    isPercussion: false,
    notes: [],
    lyrics: [],
  };
  applyEventTiming(phrase, makeChartTiming(doc.parsedChart));
  phrases.push(phrase);
  phrases.sort((a, b) => a.tick - b.tick);
  return start;
}

/**
 * Remove the phrase starting at `tick` (with its lyrics/notes). Returns
 * the removed phrase (for undo, via {@link insertPhrase}), or `null` if no
 * phrase starts there.
 */
export function deletePhrase(
  doc: ChartDocument,
  tick: number,
  partName: string = DEFAULT_VOCALS_PART,
): NormalizedVocalPhrase | null {
  const part = getVocalPart(doc, partName);
  if (!part) return null;

  const idx = part.notePhrases.findIndex(p => p.tick === tick);
  if (idx === -1) return null;
  const [removed] = part.notePhrases.splice(idx, 1);
  return removed;
}

/** Undo counterpart to {@link deletePhrase} (and undo of {@link addPhrase}'s
 *  redo path): re-inserts `phrase` verbatim, tick-sorted. */
export function insertPhrase(
  doc: ChartDocument,
  phrase: NormalizedVocalPhrase,
  partName: string = DEFAULT_VOCALS_PART,
): void {
  const part = getVocalPart(doc, partName);
  if (!part) return;
  part.notePhrases.push(phrase);
  part.notePhrases.sort((a, b) => a.tick - b.tick);
}
