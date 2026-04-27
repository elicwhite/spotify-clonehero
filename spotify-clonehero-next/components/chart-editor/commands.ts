/**
 * Command pattern for chart editing.
 *
 * All mutations to the chart go through commands, enabling undo/redo
 * (stack management is in 0007b; infrastructure is here).
 *
 * Commands are immutable -- execute() and undo() return new state rather
 * than mutating in place. This works naturally with React's reducer pattern.
 *
 * Internally we use chart-edit's in-place helpers on shallow-cloned data
 * so that the original document is never mutated.
 */

import type {
  ChartDocument,
  ParsedTrackData,
  DrumNote,
  DrumNoteType,
  DrumNoteFlags,
  EntityContext,
  EntityKind,
  TrackKey,
} from '@/lib/chart-edit';
import {
  addDrumNote,
  removeDrumNote,
  getDrumNotes,
  setDrumNoteFlags,
  addTempo,
  removeTempo,
  addTimeSignature,
  removeTimeSignature,
  addSection,
  removeSection,
  entityHandlers,
  cloneDocFor,
  findTrack,
  noteId as entityNoteId,
  drums4LaneSchema,
  noteTypeToDrumNote,
} from '@/lib/chart-edit';

// ---------------------------------------------------------------------------
// Clone helpers — chart-edit mutates in place, so we clone before calling
// ---------------------------------------------------------------------------

/** Shallow-clone a ParsedTrackData so in-place helpers don't mutate the original.
 *  Deep-clones `noteEventGroups` (per-tick note storage) since it's the only
 *  field mutated by the helpers; raw arrays for sections/lanes are also
 *  shallow-cloned via `...track` so their references differ. */
function cloneTrack(track: ParsedTrackData): ParsedTrackData {
  return {
    ...track,
    noteEventGroups: track.noteEventGroups.map(g => g.map(n => ({...n}))),
  };
}

/** Clone a doc with a freshly-cloned trackData array. */
function cloneDocWithTracks(doc: ChartDocument): ChartDocument {
  return {
    ...doc,
    parsedChart: {
      ...doc.parsedChart,
      trackData: doc.parsedChart.trackData.map(t => cloneTrack(t)),
      tempos: doc.parsedChart.tempos.map(t => ({...t})),
      timeSignatures: doc.parsedChart.timeSignatures.map(ts => ({...ts})),
    },
  };
}

/** Clone a doc with a freshly-cloned sections array (for section mutations). */
function cloneDocWithSections(doc: ChartDocument): ChartDocument {
  return {
    ...doc,
    parsedChart: {
      ...doc.parsedChart,
      sections: doc.parsedChart.sections.map(s => ({...s})),
    },
  };
}

/** Resolve the index of the track this command is targeting. Returns -1
 *  if the chart doesn't contain that track. */
function findTargetIndex(doc: ChartDocument, key: TrackKey): number {
  return findTrack(doc, key)?.index ?? -1;
}

// ---------------------------------------------------------------------------
// Note ID helper
// ---------------------------------------------------------------------------

/** Composite key for a note: `${tick}:${type}`. Unique per chart. */
export const noteId = entityNoteId;

// ---------------------------------------------------------------------------
// EditCommand interface
// ---------------------------------------------------------------------------

export interface EditCommand {
  execute(doc: ChartDocument): ChartDocument;
  undo(doc: ChartDocument): ChartDocument;
  readonly description: string;
}

// ---------------------------------------------------------------------------
// AddNoteCommand
// ---------------------------------------------------------------------------

export class AddNoteCommand implements EditCommand {
  readonly description: string;

