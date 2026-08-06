/**
 * Lyrics-row scene derivation for the piano-roll timeline (plan 0063 Part D).
 *
 * Builds syllable chips + phrase bands from the SAME `chartDoc.parsedChart.
 * vocalTracks` data the highway's karaoke overlay reads (`useHighwaySync`),
 * so the two views never disagree about lyric content or timing. Pure: no
 * React, no canvas.
 *
 * Scoped to a single vocal part (`'vocals'` by default) — the piano roll's
 * lyrics row only surfaces the primary part the Add Lyrics dialog writes
 * (plan 0063 Part C); harmony parts stay highway/inspector-only.
 */

import {tickToMs} from '@/lib/drum-transcription/timing';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import {lyricId, DEFAULT_VOCALS_PART} from '@/lib/chart-edit';
import type {NormalizedVocalTrack} from '@/lib/chart-edit';
import {msToX, type PianoRollView} from './viewMath';

/** One syllable, positioned in real time, with its owning phrase's tick
 *  bounds (the clamp range a drag must respect — mirrors `moveLyric`). */
export interface LyricChip {
  /** Shared selection/entity id (`lyricId`) — matches `state.selection`. */
  id: string;
  tick: number;
  ms: number;
  text: string;
  phraseMinTick: number;
  phraseMaxTick: number;
}

/** A vocal phrase's span, for the row's background band. `tick`/`tickEnd`
 *  are the phrase's own start/end ticks (`phrase.tick` /
 *  `phrase.tick + phrase.length`) — the same values `phraseStartId`/
 *  `phraseEndId` key off of, so a band-edge drag can identify its entity
 *  without re-deriving it from `ms`. */
export interface LyricBand {
  tick: number;
  tickEnd: number;
  ms: number;
  msEnd: number;
}

export interface LyricsRowScene {
  chips: LyricChip[];
  bands: LyricBand[];
}

/**
 * Strip Clone Hero/Rock Band lyric markup (see `lib/karaoke/parse-lyrics.ts`
 * for the full symbol legend) down to a chip's display text: drops control
 * events (`[...]`, `+`), the leading harmony-hidden `$`, and trailing flag
 * characters, and turns the `§`/`_` space-escapes into a literal space.
 * Returns `''` for a lyric event that carries no visible text (e.g. a bare
 * pitch-slide `+` marker) — the caller skips chips with empty text.
 */
export function cleanLyricChipText(raw: string): string {
  if (raw.startsWith('[') || raw === '+') return '';
  let t = raw;
  if (t.startsWith('$')) t = t.slice(1);
  while (t.length > 0 && '-=#^*%/+'.includes(t[t.length - 1])) {
    t = t.slice(0, -1);
  }
  return t.split('§').join(' ').split('_').join(' ');
}

/**
 * Build the lyrics row's chips + phrase bands for `partName` (default
 * `'vocals'`). Phrase bands include empty phrases so a newly added phrase
 * remains visible and its edges can be dragged before the first lyric is
 * added. The result is empty when the part has no phrases.
 */
export function buildLyricsRowScene(
  vocalTracks: NormalizedVocalTrack | undefined,
  timedTempos: TimedTempo[],
  resolution: number,
  partName: string = DEFAULT_VOCALS_PART,
): LyricsRowScene {
  const part = vocalTracks?.parts?.[partName];
  const chips: LyricChip[] = [];
  const bands: LyricBand[] = [];
  if (!part) return {chips, bands};

  for (const phrase of part.notePhrases) {
    bands.push({
      tick: phrase.tick,
      tickEnd: phrase.tick + phrase.length,
      ms: tickToMs(phrase.tick, timedTempos, resolution),
      msEnd: tickToMs(phrase.tick + phrase.length, timedTempos, resolution),
    });
    for (const lyric of phrase.lyrics) {
      const text = cleanLyricChipText(lyric.text);
      if (!text) continue;
      chips.push({
        id: lyricId(lyric.tick, partName),
        tick: lyric.tick,
        ms: tickToMs(lyric.tick, timedTempos, resolution),
        text,
        phraseMinTick: phrase.tick,
        phraseMaxTick: phrase.tick + phrase.length,
      });
    }
  }
  chips.sort((a, b) => a.tick - b.tick);
  return {chips, bands};
}

/**
 * Start ticks of the phrases whose start AND end edge are both selected —
 * the phrases a drag should translate whole rather than resize.
 *
 * Selecting one edge is a resize gesture; selecting both says "this phrase,
 * all of it", which is what `movePhrases` acts on.
 */
export function fullySelectedPhraseTicks(
  bands: readonly Pick<LyricBand, 'tick' | 'tickEnd'>[],
  selectedStartTicks: ReadonlySet<number>,
  selectedEndTicks: ReadonlySet<number>,
): number[] {
  return bands
    .filter(
      b => selectedStartTicks.has(b.tick) && selectedEndTicks.has(b.tickEnd),
    )
    .map(b => b.tick);
}

/** Half-width of the pennant drawn at the top of a phrase-edge line, in px.
 *  It points INTO the phrase: right for a start, left for an end. */
export const PHRASE_EDGE_FLAG_W = 5;

/** Height of that pennant, in px. */
export const PHRASE_EDGE_FLAG_H = 6;

