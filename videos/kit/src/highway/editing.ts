import type {
  ChartDocument,
  Difficulty,
  Instrument,
  NoteEvent,
  NoteType,
} from '@eliwhite/scan-chart';
import {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveEntitiesCommand,
  SetNoteLengthCommand,
} from '@product/components/chart-editor/commands';
import {
  findTrack,
  listNotes,
  schemaForTrack,
  schemaNoteId,
} from '@product/lib/chart-edit';
import type {InstrumentSchema} from '@product/lib/chart-edit/instruments';

/**
 * Chart edits, made with the chart editor's own commands, so an edited
 * document is exactly what the editor holds after the same action. Every
 * helper is pure: it returns a new document and leaves its input alone.
 *
 * Note ids are the editor's (`${tick}:${noteTypeName}`, from `noteIdOf`),
 * scoped to one track. Ticks are the chart's own (its `resolution` per
 * quarter note).
 */

export interface TrackRef {
  instrument: Instrument;
  difficulty: Difficulty;
}

export const EXPERT_DRUMS: TrackRef = {
  instrument: 'drums',
  difficulty: 'expert',
};
export const EXPERT_GUITAR: TrackRef = {
  instrument: 'guitar',
  difficulty: 'expert',
};

/** The editor's id for a note within its track. */
export const noteIdOf = (note: {tick: number; type: NoteType}): string =>
  schemaNoteId(note.tick, note.type);

const trackAndSchema = (
  doc: ChartDocument,
  track: TrackRef,
): {
  track: ChartDocument['parsedChart']['trackData'][number];
  schema: InstrumentSchema;
} => {
  const found = findTrack(doc, track)?.track;
  const schema = found ? schemaForTrack(found, doc.parsedChart.drumType) : null;
  if (!found || !schema) {
    throw new Error(
      `[highway] the chart has no ${track.instrument} ${track.difficulty} track`,
    );
  }
  return {track: found, schema};
};

/** Every note of a track, sorted by tick (each carries tick, type, flags, msTime, length, msLength). */
export const trackNotes = (
  doc: ChartDocument,
  track: TrackRef,
): NoteEvent[] => {
  const {track: data, schema} = trackAndSchema(doc, track);
  return listNotes(data, schema);
};

/** Notes of a track whose time falls in [fromMs, toMs) of song time. */
export const notesBetween = (
  doc: ChartDocument,
  track: TrackRef,
  fromMs: number,
  toMs: number,
): NoteEvent[] =>
  trackNotes(doc, track).filter(
    note => note.msTime >= fromMs && note.msTime < toMs,
  );

/** Drag notes by whole ticks and/or pad lanes (the editor's note drag). */
export const moveNotes = (
  doc: ChartDocument,
  track: TrackRef,
  noteIds: readonly string[],
  delta: {ticks?: number; lanes?: number},
): ChartDocument =>
  new MoveEntitiesCommand('note', noteIds, delta.ticks ?? 0, delta.lanes ?? 0, {
    trackKey: track,
  }).execute(doc);

/** Delete notes (the editor's Delete). */
export const deleteNotes = (
  doc: ChartDocument,
  track: TrackRef,
  noteIds: readonly string[],
): ChartDocument =>
  new DeleteNotesCommand(
    new Set(noteIds),
    track,
    trackAndSchema(doc, track).schema,
  ).execute(doc);

/** Place a note (the editor's place tool). `length` is in ticks; `flags` are scan-chart note flags. */
export const addNote = (
  doc: ChartDocument,
  track: TrackRef,
  note: {tick: number; type: NoteType; length?: number; flags?: number},
): ChartDocument =>
  new AddNoteCommand(note, track, trackAndSchema(doc, track).schema).execute(
    doc,
  );

/** Set the sustain length of five-fret notes, in ticks (the editor's sustain drag lands here). */
export const setNoteLength = (
  doc: ChartDocument,
  track: TrackRef,
  noteIds: readonly string[],
  lengthTicks: number,
): ChartDocument =>
  new SetNoteLengthCommand(
    [...noteIds],
    lengthTicks,
    track,
    trackAndSchema(doc, track).schema,
  ).execute(doc);

export interface TimedEdit {
  /** Film frame from which the edit is applied. */
  frame: number;
  apply: (doc: ChartDocument) => ChartDocument;
}

/**
 * The document state at each film frame for a list of edits: each edit
 * applies to the result of the ones before it. Build it once (useMemo) and
 * call it per frame; it returns the same object for the same state, which is
 * what lets the highway skip unchanged frames.
 */
export const editHistory = (
  base: ChartDocument,
  edits: readonly TimedEdit[],
): ((frame: number) => ChartDocument) => {
  const ordered = [...edits].sort((a, b) => a.frame - b.frame);
  const versions: ChartDocument[] = [base];
  for (const edit of ordered)
    versions.push(edit.apply(versions[versions.length - 1] as ChartDocument));
  return frame => {
    let applied = 0;
    while (
      applied < ordered.length &&
      (ordered[applied] as TimedEdit).frame <= frame
    )
      applied++;
    return versions[applied] as ChartDocument;
  };
};