  constructor(
    private note: DrumNote,
    private readonly trackKey: TrackKey,
  ) {
    this.description = `Add ${note.type} at tick ${note.tick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc);
    const track = newDoc.parsedChart.trackData[idx];

    // Check for duplicates via getDrumNotes
    const existing = getDrumNotes(track).find(
      n => n.tick === this.note.tick && n.type === this.note.type,
    );
    if (existing) return doc; // already exists, return unchanged

    addDrumNote(track, {
      tick: this.note.tick,
      type: this.note.type,
      length: this.note.length,
      flags: {...this.note.flags},
    });
    return newDoc;
  }

  undo(doc: ChartDocument): ChartDocument {
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc);
    const track = newDoc.parsedChart.trackData[idx];
    removeDrumNote(track, this.note.tick, this.note.type);
    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// DeleteNotesCommand
// ---------------------------------------------------------------------------

export class DeleteNotesCommand implements EditCommand {
  readonly description: string;
  private deletedNotes: DrumNote[] = [];

  constructor(
    private noteIds: Set<string>,
    private readonly trackKey: TrackKey,
  ) {
    this.description = `Delete ${noteIds.size} note(s)`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc);
    const track = newDoc.parsedChart.trackData[idx];

    // Get current notes to find which ones match the IDs
    const currentNotes = getDrumNotes(track);
    this.deletedNotes = [];

    for (const note of currentNotes) {
      if (this.noteIds.has(noteId(note))) {
        this.deletedNotes.push({...note, flags: {...note.flags}});
        removeDrumNote(track, note.tick, note.type);
      }
    }
    return newDoc;
  }

  undo(doc: ChartDocument): ChartDocument {
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc);
    const track = newDoc.parsedChart.trackData[idx];

    for (const note of this.deletedNotes) {
      addDrumNote(track, {
        tick: note.tick,
        type: note.type,
        length: note.length,
        flags: {...note.flags},
      });
    }
    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// MoveEntitiesCommand — generalized over any entity kind that supports move
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<EntityKind, string> = {
  note: 'note',
  section: 'section',
  lyric: 'lyric',
  'phrase-start': 'phrase start',
  'phrase-end': 'phrase end',
};

export class MoveEntitiesCommand implements EditCommand {
  readonly description: string;
  /** Ids of entities after the move (computed during execute, used by undo). */
  private movedIds: string[] = [];
  private readonly ctx: EntityContext;

  constructor(
    private kind: EntityKind,
    private ids: readonly string[],
    private tickDelta: number,
    private laneDelta: number,
    ctx?: EntityContext,
  ) {
    this.ctx = ctx ?? {};
    const noun = KIND_LABELS[kind];
    this.description = `Move ${ids.length} ${noun}${ids.length === 1 ? '' : 's'}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const handler = entityHandlers[this.kind];
    const newDoc = cloneDocFor(this.kind, doc);
    const laneDelta = handler.supportsLaneDelta ? this.laneDelta : 0;
    this.movedIds = this.ids.map(id =>
      handler.move(newDoc, id, this.tickDelta, laneDelta, this.ctx),
    );
    return newDoc;
  }

