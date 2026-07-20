/**
 * Per-entity-kind dispatch for the chart editor.
 *
 * The editor (and its commands) operate on five kinds of timed entities:
 * notes, named sections, lyrics, phrase-start markers, phrase-end markers.
 * Each kind has its own storage location in `ChartDocument` and its own
 * "move" semantics. This module exposes a uniform handler shape so the
 * editor can drive all five kinds through one code path (selection, drag,
 * `MoveEntitiesCommand`).
 *
 * All handlers operate in-place on the supplied `ChartDocument`. Callers
 * must clone first; `cloneDocFor(kind, doc)` here returns a doc cloned
 * exactly enough for the targeted entity kind.
 *
 * **EntityContext.** Each handler method takes an optional context object
 * carrying the active editing scope (which `TrackKey` for notes /
 * star-power / etc., which vocal `partName` for lyrics + phrases).
 * Note-targeting handlers require a `trackKey`; vocal handlers default to
 * the `'vocals'` part when `partName` is omitted; chart-wide handlers
 * (sections, tempos, time signatures) ignore the context entirely.
 */

import type {NoteType} from '@eliwhite/scan-chart';
import type {ChartDocument, ParsedTrackData} from '../types';
import {
  findTrackInParsedChart,
  findTrackOnly,
  type TrackKey,
} from '../find-track';
import {addSection, removeSection} from '../helpers/sections';
import {
  DEFAULT_VOCALS_PART,
  lyricId,
  listLyricTicks,
  moveLyric,
  parseLyricId,
} from '../helpers/lyrics';
import {
  listPhraseEndTicks,
  listPhraseStartTicks,
  movePhraseEnd,
  movePhraseStart,
  parsePhraseId,
  phraseEndId,
  phraseStartId,
} from '../helpers/phrases';
import {drums4LaneSchema} from '../instruments/drums';
import {schemaForTrack, type InstrumentSchema} from '../instruments';
import {
  schemaNoteId,
  parseSchemaNoteId,
  typeToLane as schemaTypeToLane,
  moveNote,
  listNotes,
} from './notes';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EntityKind =
  | 'note'
  | 'section'
  | 'lyric'
  | 'phrase-start'
  | 'phrase-end';

/**
 * Kind space for `EditCommand` capability gating (plan 0037 Task 3). A
 * superset of `EntityKind`: `'tempo'`/`'timesig'` are edited only through
 * dedicated commands (`MoveTempoMarkerCommand`, `AddTimeSignatureCommand`,
 * the downbeat commands, …), never through the per-kind
 * `EntityKindHandler` surface (`entityHandlers`, selection, hover, drag) —
 * so they aren't `EntityKind`s, but dispatch gating still needs to key on
 * them. A command declares the kind(s) it *intends* to edit here, which is
 * not always the kind(s) it happens to touch: a tempo-marker move that
 * KEEP-MS-remaps every note's tick declares `'tempo'`, not `'note'`, since
 * the note ticks are a side effect of the tempo edit, not the edit itself.
 */
export type CommandEntityKind = EntityKind | 'tempo' | 'timesig';

/** Operation class an `EditCommand` performs, for capability gating. */
export type CommandOperation = 'add' | 'delete' | 'update' | 'move';

/**
 * Active scope hints for kinds that need to know "which slice of the
 * chart" they're operating on. Sections + tempos + time signatures are
 * chart-wide and ignore the context.
 */
export interface EntityContext {
  /**
   * Track to scope notes / star-power / solo / activation / flex against.
   * Required when invoking note-targeting handlers; chart-wide kinds
   * (sections, tempos, time signatures) ignore it.
   */
  trackKey?: TrackKey;
  /**
   * Vocal part to scope lyrics + phrase markers against. Defaults to
   * `'vocals'` when omitted.
   */
  partName?: string;
}

