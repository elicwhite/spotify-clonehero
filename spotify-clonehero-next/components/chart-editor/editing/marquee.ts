/**
 * Shared marquee (box-select) math for the chart editor's interaction layers
 * (plan 0062 "Two views, one store", invariant 3).
 *
 * Given a drag rectangle already converted to (ms × lane) bounds, decide
 * which entity ids fall inside it. Pure functions — no React, no DOM, no
 * renderer access. Both the highway box-select and the piano-roll marquee
 * call `selectNotesInRange`, so a lasso on either surface selects the same
 * notes; `computeMarqueeSelection` adds the piano roll's whole-panel sweep
 * across every band the rectangle covers (notes, lyrics + phrase edges,
 * tempo + time-signature markers, section flags).
 *
 * The screen→world conversion (screenToMs / screenToLane) is the caller's job
 * — each view owns its own coordinate transform. This module takes the
 * already-converted bounds and a flat note list plus the chart's tempo map.
 */

import type {
  DrumNote,
  InstrumentSchema,
  SelectableKind,
} from '@/lib/chart-edit';
import {typeToLane, drums4LaneSchema} from '@/lib/chart-edit';
import {phraseEndId, phraseStartId} from '@/lib/chart-edit/helpers/phrases';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import {noteId} from '../commands';

export interface BoxSelectBounds {
  msMin: number;
  msMax: number;
  laneMin: number;
  laneMax: number;
}

/**
 * Convert a tick to ms using the chart's tempo map. O(log n) is overkill
 * for the small tempo arrays we see in practice — linear walk is the same
 * algorithm scan-chart uses on its own getTimedTempos pipeline.
 */
function tickToMsLinear(
  tick: number,
  timedTempos: TimedTempo[],
  resolution: number,
): number {
  let idx = 0;
  for (let i = 1; i < timedTempos.length; i++) {
    if (timedTempos[i].tick <= tick) idx = i;
    else break;
  }
  const tempo = timedTempos[idx];
  return (
    tempo.msTime +
    ((tick - tempo.tick) * 60000) / (tempo.beatsPerMinute * resolution)
  );
}

/**
 * Return the note ids whose (lane, msTime) fall inside the drag region.
 * Order is unspecified — caller should treat the result as a set.
 *
 * The lane comparison is inclusive on both ends, matching the mouse
 * lasso "if the box brushes the lane, the note is in" feel.
 */
export function selectNotesInRange(
  notes: readonly DrumNote[],
  bounds: BoxSelectBounds,
  timedTempos: TimedTempo[],
  resolution: number,
  schema: InstrumentSchema = drums4LaneSchema,
): Set<string> {
  const selected = new Set<string>();
  for (const note of notes) {
    const lane = typeToLane(schema, note.type);
    if (lane < bounds.laneMin || lane > bounds.laneMax) continue;

    const noteMs = tickToMsLinear(note.tick, timedTempos, resolution);
    if (noteMs >= bounds.msMin && noteMs <= bounds.msMax) {
      selected.add(noteId(note));
    }
  }
  return selected;
}

/**
 * Return the ids of single-row entities whose ms position falls inside
 * `[msMin, msMax]`. The lyrics row, the tempo lane and the ruler are each
 * one row (no lane concept), so membership there is ms-only — the caller
 * decides whether the marquee's vertical span reaches the row at all
 * before calling this.
 */
export function selectEntitiesInMsRange(
  entities: readonly {id: string; ms: number}[],
  msMin: number,
  msMax: number,
): Set<string> {
  const selected = new Set<string>();
  for (const entity of entities) {
    if (entity.ms >= msMin && entity.ms <= msMax) selected.add(entity.id);
  }
  return selected;
}

// ---------------------------------------------------------------------------
// Whole-panel marquee: which bands a rectangle covers, and what it selects
// ---------------------------------------------------------------------------

/**
 * The piano-roll panel's vertical bands in canvas px, top to bottom:
 * ruler (section flags) → lyrics row (chips + phrase edges) → tempo lane
 * (markers + time-signature chips) → note lanes. A band whose top equals
 * its bottom is hidden (the lyrics row on a chart with no vocal phrases)
 * and can never be touched.
 */
export interface PanelBands {
  rulerTop: number;
  rulerBottom: number;
  lyricsTop: number;
  lyricsBottom: number;
  tempoTop: number;
  tempoBottom: number;
  laneTop: number;
  laneBottom: number;
}

/** Which bands a marquee rectangle's vertical span reaches. */
export interface BandsTouched {
  ruler: boolean;
  lyrics: boolean;
  tempo: boolean;
  lanes: boolean;
}

/**
 * Which bands the rectangle `[yMin, yMax]` overlaps. Overlap is on open
 * intervals (`yMin < bottom && yMax > top`), so a drag that stops exactly
 * on a band boundary does not spill into the next band, and a zero-height
 * (purely horizontal) drag still counts as inside whichever band it sits
 * strictly within.
 *
 * This is what makes "drag inside one lane to select only that lane's
 * entities" work without a modifier key: the vertical extent of the
 * gesture is the filter.
 */
export function bandsTouched(
  yMin: number,
  yMax: number,
  bands: PanelBands,
): BandsTouched {
  const touches = (top: number, bottom: number) =>
    bottom > top && yMin < bottom && yMax > top;
  return {
    ruler: touches(bands.rulerTop, bands.rulerBottom),
    lyrics: touches(bands.lyricsTop, bands.lyricsBottom),
    tempo: touches(bands.tempoTop, bands.tempoBottom),
    lanes: touches(bands.laneTop, bands.laneBottom),
  };
}

