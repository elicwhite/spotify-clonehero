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
 */

import type {
  ChartDocument,
  DrumNoteType,
  ParsedTrackData,
} from '../types';
import {
  addDrumNote,
  removeDrumNote,
  getDrumNotes,
} from '../helpers/drum-notes';
import {addSection, removeSection} from '../helpers/sections';
import {moveLyric, listLyricTicks} from '../helpers/lyrics';
import {
  movePhraseStart,
  movePhraseEnd,
  listPhraseStartTicks,
  listPhraseEndTicks,
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

export interface EntityKindHandler {
  /** All entity ids of this kind currently in `doc`. */
  listIds(doc: ChartDocument): string[];
  /**
   * Resolve an id to its absolute tick (and lane index for kinds that have
   * one). Returns null when the id no longer exists in `doc`.
   */
  locate(
    doc: ChartDocument,
    id: string,
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

function parseNoteId(
  id: string,
): {tick: number; type: DrumNoteType} | null {
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

function findExpertDrumsTrack(doc: ChartDocument): ParsedTrackData | null {
  const t = doc.parsedChart.trackData.find(
    td => td.instrument === 'drums' && td.difficulty === 'expert',
  );
  return t ?? null;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const noteHandler: EntityKindHandler = {
  listIds(doc) {
    const track = findExpertDrumsTrack(doc);
    if (!track) return [];
    return getDrumNotes(track).map(noteId);
  },
  locate(doc, id) {
    const parsed = parseNoteId(id);
    if (!parsed) return null;
    const track = findExpertDrumsTrack(doc);
    if (!track) return null;
    const found = getDrumNotes(track).find(
      n => n.tick === parsed.tick && n.type === parsed.type,
    );
    if (!found) return null;
    return {tick: found.tick, lane: typeToLane(found.type)};
  },
  move(doc, id, tickDelta, laneDelta) {
    const parsed = parseNoteId(id);
    if (!parsed) return id;
    const track = findExpertDrumsTrack(doc);
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
  listIds(doc) {
    return listLyricTicks(doc).map(String);
  },
  locate(doc, id) {
    const tick = Number.parseInt(id, 10);
    if (!Number.isFinite(tick)) return null;
    return listLyricTicks(doc).includes(tick) ? {tick} : null;
  },
  move(doc, id, tickDelta) {
    const tick = Number.parseInt(id, 10);
    if (!Number.isFinite(tick)) return id;
    const newTick = moveLyric(doc, tick, Math.max(0, tick + tickDelta));
    return String(newTick);
  },
  supportsLaneDelta: false,
};

const phraseStartHandler: EntityKindHandler = {
  listIds(doc) {
    return listPhraseStartTicks(doc).map(String);
  },
  locate(doc, id) {
    const tick = Number.parseInt(id, 10);
    if (!Number.isFinite(tick)) return null;
    return listPhraseStartTicks(doc).includes(tick) ? {tick} : null;
  },
  move(doc, id, tickDelta) {
    const tick = Number.parseInt(id, 10);
    if (!Number.isFinite(tick)) return id;
    const newTick = movePhraseStart(doc, tick, Math.max(0, tick + tickDelta));
    return String(newTick);
  },
  supportsLaneDelta: false,
};

const phraseEndHandler: EntityKindHandler = {
  listIds(doc) {
    return listPhraseEndTicks(doc).map(String);
  },
  locate(doc, id) {
    const tick = Number.parseInt(id, 10);
    if (!Number.isFinite(tick)) return null;
    return listPhraseEndTicks(doc).includes(tick) ? {tick} : null;
  },
  move(doc, id, tickDelta) {
    const tick = Number.parseInt(id, 10);
    if (!Number.isFinite(tick)) return id;
    const newTick = movePhraseEnd(doc, tick, Math.max(0, tick + tickDelta));
    return String(newTick);
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