/**
 * Structured reference to a single selectable entity (plan 0037 Task 6).
 * `key` is the same opaque per-kind id `entityHandlers`/selection stores
 * always used (format is kind-specific, e.g. `"${tick}:${noteTypeName}"`
 * for notes); `scope` records which track/vocal-part it was resolved
 * against, since notes' and star-power's `key` alone doesn't encode that —
 * two different tracks can both have a note keyed `"480:redDrum"`. Selection
 * ids in `ChartEditorState.selection` stay plain opaque strings (untyped
 * `key`s); `EntityRef` is how the MCP surface and cross-scope operations
 * (clipboard paste) pair a `key` with the scope it's valid in.
 */
export interface EntityRef {
  kind: EntityKind;
  scope: EntityContext;
  key: string;
}

function resolveTrack(
  doc: ChartDocument,
  ctx?: EntityContext,
): ParsedTrackData | null {
  if (!ctx?.trackKey) return null;
  return findTrackOnly(doc, ctx.trackKey);
}

/**
 * Resolve both the target track and its `InstrumentSchema` for note
 * handlers. Schema is chosen from the track's instrument (honoring
 * `doc.parsedChart.drumType` for drum tracks) rather than a fixed schema —
 * see `schemaForTrack`. Returns null for either when `ctx.trackKey` is
 * missing or the track can't be found, matching the existing null-track
 * no-op behavior.
 */
function resolveTrackAndSchema(
  doc: ChartDocument,
  ctx?: EntityContext,
): {track: ParsedTrackData | null; schema: InstrumentSchema} {
  const track = resolveTrack(doc, ctx);
  const schema = track
    ? (schemaForTrack(track, doc.parsedChart.drumType) ?? drums4LaneSchema)
    : drums4LaneSchema;
  return {track, schema};
}

function resolvePartName(ctx?: EntityContext): string {
  return ctx?.partName ?? DEFAULT_VOCALS_PART;
}

export interface EntityKindHandler {
  /** All entity ids of this kind currently in `doc`. */
  listIds(doc: ChartDocument, ctx?: EntityContext): string[];
  /**
   * Resolve an id to its absolute tick (and lane index for kinds that have
   * one). Returns null when the id no longer exists in `doc`.
   */
  locate(
    doc: ChartDocument,
    id: string,
    ctx?: EntityContext,
  ): {tick: number; lane?: number} | null;
  /**
   * Apply a move in-place. `tickDelta` always applies; `laneDelta` only
   * applies when `supportsLaneDelta` is true. Returns the entity's new id
   * (which equals the input id when the move is a no-op or rejected).
   */
  move(
    doc: ChartDocument,
    id: string,
    tickDelta: number,
    laneDelta: number,
    ctx?: EntityContext,
  ): string;
  /** True if the kind responds to lane-delta input (notes only today). */
  supportsLaneDelta: boolean;
}

// ---------------------------------------------------------------------------
// Note ID helpers (re-exported for the command layer)
//
// The lane/flag math is generic (`./notes.ts`, plan 0037 Task 4); the
// schema itself is resolved per-call from `ctx.trackKey` + `drumType` via
// `resolveTrackAndSchema` (plan 0067), so `noteHandler` works for any
// instrument's track, not just 4-lane drums. When `ctx.trackKey` is
// missing (or doesn't resolve), the handlers fall back to
// `drums4LaneSchema` purely to have a non-null schema to parse ids
// against — the missing/unresolved track still makes every method a
// no-op, so the fallback schema choice has no observable effect.
// ---------------------------------------------------------------------------

