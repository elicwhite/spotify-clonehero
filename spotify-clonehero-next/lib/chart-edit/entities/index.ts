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
 * star-power / etc., which vocal `partName` for lyrics + phrases). When a
 * caller omits the context the handlers default to expert drums + the
 * `'vocals'` part — the same hardcoded behavior the editor used before
 * phase 1. Phase 2 (lyrics part-aware) and phase 8 (full adapter
 * rewrite) will tighten this further.
 */

import type {ChartDocument, DrumNoteType, ParsedTrackData} from '../types';
import {findTrackOnly, type TrackKey} from '../find-track';
import {addDrumNote, removeDrumNote, getDrumNotes} from '../helpers/drum-notes';
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

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EntityKind =
  | 'note'
  | 'section'
  | 'lyric'
  | 'phrase-start'
  | 'phrase-end';

export interface EntityRef {
  kind: EntityKind;
  /** Stable id within `kind`. Format is kind-specific but opaque to consumers. */
  id: string;
}

/**
 * Active scope hints for kinds that need to know "which slice of the
 * chart" they're operating on. Sections + tempos + time signatures are
 * chart-wide and ignore the context.
 */
export interface EntityContext {
  /**
   * Track to scope notes / star-power / solo / activation / flex against.
   * Defaults to expert drums when omitted.
   */
  trackKey?: TrackKey;
  /**
   * Vocal part to scope lyrics + phrase markers against. Defaults to
   * `'vocals'` when omitted (phase 2 will lift this through the helpers).
   */
  partName?: string;
}

const DEFAULT_DRUMS_KEY: TrackKey = {
  instrument: 'drums',
  difficulty: 'expert',
};

function resolveTrack(
  doc: ChartDocument,
  ctx?: EntityContext,
): ParsedTrackData | null {
  return findTrackOnly(doc, ctx?.trackKey ?? DEFAULT_DRUMS_KEY);
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
// ---------------------------------------------------------------------------

const LANE_ORDER: DrumNoteType[] = [
  'kick',
  'redDrum',
  'yellowDrum',
  'blueDrum',
  'greenDrum',
];

export function noteId(note: {tick: number; type: DrumNoteType}): string {
  return `${note.tick}:${note.type}`;
}

function parseNoteId(id: string): {tick: number; type: DrumNoteType} | null {
  const colon = id.indexOf(':');
  if (colon === -1) return null;
  const tick = Number.parseInt(id.slice(0, colon), 10);
  const type = id.slice(colon + 1) as DrumNoteType;
  if (!Number.isFinite(tick)) return null;
  if (!LANE_ORDER.includes(type) && type !== 'fiveGreenDrum') return null;
  return {tick, type};
}

function typeToLane(type: DrumNoteType): number {
  return LANE_ORDER.indexOf(type);
}

function laneToType(lane: number): DrumNoteType {
  return LANE_ORDER[Math.max(0, Math.min(LANE_ORDER.length - 1, lane))];
}

function shiftLane(type: DrumNoteType, delta: number): DrumNoteType {
  const currentLane = typeToLane(type);
  if (currentLane === -1) return type;
  return laneToType(currentLane + delta);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const noteHandler: EntityKindHandler = {
  listIds(doc, ctx) {
    const track = resolveTrack(doc, ctx);
    if (!track) return [];
    return getDrumNotes(track).map(noteId);
  },
  locate(doc, id, ctx) {
    const parsed = parseNoteId(id);
    if (!parsed) return null;
    const track = resolveTrack(doc, ctx);
    if (!track) return null;
    const found = getDrumNotes(track).find(
      n => n.tick === parsed.tick && n.type === parsed.type,
    );
    if (!found) return null;
    return {tick: found.tick, lane: typeToLane(found.type)};
  },
  move(doc, id, tickDelta, laneDelta, ctx) {
    const parsed = parseNoteId(id);
    if (!parsed) return id;
    const track = resolveTrack(doc, ctx);
    if (!track) return id;

    const note = getDrumNotes(track).find(
      n => n.tick === parsed.tick && n.type === parsed.type,
    );
    if (!note) return id;

    const newType = shiftLane(note.type, laneDelta);
    const newTick = Math.max(0, note.tick + tickDelta);
    if (newTick === note.tick && newType === note.type) return id;

    removeDrumNote(track, note.tick, note.type);
    addDrumNote(track, {
      tick: newTick,
      type: newType,
      length: note.length,
      flags: {...note.flags},
    });
    return noteId({tick: newTick, type: newType});
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
 */
export function cloneDocFor(
  kind: EntityKind,
  doc: ChartDocument,
): ChartDocument {
  switch (kind) {
    case 'note':
      return {
        ...doc,
        parsedChart: {
          ...doc.parsedChart,
          trackData: doc.parsedChart.trackData.map(t => ({
            ...t,
            noteEventGroups: t.noteEventGroups.map(g => g.map(n => ({...n}))),
          })),
        },
      };
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
