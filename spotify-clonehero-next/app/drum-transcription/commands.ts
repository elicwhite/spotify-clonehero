/**
 * Command pattern for chart editing.
 *
 * All mutations to the chart go through commands, enabling undo/redo
 * (stack management is in 0007b; infrastructure is here).
 *
 * Commands are immutable -- execute() and undo() return new state rather
 * than mutating in place. This works naturally with React's reducer pattern.
 */

import type {
  ChartDocument,
  DrumNote,
  DrumNoteType,
  DrumNoteFlags,
  TempoEvent,
  TimeSignatureEvent,
} from '@/lib/drum-transcription/chart-io/types';

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
    const tracks = doc.tracks.map(track => {
      if (track.instrument !== 'drums' || track.difficulty !== 'expert') {
        return track;
      }
      // Insert note maintaining sort order, avoid duplicates
      const existing = track.notes.find(
        n => n.tick === this.note.tick && n.type === this.note.type,
      );
      if (existing) return track; // already exists

      const notes = [...track.notes, {...this.note, flags: {...this.note.flags}}];
      notes.sort((a, b) => a.tick - b.tick);
      return {...track, notes};
    });
    return {...doc, tracks};
  }

  undo(doc: ChartDocument): ChartDocument {
    const tracks = doc.tracks.map(track => {
      if (track.instrument !== 'drums' || track.difficulty !== 'expert') {
        return track;
      }
      const notes = track.notes.filter(
        n => !(n.tick === this.note.tick && n.type === this.note.type),
      );
      return {...track, notes};
    });
    return {...doc, tracks};
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
    const tracks = doc.tracks.map(track => {
      if (track.instrument !== 'drums' || track.difficulty !== 'expert') {
        return track;
      }
      const remaining: DrumNote[] = [];
      for (const note of track.notes) {
        if (this.noteIds.has(noteId(note))) {
          this.deletedNotes.push({...note, flags: {...note.flags}});
        } else {
          remaining.push(note);
        }
      }
      return {...track, notes: remaining};
    });
    return {...doc, tracks};
  }

  undo(doc: ChartDocument): ChartDocument {
    const tracks = doc.tracks.map(track => {
      if (track.instrument !== 'drums' || track.difficulty !== 'expert') {
        return track;
      }
      const notes = [
        ...track.notes,
        ...this.deletedNotes.map(n => ({...n, flags: {...n.flags}})),
      ];
      notes.sort((a, b) => a.tick - b.tick);
      return {...track, notes};
    });
    return {...doc, tracks};
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
    const idSet = new Set(this.noteIds);
    this.movedIds = [];
    const tracks = doc.tracks.map(track => {
      if (track.instrument !== 'drums' || track.difficulty !== 'expert') {
        return track;
      }
      const notes = track.notes.map(note => {
        if (!idSet.has(noteId(note))) return note;
        const newType = shiftLane(note.type, this.laneDelta);
        const newTick = Math.max(0, note.tick + this.tickDelta);
        const moved = {
          ...note,
          tick: newTick,
          type: newType,
          flags: {...note.flags},
        };
        this.movedIds.push(noteId(moved));
        return moved;
      });
      notes.sort((a, b) => a.tick - b.tick);
      return {...track, notes};
    });
    return {...doc, tracks};
  }

  undo(doc: ChartDocument): ChartDocument {
    // Reverse: find notes by their moved IDs and apply negative deltas
    const idSet = new Set(this.movedIds);
    const tracks = doc.tracks.map(track => {
      if (track.instrument !== 'drums' || track.difficulty !== 'expert') {
        return track;
      }
      const notes = track.notes.map(note => {
        if (!idSet.has(noteId(note))) return note;
        const newType = shiftLane(note.type, -this.laneDelta);
        const newTick = Math.max(0, note.tick - this.tickDelta);
        return {
          ...note,
          tick: newTick,
          type: newType,
          flags: {...note.flags},
        };
      });
      notes.sort((a, b) => a.tick - b.tick);
      return {...track, notes};
    });
    return {...doc, tracks};
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
    const idSet = new Set(this.noteIds);
    const tracks = doc.tracks.map(track => {
      if (track.instrument !== 'drums' || track.difficulty !== 'expert') {
        return track;
      }
      const notes = track.notes.map(note => {
        if (!idSet.has(noteId(note))) return note;
        const flags: DrumNoteFlags = {...note.flags};
        flags[this.flag] = !flags[this.flag];
        return {...note, flags};
      });
      return {...track, notes};
    });
    return {...doc, tracks};
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
    // Don't add duplicate at same tick
    if (doc.tempos.some(t => t.tick === this.tick)) {
      // Update existing
      const tempos = doc.tempos.map(t =>
        t.tick === this.tick ? {...t, bpm: this.bpm} : t,
      );
      return {...doc, tempos};
    }
    const tempos = [...doc.tempos, {tick: this.tick, bpm: this.bpm}];
    tempos.sort((a, b) => a.tick - b.tick);
    return {...doc, tempos};
  }

  undo(doc: ChartDocument): ChartDocument {
    // Remove the BPM marker we added (unless it was at tick 0)
    if (this.tick === 0) return doc;
    const tempos = doc.tempos.filter(t => t.tick !== this.tick);
    return {...doc, tempos};
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
    if (doc.timeSignatures.some(ts => ts.tick === this.tick)) {
      const timeSignatures = doc.timeSignatures.map(ts =>
        ts.tick === this.tick
          ? {...ts, numerator: this.numerator, denominator: this.denominator}
          : ts,
      );
      return {...doc, timeSignatures};
    }
    const timeSignatures = [
      ...doc.timeSignatures,
      {tick: this.tick, numerator: this.numerator, denominator: this.denominator},
    ];
    timeSignatures.sort((a, b) => a.tick - b.tick);
    return {...doc, timeSignatures};
  }

  undo(doc: ChartDocument): ChartDocument {
    if (this.tick === 0) return doc;
    const timeSignatures = doc.timeSignatures.filter(
      ts => ts.tick !== this.tick,
    );
    return {...doc, timeSignatures};
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
// Lane helpers
// ---------------------------------------------------------------------------

const LANE_ORDER: DrumNoteType[] = ['kick', 'red', 'yellow', 'blue', 'green'];

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
  if (type === 'yellow' || type === 'blue' || type === 'green') {
    return {cymbal: true};
  }
  return {};
}