export function noteId(note: {tick: number; type: NoteType}): string {
  return schemaNoteId(note.tick, note.type);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const noteHandler: EntityKindHandler = {
  listIds(doc, ctx) {
    const {track, schema} = resolveTrackAndSchema(doc, ctx);
    if (!track) return [];
    return listNotes(track, schema).map(n => schemaNoteId(n.tick, n.type));
  },
  locate(doc, id, ctx) {
    const {track, schema} = resolveTrackAndSchema(doc, ctx);
    const parsed = parseSchemaNoteId(id, schema);
    if (!parsed) return null;
    if (!track) return null;
    const found = listNotes(track, schema).find(
      n => n.tick === parsed.tick && n.type === parsed.type,
    );
    if (!found) return null;
    return {
      tick: found.tick,
      lane: schemaTypeToLane(schema, found.type),
    };
  },
  move(doc, id, tickDelta, laneDelta, ctx) {
    const {track, schema} = resolveTrackAndSchema(doc, ctx);
    const parsed = parseSchemaNoteId(id, schema);
    if (!parsed) return id;
    if (!track) return id;

    const moved = moveNote(
      doc.parsedChart,
      track,
      parsed.tick,
      parsed.type,
      tickDelta,
      laneDelta,
      schema,
    );
    return moved ? schemaNoteId(moved.tick, moved.type) : id;
  },
  supportsLaneDelta: true,
};

const sectionHandler: EntityKindHandler = {
  listIds(doc) {
    return doc.parsedChart.sections.map(s => String(s.tick));
  },
  locate(doc, id) {
    const tick = Number.parseInt(id, 10);
    if (!Number.isFinite(tick)) return null;
    const section = doc.parsedChart.sections.find(s => s.tick === tick);
    return section ? {tick: section.tick} : null;
  },
  move(doc, id, tickDelta) {
    const tick = Number.parseInt(id, 10);
    if (!Number.isFinite(tick)) return id;
    const section = doc.parsedChart.sections.find(s => s.tick === tick);
    if (!section) return id;
    const newTick = Math.max(0, tick + tickDelta);
    if (newTick === tick) return id;
    const name = section.name;
    removeSection(doc, tick);
    addSection(doc, newTick, name);
    return String(newTick);
  },
  supportsLaneDelta: false,
};

const lyricHandler: EntityKindHandler = {
  listIds(doc, ctx) {
    const partName = resolvePartName(ctx);
    return listLyricTicks(doc, partName).map(tick => lyricId(tick, partName));
  },
  locate(doc, id, ctx) {
    const parsed = parseLyricId(id);
    if (!parsed) return null;
    const partName = resolvePartName(ctx);
    if (parsed.partName !== partName) return null;
    return listLyricTicks(doc, partName).includes(parsed.tick)
      ? {tick: parsed.tick}
      : null;
  },
  move(doc, id, tickDelta, _laneDelta, ctx) {
    const parsed = parseLyricId(id);
    if (!parsed) return id;
    const partName = resolvePartName(ctx);
    if (parsed.partName !== partName) return id;
    const newTick = moveLyric(
      doc,
      parsed.tick,
      Math.max(0, parsed.tick + tickDelta),
      partName,
    );
    return lyricId(newTick, partName);
  },
  supportsLaneDelta: false,
};

const phraseStartHandler: EntityKindHandler = {
  listIds(doc, ctx) {
    const partName = resolvePartName(ctx);
    return listPhraseStartTicks(doc, partName).map(tick =>
      phraseStartId(tick, partName),
    );
  },
  locate(doc, id, ctx) {
    const parsed = parsePhraseId(id);
    if (!parsed) return null;
    const partName = resolvePartName(ctx);
    if (parsed.partName !== partName) return null;
    return listPhraseStartTicks(doc, partName).includes(parsed.tick)
      ? {tick: parsed.tick}
      : null;
  },
  move(doc, id, tickDelta, _laneDelta, ctx) {
    const parsed = parsePhraseId(id);
    if (!parsed) return id;
    const partName = resolvePartName(ctx);
    if (parsed.partName !== partName) return id;
    const newTick = movePhraseStart(
      doc,
      parsed.tick,
      Math.max(0, parsed.tick + tickDelta),
      partName,
    );
    return phraseStartId(newTick, partName);
  },
  supportsLaneDelta: false,
};

const phraseEndHandler: EntityKindHandler = {
  listIds(doc, ctx) {
    const partName = resolvePartName(ctx);
    return listPhraseEndTicks(doc, partName).map(tick =>
      phraseEndId(tick, partName),
    );
  },
  locate(doc, id, ctx) {
    const parsed = parsePhraseId(id);
    if (!parsed) return null;
    const partName = resolvePartName(ctx);
    if (parsed.partName !== partName) return null;
    return listPhraseEndTicks(doc, partName).includes(parsed.tick)
      ? {tick: parsed.tick}
      : null;
  },
  move(doc, id, tickDelta, _laneDelta, ctx) {
    const parsed = parsePhraseId(id);
    if (!parsed) return id;
    const partName = resolvePartName(ctx);
    if (parsed.partName !== partName) return id;
    const newTick = movePhraseEnd(
      doc,
      parsed.tick,
      Math.max(0, parsed.tick + tickDelta),
      partName,
    );
    return phraseEndId(newTick, partName);
  },
  supportsLaneDelta: false,
};

export const entityHandlers: Record<EntityKind, EntityKindHandler> = {
  note: noteHandler,
  section: sectionHandler,
  lyric: lyricHandler,
  'phrase-start': phraseStartHandler,
  'phrase-end': phraseEndHandler,
};

// ---------------------------------------------------------------------------
// Doc cloning per kind
// ---------------------------------------------------------------------------

/**
 * Clone `doc` deeply enough for a mutation of the given `kind`. Returns a
 * new document; the input is not mutated.
 *
 * Different kinds touch different fields of `parsedChart`; each branch
 * clones only what its handler will mutate. Anything not listed is shared
 * by reference with the input doc.
 *
 * For `'note'`, cloning is scoped to `ctx.trackKey`'s track — the other
 * tracks' `noteEventGroups` are shared by reference — so per-edit cost is
 * O(one track), not O(all tracks × difficulties). Falls back to cloning
 * every track when no `trackKey` is given (defensive; note handlers require
 * one to do anything, so callers always pass it).
 */
export function cloneDocFor(
  kind: EntityKind,
  doc: ChartDocument,
  ctx?: EntityContext,
): ChartDocument {
  switch (kind) {
    case 'note': {
      const targetIndex = ctx?.trackKey
        ? (findTrackInParsedChart(doc.parsedChart, ctx.trackKey)?.index ?? -1)
        : -1;
      return {
        ...doc,
        parsedChart: {
          ...doc.parsedChart,
          trackData: doc.parsedChart.trackData.map((t, i) => {
            if (targetIndex !== -1 && i !== targetIndex) return t;
            return {
              ...t,
              noteEventGroups: t.noteEventGroups.map(g => g.map(n => ({...n}))),
            };
          }),
        },
      };
    }
    case 'section':
      return {
        ...doc,
        parsedChart: {
          ...doc.parsedChart,
          sections: doc.parsedChart.sections.map(s => ({...s})),
        },
      };
    case 'lyric':
    case 'phrase-start':
    case 'phrase-end':
      return cloneDocWithVocals(doc);
  }
}

function cloneDocWithVocals(doc: ChartDocument): ChartDocument {
  const vt = doc.parsedChart.vocalTracks;
  if (!vt) return doc;
  const parts: Record<string, NonNullable<typeof vt>['parts'][string]> = {};
  for (const [name, part] of Object.entries(vt.parts)) {
    parts[name] = {
      ...part,
      notePhrases: part.notePhrases.map(p => ({
        ...p,
        notes: p.notes.map(n => ({...n})),
        lyrics: p.lyrics.map(l => ({...l})),
      })),
    };
  }
  return {
    ...doc,
    parsedChart: {
      ...doc.parsedChart,
      vocalTracks: {...vt, parts},
    },
  };
}
