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
  TrackData,
  DrumNote,
  DrumNoteType,
  DrumNoteFlags,
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
} from '@/lib/chart-edit';

// ---------------------------------------------------------------------------
// Clone helpers — chart-edit mutates in place, so we clone before calling
// ---------------------------------------------------------------------------

/** Shallow-clone a TrackData so in-place helpers don't mutate the original. */
function cloneTrack(track: TrackData): TrackData {
  return {
    ...track,
    trackEvents: [...track.trackEvents.map(e => ({...e}))],
  };
}

/** Clone a doc with a freshly-cloned trackData array. */
function cloneDocWithTracks(doc: ChartDocument): ChartDocument {
  return {
    ...doc,
    trackData: doc.trackData.map(t => cloneTrack(t)),
    tempos: doc.tempos.map(t => ({...t})),
    timeSignatures: doc.timeSignatures.map(ts => ({...ts})),
  };
}

/** Clone a doc with a freshly-cloned sections array (for section mutations). */
function cloneDocWithSections(doc: ChartDocument): ChartDocument {
  return {
    ...doc,
    sections: doc.sections.map(s => ({...s})),
  };
}

/** Find the expert drums track index. */
function findExpertDrumsIndex(doc: ChartDocument): number {
  return doc.trackData.findIndex(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  );
}

// ---------------------------------------------------------------------------
// Note ID helper
// ---------------------------------------------------------------------------

/** Composite key for a note: `${tick}:${type}`. Unique per chart. */
export function noteId(note: {tick: number; type: DrumNoteType}): string {
  return `${note.tick}:${note.type}`;
}

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

  constructor(private note: DrumNote) {
    this.description = `Add ${note.type} at tick ${note.tick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const idx = findExpertDrumsIndex(doc);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc);
    const track = newDoc.trackData[idx];

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
    const idx = findExpertDrumsIndex(doc);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc);
    const track = newDoc.trackData[idx];
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

  constructor(private noteIds: Set<string>) {
    this.description = `Delete ${noteIds.size} note(s)`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const idx = findExpertDrumsIndex(doc);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc);
    const track = newDoc.trackData[idx];

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
    const idx = findExpertDrumsIndex(doc);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc);
    const track = newDoc.trackData[idx];

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
// MoveNotesCommand
// ---------------------------------------------------------------------------

export class MoveNotesCommand implements EditCommand {
  readonly description: string;
  /** IDs of notes after the move (computed during execute, used by undo). */
  private movedIds: string[] = [];

  constructor(
    private noteIds: string[],
    private tickDelta: number,
    private laneDelta: number,
  ) {
    this.description = `Move ${noteIds.length} note(s)`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const idx = findExpertDrumsIndex(doc);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc);
    const track = newDoc.trackData[idx];

    const idSet = new Set(this.noteIds);
    this.movedIds = [];

    // Get current notes, find matching ones, remove them, then re-add at new positions
    const currentNotes = getDrumNotes(track);
    const toMove: DrumNote[] = [];

    for (const note of currentNotes) {
      if (idSet.has(noteId(note))) {
        toMove.push({...note, flags: {...note.flags}});
      }
    }

    // Remove originals
    for (const note of toMove) {
      removeDrumNote(track, note.tick, note.type);
    }

    // Re-add at new positions
    for (const note of toMove) {
      const newType = shiftLane(note.type, this.laneDelta);
      const newTick = Math.max(0, note.tick + this.tickDelta);
      const moved: DrumNote = {
        ...note,
        tick: newTick,
        type: newType,
        flags: {...note.flags},
      };
      this.movedIds.push(noteId(moved));
      addDrumNote(track, {
        tick: moved.tick,
        type: moved.type,
        length: moved.length,
        flags: moved.flags,
      });
    }

    return newDoc;
  }

  undo(doc: ChartDocument): ChartDocument {
    const idx = findExpertDrumsIndex(doc);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc);
    const track = newDoc.trackData[idx];

    // Reverse: find notes by their moved IDs and apply negative deltas
    const idSet = new Set(this.movedIds);
    const currentNotes = getDrumNotes(track);
    const toRevert: DrumNote[] = [];

    for (const note of currentNotes) {
      if (idSet.has(noteId(note))) {
        toRevert.push({...note, flags: {...note.flags}});
      }
    }

    // Remove moved notes
    for (const note of toRevert) {
      removeDrumNote(track, note.tick, note.type);
    }

    // Re-add at original positions
    for (const note of toRevert) {
      const newType = shiftLane(note.type, -this.laneDelta);
      const newTick = Math.max(0, note.tick - this.tickDelta);
      addDrumNote(track, {
        tick: newTick,
        type: newType,
        length: note.length,
        flags: {...note.flags},
      });
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
    const idx = findExpertDrumsIndex(doc);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc);
    const track = newDoc.trackData[idx];

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
    this.description =
      description ?? `Batch: ${commands.length} command(s)`;
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
    const section = newDoc.sections.find(s => s.tick === this.tick);
    if (section) section.name = this.newName;
    return newDoc;
  }

  undo(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    const section = newDoc.sections.find(s => s.tick === this.tick);
    if (section) section.name = this.oldName;
    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// MoveSectionCommand
// ---------------------------------------------------------------------------

export class MoveSectionCommand implements EditCommand {
  readonly description: string;

  constructor(
    private oldTick: number,
    private newTick: number,
    private name: string,
  ) {
    this.description = `Move section "${name}"`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    removeSection(newDoc, this.oldTick);
    addSection(newDoc, this.newTick, this.name);
    return newDoc;
  }

  undo(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    removeSection(newDoc, this.newTick);
    addSection(newDoc, this.oldTick, this.name);
    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// Lane helpers
// ---------------------------------------------------------------------------

const LANE_ORDER: DrumNoteType[] = ['kick', 'redDrum', 'yellowDrum', 'blueDrum', 'greenDrum'];

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

/** Default flags for a new note in a given lane. Yellow/blue/green default to cymbal. */
export function defaultFlagsForType(type: DrumNoteType): DrumNoteFlags {
  if (type === 'yellowDrum' || type === 'blueDrum' || type === 'greenDrum') {
    return {cymbal: true};
  }
  return {};
}