  undo(doc: ChartDocument): ChartDocument {
    const handler = entityHandlers[this.kind];
    const newDoc = cloneDocFor(this.kind, doc);
    const laneDelta = handler.supportsLaneDelta ? -this.laneDelta : 0;
    // Reverse the deltas using the moved ids captured during execute().
    // We re-walk in input order; result ids land back on the original
    // ids modulo any clamping the handler applied on either pass.
    for (const movedId of this.movedIds) {
      handler.move(newDoc, movedId, -this.tickDelta, laneDelta, this.ctx);
    }
    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// ToggleFlagCommand
// ---------------------------------------------------------------------------

export type FlagName = 'cymbal' | 'accent' | 'ghost';

export class ToggleFlagCommand implements EditCommand {
  readonly description: string;

  constructor(
    private noteIds: string[],
    private flag: FlagName,
    private readonly trackKey: TrackKey,
  ) {
    this.description = `Toggle ${flag} on ${noteIds.length} note(s)`;
  }

  execute(doc: ChartDocument): ChartDocument {
    return this.toggle(doc);
  }

  undo(doc: ChartDocument): ChartDocument {
    return this.toggle(doc);
  }

  private toggle(doc: ChartDocument): ChartDocument {
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc);
    const track = newDoc.parsedChart.trackData[idx];

    const idSet = new Set(this.noteIds);
    const currentNotes = getDrumNotes(track);

    for (const note of currentNotes) {
      if (!idSet.has(noteId(note))) continue;
      const flags: DrumNoteFlags = {...note.flags};
      flags[this.flag] = !flags[this.flag];
      setDrumNoteFlags(track, note.tick, note.type, flags);
    }

    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// AddBPMCommand
// ---------------------------------------------------------------------------

export class AddBPMCommand implements EditCommand {
  readonly description: string;

  constructor(
    private tick: number,
    private bpm: number,
  ) {
    this.description = `Add BPM ${bpm} at tick ${tick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithTracks(doc);
    addTempo(newDoc, this.tick, this.bpm);
    return newDoc;
  }

  undo(doc: ChartDocument): ChartDocument {
    // Remove the BPM marker we added (unless it was at tick 0)
    if (this.tick === 0) return doc;
    const newDoc = cloneDocWithTracks(doc);
    removeTempo(newDoc, this.tick);
    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// AddTimeSignatureCommand
// ---------------------------------------------------------------------------

export class AddTimeSignatureCommand implements EditCommand {
  readonly description: string;

  constructor(
    private tick: number,
    private numerator: number,
    private denominator: number,
  ) {
    this.description = `Add time sig ${numerator}/${denominator} at tick ${tick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithTracks(doc);
    addTimeSignature(newDoc, this.tick, this.numerator, this.denominator);
    return newDoc;
  }

  undo(doc: ChartDocument): ChartDocument {
    if (this.tick === 0) return doc;
    const newDoc = cloneDocWithTracks(doc);
    removeTimeSignature(newDoc, this.tick);
    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// BatchCommand
// ---------------------------------------------------------------------------

export class BatchCommand implements EditCommand {
  readonly description: string;

  constructor(
    private commands: EditCommand[],
    description?: string,
  ) {
    this.description = description ?? `Batch: ${commands.length} command(s)`;
  }

  /** Read-only access to the sub-commands (for incremental edit detection). */
  getCommands(): readonly EditCommand[] {
    return this.commands;
  }

  execute(doc: ChartDocument): ChartDocument {
    let result = doc;
    for (const cmd of this.commands) {
      result = cmd.execute(result);
    }
    return result;
  }

  undo(doc: ChartDocument): ChartDocument {
    let result = doc;
    for (let i = this.commands.length - 1; i >= 0; i--) {
      result = this.commands[i].undo(result);
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// AddSectionCommand
// ---------------------------------------------------------------------------

export class AddSectionCommand implements EditCommand {
  readonly description: string;

  constructor(
    private tick: number,
    private name: string,
  ) {
    this.description = `Add section "${name}"`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    addSection(newDoc, this.tick, this.name);
    return newDoc;
  }

  undo(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    removeSection(newDoc, this.tick);
    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// DeleteSectionCommand
// ---------------------------------------------------------------------------

export class DeleteSectionCommand implements EditCommand {
  readonly description: string;

  constructor(
    private tick: number,
    private name: string,
  ) {
    this.description = `Delete section "${name}"`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    removeSection(newDoc, this.tick);
    return newDoc;
  }

  undo(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    addSection(newDoc, this.tick, this.name);
    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// RenameSectionCommand
// ---------------------------------------------------------------------------

export class RenameSectionCommand implements EditCommand {
  readonly description: string;

  constructor(
    private tick: number,
    private oldName: string,
    private newName: string,
  ) {
    this.description = `Rename section to "${newName}"`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    const section = newDoc.parsedChart.sections.find(s => s.tick === this.tick);
    if (section) section.name = this.newName;
    return newDoc;
  }

  undo(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    const section = newDoc.parsedChart.sections.find(s => s.tick === this.tick);
    if (section) section.name = this.oldName;
    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// Lane helpers — driven by `drums4LaneSchema` so adding/renaming a lane is
// a schema-only change.
// ---------------------------------------------------------------------------

const LANE_ORDER: DrumNoteType[] = drums4LaneSchema.lanes.map(l => {
  const name = noteTypeToDrumNote[l.noteType];
  if (!name) {
    throw new Error(
      `drums4LaneSchema lane ${l.index} has unknown noteType ${l.noteType}`,
    );
  }
  return name;
});

/** scan-chart `NoteType`s that get a `cymbal` flag by default in 4-lane
 *  drums. Sourced from the schema's flag bindings rather than re-listed. */
const CYMBAL_DEFAULT_TYPES = new Set<DrumNoteType>(
  (
    drums4LaneSchema.flagBindings.find(b => b.flag === 'cymbal')?.appliesTo ??
    []
  )
    .map(nt => noteTypeToDrumNote[nt])
    .filter((t): t is DrumNoteType => !!t),
);

/** Map a DrumNoteType to a lane index (0-4). */
export function typeToLane(type: DrumNoteType): number {
  return LANE_ORDER.indexOf(type);
}

/** Map a lane index (0-4) to a DrumNoteType. */
export function laneToType(lane: number): DrumNoteType {
  return LANE_ORDER[Math.max(0, Math.min(LANE_ORDER.length - 1, lane))];
}

/** Shift a note type by a lane delta, clamping to valid range. */
export function shiftLane(type: DrumNoteType, delta: number): DrumNoteType {
  const currentLane = typeToLane(type);
  return laneToType(currentLane + delta);
}

/** Default flags for a new note in a given lane. Cymbal-by-default lanes
 *  come from the schema's `cymbal.appliesTo` binding. */
export function defaultFlagsForType(type: DrumNoteType): DrumNoteFlags {
  return CYMBAL_DEFAULT_TYPES.has(type) ? {cymbal: true} : {};
}