/**
 * Every kind the panel marquee can put into the selection, which has to be
 * every `SelectableKind`: a plain (unshifted) drag clears the whole record
 * `emptyMarqueeSelection()` builds, so a kind missing from this list would
 * silently survive a drag that is meant to replace the selection. The
 * `satisfies` clause rejects a kind that isn't selectable, and the
 * `NoKindLeftBehind` line below rejects a selectable kind that isn't listed,
 * so the two can't drift apart.
 */
export const MARQUEE_KINDS = [
  'note',
  'lyric',
  'phrase-start',
  'phrase-end',
  'tempo',
  'timesig',
  'section',
] as const satisfies readonly SelectableKind[];

export type MarqueeKind = (typeof MARQUEE_KINDS)[number];

/** Instantiates only while no `SelectableKind` is missing from
 *  `MARQUEE_KINDS`; a missing kind makes the argument non-`never` and the
 *  alias fails to compile. */
type NoKindLeftBehind<Missing extends never> = Missing;
type _EverySelectableKindIsAMarqueeKind = NoKindLeftBehind<
  Exclude<SelectableKind, MarqueeKind>
>;

/** Per-kind id sets a marquee sweep produced. Every kind is always present;
 *  a kind the rectangle missed maps to an empty set, so a caller can push
 *  the whole record to the store and have misses clear their kind. */
export type MarqueeSelection = Record<MarqueeKind, Set<string>>;

/** A single-row entity the marquee can pick up, keyed by tick. */
interface TickedMsEntity {
  tick: number;
  ms: number;
}

export interface MarqueeSources {
  /** Notes of the row the marquee is scoped to, already flattened. */
  notes: readonly DrumNote[];
  schema: InstrumentSchema;
  timedTempos: TimedTempo[];
  resolution: number;
  lyricChips: readonly {id: string; ms: number}[];
  /** Vocal phrase spans; each contributes a start edge and an end edge. */
  phraseBands: readonly {
    tick: number;
    ms: number;
    tickEnd: number;
    msEnd: number;
  }[];
  /** Vocal part the lyric/phrase ids are scoped to. */
  partName: string;
  tempoMarkers: readonly TickedMsEntity[];
  timeSignatures: readonly TickedMsEntity[];
  sections: readonly TickedMsEntity[];
}

export interface MarqueeSelectionInput {
  /** Screen→world converted bounds (see `marqueeBounds`). */
  bounds: BoxSelectBounds;
  /** Which panel bands the rectangle reached. */
  touched: BandsTouched;
  /** Kinds the active page allows into the selection
   *  (`EditorCapabilities.selectable`). */
  allowed: ReadonlySet<string>;
  sources: MarqueeSources;
}

/** A selection record with every marquee kind present and empty. Also the
 *  "nothing selected" payload a plain (unshifted) drag starts from. */
export function emptyMarqueeSelection(): MarqueeSelection {
  return {
    note: new Set(),
    lyric: new Set(),
    'phrase-start': new Set(),
    'phrase-end': new Set(),
    tempo: new Set(),
    timesig: new Set(),
    section: new Set(),
  };
}

/**
 * The whole-panel marquee: every selectable entity whose region intersects
 * the rectangle, across every band the rectangle covers.
 *
 * Tick 0 is never selectable for tempo markers or time signatures — marker
 * 0 is the immovable song-start anchor and the tick-0 signature is the
 * chart's initial meter. Both exclusions live here so there is one
 * definition of "which markers can be acted on", matching `hitTsChip` /
 * `hitTempoMarker`'s own tick-0 handling.
 */
export function computeMarqueeSelection(
  input: MarqueeSelectionInput,
): MarqueeSelection {
  const {bounds, touched, allowed, sources} = input;
  const out = emptyMarqueeSelection();
  const {msMin, msMax} = bounds;

  if (touched.lanes && allowed.has('note')) {
    out.note = selectNotesInRange(
      sources.notes,
      bounds,
      sources.timedTempos,
      sources.resolution,
      sources.schema,
    );
  }

  if (touched.lyrics) {
    if (allowed.has('lyric')) {
      out.lyric = selectEntitiesInMsRange(sources.lyricChips, msMin, msMax);
    }
    if (allowed.has('phrase-start')) {
      out['phrase-start'] = selectEntitiesInMsRange(
        sources.phraseBands.map(b => ({
          id: phraseStartId(b.tick, sources.partName),
          ms: b.ms,
        })),
        msMin,
        msMax,
      );
    }
    if (allowed.has('phrase-end')) {
      out['phrase-end'] = selectEntitiesInMsRange(
        sources.phraseBands.map(b => ({
          id: phraseEndId(b.tickEnd, sources.partName),
          ms: b.msEnd,
        })),
        msMin,
        msMax,
      );
    }
  }

  if (touched.tempo) {
    if (allowed.has('tempo')) {
      out.tempo = selectEntitiesInMsRange(
        sources.tempoMarkers
          .filter(m => m.tick !== 0)
          .map(m => ({id: String(m.tick), ms: m.ms})),
        msMin,
        msMax,
      );
    }
    if (allowed.has('timesig')) {
      out.timesig = selectEntitiesInMsRange(
        sources.timeSignatures
          .filter(ts => ts.tick !== 0)
          .map(ts => ({id: String(ts.tick), ms: ts.ms})),
        msMin,
        msMax,
      );
    }
  }

  if (touched.ruler && allowed.has('section')) {
    out.section = selectEntitiesInMsRange(
      sources.sections.map(s => ({id: String(s.tick), ms: s.ms})),
      msMin,
      msMax,
    );
  }

  return out;
}