/** Stroke width of a phrase-edge line, in px. Two pixels so the edges read
 *  as heavier than the one-pixel dashed drag ghosts drawn in the same row. */
export const PHRASE_EDGE_LINE_W = 2;

/** A phrase boundary's on-screen geometry. `x` is already pixel-aligned for
 *  a {@link PHRASE_EDGE_LINE_W}-wide stroke; `flagDirection` is the sign to
 *  multiply {@link PHRASE_EDGE_FLAG_W} by so the pennant points inward. */
export interface PhraseEdgeMarker {
  kind: 'start' | 'end';
  x: number;
  flagDirection: 1 | -1;
  /** The edge's own tick (`band.tick` for a start, `band.tickEnd` for an
   *  end) — the value `phraseStartId`/`phraseEndId` key off, so the draw
   *  layer can tell whether this edge is selected. */
  tick: number;
}

/**
 * Screen positions for every visible phrase boundary in `bands`, in draw
 * order (starts and ends interleaved band by band). Bands whose edges both
 * fall outside the viewport are culled; an edge is kept whenever its line
 * OR its pennant would touch the canvas.
 *
 * `bands` takes the ms values the caller is actually painting, not the
 * scene's resting ones, so an in-flight phrase-edge drag moves its line with
 * the band it is resizing.
 */
export function phraseEdgeMarkers(
  bands: readonly {ms: number; msEnd: number; tick: number; tickEnd: number}[],
  view: PianoRollView,
  width: number,
): PhraseEdgeMarker[] {
  const markers: PhraseEdgeMarker[] = [];
  const margin = PHRASE_EDGE_FLAG_W + PHRASE_EDGE_LINE_W;
  for (const band of bands) {
    const startX = Math.round(msToX(band.ms, view));
    const endX = Math.round(msToX(band.msEnd, view));
    if (startX >= -margin && startX <= width + margin) {
      markers.push({
        kind: 'start',
        x: startX,
        flagDirection: 1,
        tick: band.tick,
      });
    }
    if (endX >= -margin && endX <= width + margin) {
      markers.push({
        kind: 'end',
        x: endX,
        flagDirection: -1,
        tick: band.tickEnd,
      });
    }
  }
  return markers;
}

/** The chip a lyric-anchored drag is grabbing, plus its live (unsnapped)
 *  tick — the same shape `PianoRollTimeline`'s `LyricDrag` carries. */
export interface LyricDragPreview {
  chipId: string;
  originalTick: number;
  currentTick: number;
  /** Start ticks of the phrases travelling whole with the drag; see
   *  `LyricDrag.movingPhraseTicks`. */
  movingPhraseTicks?: ReadonlySet<number>;
}

/** True when `chip` sits in a phrase that `drag` is moving whole, so the
 *  chip rides the raw delta with its phrase instead of being clamped to the
 *  phrase's resting bounds. */
function ridesWithItsPhrase(
  chip: Pick<LyricChip, 'phraseMinTick'>,
  drag: LyricDragPreview | null,
): boolean {
  return drag?.movingPhraseTicks?.has(chip.phraseMinTick) ?? false;
}

/**
 * The tick a chip should render at during a live drag — its own live
 * position if it's the drag's anchor, or the SAME tick delta as the anchor
 * (or a note-anchored drag's `tickDelta`) if it's just riding along as a
 * selected group member, clamped to its own phrase like a solo drag would
 * be. Returns the chip's resting tick when no drag reaches it.
 *
 * One function drives both drag shapes a chip can ride along with:
 *  - A lyric-anchored drag (`drag` non-null): every OTHER selected chip
 *    previews at `drag`'s (originalTick → currentTick) delta.
 *  - A note-anchored drag (`noteDragTickDelta` non-null, `drag` null): every
 *    selected chip previews at that raw tick delta — there's no lyric
 *    anchor of its own, the notes are driving.
 *
 * A chip inside a phrase the drag is moving whole (`movingPhraseTicks`)
 * rides along whether or not it is itself selected, and unclamped: its
 * phrase's bounds are travelling with it.
 *
 * Without this, only the literal chip under the pointer (or none, for a
 * note-anchored drag) would preview moving; the rest of a multi-select
 * would sit still and only snap to their final position once the drag
 * commits.
 */
export function lyricChipPreviewTick(
  chip: Pick<LyricChip, 'id' | 'tick' | 'phraseMinTick' | 'phraseMaxTick'>,
  selected: boolean,
  drag: LyricDragPreview | null,
  noteDragTickDelta: number | null,
): number {
  if (drag && drag.chipId === chip.id) return drag.currentTick;

  const withPhrase = ridesWithItsPhrase(chip, drag);
  const dragActive = drag !== null || noteDragTickDelta !== null;
  if (!dragActive || !(selected || withPhrase)) return chip.tick;

  const delta = drag
    ? drag.currentTick - drag.originalTick
    : (noteDragTickDelta ?? 0);
  // A chip whose whole phrase is moving keeps its place inside the phrase:
  // the bounds travel with it, so clamping to the resting ones would drag
  // it back out of formation.
  if (withPhrase) return chip.tick + delta;
  return Math.max(
    chip.phraseMinTick,
    Math.min(chip.phraseMaxTick, chip.tick + delta),
  );
}
