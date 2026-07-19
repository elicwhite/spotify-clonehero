/**
 * Lyric event helpers.
 *
 * Lyric events live inside a vocal part's `notePhrases[i].lyrics[j]`. Each
 * lyric is paired with a placeholder note in the same phrase at the same
 * tick (added by writers like add-lyrics so scan-chart preserves the lyric
 * on round-trip). All mutations are in-place.
 *
 * Lyrics are uniquely identified within a vocal part by their tick. The
 * `partName` argument selects which vocal part (`vocals`, `harm1`,
 * `harm2`, `harm3`) the helper operates on; defaults to `'vocals'`.
 */

import type {
  ChartDocument,
  NormalizedLyricEvent,
  NormalizedVocalNote,
  NormalizedVocalPart,
  NormalizedVocalPhrase,
} from '../types';
import {applyEventTiming, makeChartTiming} from '../retime';
import {tickToMs} from '@/lib/drum-transcription/timing';

/** Tick-length of a lyric's paired placeholder pitched note (matches the
 *  convention `applyAlignedLyricsToDoc` uses so scan-chart keeps the lyric
 *  on round-trip — see `lib/lyrics-align/apply-lyrics.ts`). Clamped to the
 *  phrase's remaining span when a lyric lands near the phrase's end. */
const PLACEHOLDER_NOTE_LENGTH = 60;

/** Default vocal part — matches the part used by add-lyrics. */
export const DEFAULT_VOCALS_PART = 'vocals';

/**
 * Pack `{partName, tick}` into a stable id used by the editor's entity
 * adapter and reconciler keys. Part defaults to `'vocals'` so charts
 * without harmonies keep ids that look like `vocals:480`.
 */
export function lyricId(
  tick: number,
  partName: string = DEFAULT_VOCALS_PART,
): string {
  return `${partName}:${tick}`;
}

/**
 * Unpack a `lyricId` of the form `{part}:{tick}`. Returns null when the
 * id is malformed.
 */
