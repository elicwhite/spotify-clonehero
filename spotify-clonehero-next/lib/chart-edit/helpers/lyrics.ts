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

import type {ChartDocument, NormalizedVocalPart} from '../types';

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

  // Keep the paired placeholder note in sync if one exists at the old tick.
  const note = phrase.notes.find(n => n.tick === oldTick);
  if (note) note.tick = clampedTick;

  // Sort within phrase so consumers see lyrics in tick order.
  phrase.lyrics.sort((a, b) => a.tick - b.tick);
  phrase.notes.sort((a, b) => a.tick - b.tick);

  return clampedTick;
}