export function parseLyricId(
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

/** All lyric ticks in the named vocal part, sorted ascending. */
export function listLyricTicks(
  doc: ChartDocument,
  partName: string = DEFAULT_VOCALS_PART,
): number[] {
  const part = getVocalPart(doc, partName);
  if (!part) return [];
  const ticks: number[] = [];
  for (const phrase of part.notePhrases) {
    for (const lyric of phrase.lyrics) ticks.push(lyric.tick);
  }
  return ticks.sort((a, b) => a - b);
}

/** Find the phrase index containing a lyric at `tick`. -1 if none. */
function findPhraseIndexWithLyric(
  part: NormalizedVocalPart,
  tick: number,
): number {
  return part.notePhrases.findIndex(p => p.lyrics.some(l => l.tick === tick));
}

/**
 * Move a lyric from `oldTick` to `newTick` within the same phrase.
 *
 * Clamps `newTick` to the phrase's [tick, tick+length] bounds so a lyric
 * never escapes its phrase. The associated placeholder note (at the same
 * tick inside the same phrase) is moved in lockstep so the chart stays
 * consistent.
 *
 * Returns the resulting tick (which may differ from `newTick` after
 * clamping; equals `oldTick` when the lyric isn't found).
 */
export function moveLyric(
  doc: ChartDocument,
  oldTick: number,
  newTick: number,
  partName: string = DEFAULT_VOCALS_PART,
): number {
  const part = getVocalPart(doc, partName);
  if (!part) return oldTick;

  const phraseIdx = findPhraseIndexWithLyric(part, oldTick);
  if (phraseIdx === -1) return oldTick;

  const phrase = part.notePhrases[phraseIdx];
  const minTick = phrase.tick;
  const maxTick = phrase.tick + phrase.length;
  const clampedTick = Math.max(minTick, Math.min(maxTick, newTick));
  if (clampedTick === oldTick) return oldTick;

  const lyric = phrase.lyrics.find(l => l.tick === oldTick);
  if (!lyric) return oldTick;
  lyric.tick = clampedTick;

  // Recompute derived timing from the tempo map so the moved lyric (and its
  // paired note) carry correct ms without a serialize→reparse round trip
  // (plan 0061 §2). A lyric event has no length, so only its msTime moves.
  const timing = makeChartTiming(doc.parsedChart);
  lyric.msTime = tickToMs(clampedTick, timing.timedTempos, timing.resolution);

  // Keep the paired placeholder note in sync if one exists at the old tick.
  const note = phrase.notes.find(n => n.tick === oldTick);
  if (note) {
    note.tick = clampedTick;
    applyEventTiming(note, timing);
  }

  // Sort within phrase so consumers see lyrics in tick order.
  phrase.lyrics.sort((a, b) => a.tick - b.tick);
  phrase.notes.sort((a, b) => a.tick - b.tick);

  return clampedTick;
}

/**
 * Add a syllable at `tick`, paired with a placeholder pitch-60 note (the
 * same convention `applyAlignedLyricsToDoc` uses) in the phrase that
 * contains `tick`. Returns the new lyric's entity id, or `null` when
 * there's no phrase spanning `tick` or a lyric already exists there.
 */
export function addLyric(
  doc: ChartDocument,
  tick: number,
  text: string,
  partName: string = DEFAULT_VOCALS_PART,
): string | null {
  const part = getVocalPart(doc, partName);
  if (!part) return null;

  const clampedTick = Math.max(0, tick);
  const phrase = part.notePhrases.find(
    p => clampedTick >= p.tick && clampedTick <= p.tick + p.length,
  );
  if (!phrase) return null;
  if (phrase.lyrics.some(l => l.tick === clampedTick)) return null;

  const timing = makeChartTiming(doc.parsedChart);
  const lyric: NormalizedLyricEvent = {
    tick: clampedTick,
    msTime: 0,
    text,
    flags: 0,
  };
  applyEventTiming(lyric, timing);
  phrase.lyrics.push(lyric);
  phrase.lyrics.sort((a, b) => a.tick - b.tick);

  if (!phrase.notes.some(n => n.tick === clampedTick)) {
    const length = Math.max(
      1,
      Math.min(
        PLACEHOLDER_NOTE_LENGTH,
        phrase.tick + phrase.length - clampedTick,
      ),
    );
    const note: NormalizedVocalNote = {
      tick: clampedTick,
      msTime: 0,
      length,
      msLength: 0,
      pitch: 60,
      type: 'pitched',
    };
    applyEventTiming(note, timing);
    phrase.notes.push(note);
    phrase.notes.sort((a, b) => a.tick - b.tick);
  }

  return lyricId(clampedTick, partName);
}

/** A lyric (and its paired note, if any) as removed by {@link deleteLyric},
 *  kept for undo. `phraseSnapshot` carries the whole phrase when deleting
 *  the lyric emptied it (the phrase was removed as a result). */
export interface RemovedLyric {
  lyric: NormalizedLyricEvent;
  note: NormalizedVocalNote | null;
  phraseDeleted: boolean;
  phraseSnapshot: NormalizedVocalPhrase | null;
}

/**
 * Remove the lyric at `tick` (and its paired placeholder note, if any).
 * When this empties the owning phrase, the phrase is removed too — an
 * empty phrase carries no lyric structure and would otherwise linger as an
 * invisible band in the lyrics row. Returns `null` if no lyric exists at
 * `tick`.
 */
export function deleteLyric(
  doc: ChartDocument,
  tick: number,
  partName: string = DEFAULT_VOCALS_PART,
): RemovedLyric | null {
  const part = getVocalPart(doc, partName);
  if (!part) return null;

  const phraseIdx = findPhraseIndexWithLyric(part, tick);
  if (phraseIdx === -1) return null;
  const phrase = part.notePhrases[phraseIdx];

  const lyricIdx = phrase.lyrics.findIndex(l => l.tick === tick);
  if (lyricIdx === -1) return null;

  // This is the phrase's last lyric — snapshot its pre-deletion lyrics/notes
  // now (before splicing), since `phrase` is mutated in place below and the
  // phrase itself is about to be dropped; undo needs to restore it exactly.
  const willEmptyPhrase = phrase.lyrics.length === 1;
  const phraseSnapshot: NormalizedVocalPhrase | null = willEmptyPhrase
    ? {...phrase, lyrics: [...phrase.lyrics], notes: [...phrase.notes]}
    : null;

  const [removedLyric] = phrase.lyrics.splice(lyricIdx, 1);

  const noteIdx = phrase.notes.findIndex(n => n.tick === tick);
  const removedNote =
    noteIdx !== -1 ? phrase.notes.splice(noteIdx, 1)[0] : null;

  if (willEmptyPhrase) {
    part.notePhrases.splice(phraseIdx, 1);
    return {
      lyric: removedLyric,
      note: removedNote,
      phraseDeleted: true,
      phraseSnapshot,
    };
  }

  return {
    lyric: removedLyric,
    note: removedNote,
    phraseDeleted: false,
    phraseSnapshot: null,
  };
}

/**
 * Undo counterpart to {@link deleteLyric}: re-inserts the removed phrase
 * verbatim (when the delete emptied it), or re-inserts the lyric + note
 * into the phrase that would contain `tick`.
 */
export function restoreLyric(
  doc: ChartDocument,
  removed: RemovedLyric,
  tick: number,
  partName: string = DEFAULT_VOCALS_PART,
): void {
  const part = getVocalPart(doc, partName);
  if (!part) return;

  if (removed.phraseDeleted && removed.phraseSnapshot) {
    part.notePhrases.push(removed.phraseSnapshot);
    part.notePhrases.sort((a, b) => a.tick - b.tick);
    return;
  }

  const phrase = part.notePhrases.find(
    p => tick >= p.tick && tick <= p.tick + p.length,
  );
  if (!phrase) return;
  phrase.lyrics.push(removed.lyric);
  phrase.lyrics.sort((a, b) => a.tick - b.tick);
  if (removed.note) {
    phrase.notes.push(removed.note);
    phrase.notes.sort((a, b) => a.tick - b.tick);
  }
}

/**
 * Replace the text of the lyric at `tick`. Returns `false` if no lyric
 * exists there.
 */
export function setLyricText(
  doc: ChartDocument,
  tick: number,
  text: string,
  partName: string = DEFAULT_VOCALS_PART,
): boolean {
  const part = getVocalPart(doc, partName);
  if (!part) return false;

  const phraseIdx = findPhraseIndexWithLyric(part, tick);
  if (phraseIdx === -1) return false;
  const lyric = part.notePhrases[phraseIdx].lyrics.find(l => l.tick === tick);
  if (!lyric) return false;
  lyric.text = text;
  return true;
}
