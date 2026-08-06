/**
 * Command pattern for chart editing.
 *
 * All mutations to the chart go through commands. Undo/redo is snapshot
 * replay: the reducer pushes the pre-command `ChartDocument` onto
 * `undoEntries` at dispatch time and `useUndoRedo` reinstalls docs directly
 * (`hooks/useEditCommands.ts`) — commands only ever need `execute()`.
 *
 * Commands are immutable -- execute() returns new state rather than
 * mutating in place. This works naturally with React's reducer pattern, and
 * lets a command double as a pure doc→doc preview function (e.g. the
 * piano-roll's tempo drag preview).
 *
 * Internally we use chart-edit's in-place helpers on shallow-cloned data
 * so that the original document is never mutated.
 */

import type {NoteType} from '@eliwhite/scan-chart';
import {noteFlags, noteTypes} from '@eliwhite/scan-chart';
import type {
  ChartDocument,
  ParsedChart,
  ParsedTrackData,
  DrumNote,
  EntityContext,
  EntityKind,
  CommandEntityKind,
  CommandOperation,
  NormalizedVocalTrack,
  TrackKey,
  InstrumentSchema,
  NoteFlagName,
  ChartTiming,
} from '@/lib/chart-edit';
import {
  addTimeSignature,
  removeTimeSignature,
  planDownbeatAt,
  planTimeSignatureMove,
  addSection,
  removeSection,
  entityHandlers,
  cloneDocFor,
  findTrack,
  drums4LaneSchema,
  getDrumNotes,
  addDrumNote,
  removeDrumNote,
  retimeChart,
  quantizeBpm,
  synctrackFromChart,
  remapKeepMs,
  type RemapKeepMsOptions,
  applyMarkerMoveBpms,
  makeChartTiming,
  applyEventTiming,
  deriveTimeSignatures,
  normalizeTimeSignatures,
  rephaseDownbeats,
  chartEndTick,
  DEFAULT_VOCALS_PART,
  addLyric,
  deleteLyric,
  setLyricText,
  addPhrase,
  deletePhrase,
  movePhrases,
  getAudioAnchor,
  setAudioAnchor,
  refreshAnchorKeepMs,
  refreshAnchorKeepTick,
  schemaNoteId,
  schemaForInstrument,
  schemaForTrack,
  typeToLane as schemaTypeToLane,
  laneToType as schemaLaneToType,
  toggleFlagBits,
  listNotes,
  addNote as addSchemaNote,
  removeNote as removeSchemaNote,
  setNoteFlags,
  setNoteLength,
  clearTrackContents,
  emptyTrack,
  applyLeadingSilence,
  type LeadingSilencePlan,
  type DownbeatFlags,
  type DerivedTimeSignature,
  type Meter,
} from '@/lib/chart-edit';

/**
 * The beat-grid span a downbeat command derives over: the wider of the
 * note-inclusive `chartEndTick` and the piano-roll's audio-extended span
 * (`spanEndTick`, passed by the panel from the SAME grid its menu offered
 * beats on). Without the panel's span, a beat right-clicked past the last
 * charted event — but within the audio — would derive over a narrower grid and
 * silently snap to an earlier beat (a tail-beat disagreement between the menu
 * and the command). `0` / undefined falls back to `chartEndTick` alone, which
 * is correct for callers with no audio-extended view (e.g. the highway).
 */
function downbeatSpanEndTick(
  chart: ParsedChart,
  spanEndTick: number | undefined,
): number {
  return Math.max(chartEndTick(chart), spanEndTick ?? 0);
}
import type {Synctrack} from '@/lib/tempo-map/types';
import type {DecodedOnsetsFile} from '@/lib/drum-transcription/ml/types';
import {
  repredictTempo,
  shiftOnsets,
} from '@/lib/drum-transcription/pipeline/repredict';
import type {AlignedSyllable} from '@/lib/lyrics-align/aligner';
import {applyAlignedLyricsToDoc} from '@/lib/lyrics-align/apply-lyrics';
import {
  LOWER_TRACK_DIFFICULTIES,
  TRACK_DIFFICULTIES,
  trackKeyId,
  type SupportedTrackInstrument,
  type SupportedTrackKey,
  type TrackKeyId,
} from '@/lib/chart-editor-core/trackInventory';
import type {
  DifficultyTierRange,
  DifficultyTierSet,
} from '@/lib/assist/difficulty-protocol';
import {
  carryAssistProvenance,
  getAssistProvenance,
  restampTempoDerived,
  setTempoStamp,
  withAssistProvenance,
} from '@/lib/chart-editor-core/content-stamps';
import {
  buildBarTicks,
  linkSegSectionsToMarkers,
  type LinkSegSectionInput,
} from '@/lib/chart-edit/helpers/linkseg-sections';
import {buildTimedTempos, msToTick} from '@/lib/drum-transcription/timing';

/** `trackKeyId()` of a single `TrackKey`, as a singleton `ReadonlySet` —
 *  the common case for commands that target exactly one track. */
function singleTrack(trackKey: TrackKey): ReadonlySet<TrackKeyId> {
  return new Set([trackKeyId(trackKey)]);
}

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

/**
 * Clone a doc for a note edit scoped to `trackKey`'s track: only that
 * track's `noteEventGroups` are deep-cloned (O(one track)); every other
 * track is shared by reference with the input doc. `tempos`/`timeSignatures`
 * are untouched by note edits, so they're shared too (kept as the same
 * reference deliberately — see `PianoRollTimeline.tsx`'s tempo-cache memo).
 */
function cloneDocWithTracks(
  doc: ChartDocument,
  trackKey: TrackKey,
): ChartDocument {
  const targetIndex = findTargetIndex(doc, trackKey);
  return {
    ...doc,
    parsedChart: {
      ...doc.parsedChart,
      trackData: doc.parsedChart.trackData.map((t, i) =>
        i === targetIndex ? cloneTrack(t) : t,
      ),
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
export function noteId(note: {tick: number; type: NoteType}): string {
  return schemaNoteId(note.tick, note.type);
}

// ---------------------------------------------------------------------------
// EditCommand interface
// ---------------------------------------------------------------------------

export interface EditCommand {
  execute(doc: ChartDocument): ChartDocument;
  readonly description: string;
  /**
   * Entity kind(s) this command *intends* to edit (plan 0037 Task 3) — the
   * capability gate `EditorSession.dispatch` checks against
   * `EditorCapabilities.editableEntities`. Intent, not incidental effect: a
   * tempo-marker move that KEEP-MS-remaps every note's tick declares
   * `{'tempo'}`, not `{'tempo', 'note'}` — the note retiming is a side
   * effect of the tempo edit, not a separate note edit the caller asked for.
   */
  readonly entityKinds: ReadonlySet<CommandEntityKind>;
  /**
   * Operation class(es) this command performs, checked against
   * `EditorCapabilities.allowedOperations`. A set (not a single value) so
   * `BatchCommand` can report the union of its members' operations without
   * losing information.
   */
  readonly operations: ReadonlySet<CommandOperation>;
  /**
   * Instrument/difficulty track(s) this command's edit lands on (plan 0074
   * Design C's staleness model), as `trackKeyId()` strings. Commands that
   * hold a `TrackKey` expose it here so the assist engine can invalidate a
   * generated track's content stamp when a command touches it. `undefined`
   * for commands whose meaning is already fully carried by `entityKinds` —
   * tempo/time-signature/section/lyric/global edits, which aren't scoped to
   * one instrument track. `BatchCommand` unions its children's sets (still
   * `undefined` if none of them declare one).
   */
  readonly affectedTracks?: ReadonlySet<TrackKeyId> | undefined;
}

/** Freeze-once singleton sets for the common single-kind/single-op cases,
 *  so command construction doesn't allocate a new Set per instance. */
const KIND = {
  note: new Set<CommandEntityKind>(['note']),
  section: new Set<CommandEntityKind>(['section']),
  lyric: new Set<CommandEntityKind>(['lyric']),
  phrase: new Set<CommandEntityKind>(['phrase-start', 'phrase-end']),
  tempo: new Set<CommandEntityKind>(['tempo']),
  timesig: new Set<CommandEntityKind>(['timesig']),
} as const;

const OP = {
  add: new Set<CommandOperation>(['add']),
  delete: new Set<CommandOperation>(['delete']),
  update: new Set<CommandOperation>(['update']),
  move: new Set<CommandOperation>(['move']),
} as const;

/** `EntityKind` → its singleton `entityKinds` set, for
 *  `MoveEntitiesCommand` (parameterized by kind at construction). */
const ENTITY_KIND_TO_COMMAND_KIND: Record<
  EntityKind,
  ReadonlySet<CommandEntityKind>
> = {
  note: KIND.note,
  section: KIND.section,
  lyric: KIND.lyric,
  'phrase-start': KIND.phrase,
  'phrase-end': KIND.phrase,
};

const TRACK_INSTRUMENT_ORDER = ['guitar', 'bass', 'drums'] as const;
const TRACK_DIFFICULTY_ORDER = ['expert', 'hard', 'medium', 'easy'] as const;

function trackSortRank(track: TrackKey): number {
  const instrument = TRACK_INSTRUMENT_ORDER.indexOf(
    track.instrument as (typeof TRACK_INSTRUMENT_ORDER)[number],
  );
  const difficulty = TRACK_DIFFICULTY_ORDER.indexOf(
    track.difficulty as (typeof TRACK_DIFFICULTY_ORDER)[number],
  );
  return (
    (instrument === -1 ? TRACK_INSTRUMENT_ORDER.length : instrument) * 10 +
    (difficulty === -1 ? TRACK_DIFFICULTY_ORDER.length : difficulty)
  );
}

/** Splices `track` into `trackData` at its instrument/difficulty sort
 *  position, appending when it sorts last. Mutates the array it is given (a
 *  copy the caller already made), matching how every command here builds a
 *  new `trackData`. */
function insertTrackSorted(
  trackData: ParsedTrackData[],
  track: ParsedTrackData,
): void {
  const rank = trackSortRank({
    instrument: track.instrument,
    difficulty: track.difficulty,
  });
  const insertionIndex = trackData.findIndex(
    existing =>
      rank <
      trackSortRank({
        instrument: existing.instrument,
        difficulty: existing.difficulty,
      }),
  );
  if (insertionIndex === -1) trackData.push(track);
  else trackData.splice(insertionIndex, 0, track);
}

/** Add one empty supported instrument/difficulty track to a chart. */
export class AddTrackCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.note;
  readonly operations = OP.add;
  readonly affectedTracks: ReadonlySet<TrackKeyId>;

  constructor(private readonly trackKey: TrackKey) {
    this.description = `Add ${trackKey.instrument} ${trackKey.difficulty} track`;
    this.affectedTracks = singleTrack(trackKey);
  }

  execute(doc: ChartDocument): ChartDocument {
    if (findTrack(doc, this.trackKey)) return doc;

    const trackData = [...doc.parsedChart.trackData];
    insertTrackSorted(trackData, emptyTrack(this.trackKey));

    return {
      ...doc,
      parsedChart: {
        ...doc.parsedChart,
        trackData,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// AddNoteCommand
// ---------------------------------------------------------------------------

/** A note to add, in scan-chart's own terms: raw `NoteType` and a flag
 *  bitmask — works for any `InstrumentSchema`'s lanes. */
export interface SchemaNote {
  tick: number;
  type: NoteType;
  length?: number;
  flags?: number;
}

/** Fill in `SchemaNote`'s optional fields for a `DrumNote`-shaped note
 *  (clipboard paste, MCP tools). Lane-legality is enforced downstream by
 *  `AddNoteCommand`'s `addNote` call, not here. */
export function toSchemaNote(note: {
  tick: number;
  type: NoteType;
  length?: number;
  flags?: number;
}): SchemaNote {
  return {
    tick: note.tick,
    type: note.type,
    length: note.length ?? 0,
    flags: note.flags ?? 0,
  };
}

/**
 * Translate a `SchemaNote` copied under `sourceSchema` into `targetSchema`'s
 * terms, by lane index (plan 0037 Task 6 — cross-difficulty/instrument
 * clipboard paste). `note.type` is looked up in the source schema's lanes to
 * find its lane index, then re-resolved against the same lane index in the
 * target schema. Returns `null` when the source lane has no counterpart in
 * the target schema (e.g. pasting a 5-lane-only green cymbal note into a
 * 4-lane drum track) — callers should drop untranslatable notes rather than
 * silently mis-map them to an unrelated lane.
 */
export function translateSchemaNote(
  note: SchemaNote,
  sourceSchema: InstrumentSchema,
  targetSchema: InstrumentSchema,
): SchemaNote | null {
  if (sourceSchema === targetSchema) return note;
  const lane = schemaTypeToLane(sourceSchema, note.type);
  if (lane === -1 || lane >= targetSchema.lanes.length) return null;
  return {...note, type: schemaLaneToType(targetSchema, lane)};
}

export class AddNoteCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.note;
  readonly operations = OP.add;
  readonly affectedTracks: ReadonlySet<TrackKeyId>;

  constructor(
    private note: SchemaNote,
    private readonly trackKey: TrackKey,
    private readonly schema: InstrumentSchema = drums4LaneSchema,
  ) {
    this.description = `Add note at tick ${note.tick}`;
    this.affectedTracks = singleTrack(trackKey);
  }

  execute(doc: ChartDocument): ChartDocument {
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc, this.trackKey);
    const track = newDoc.parsedChart.trackData[idx];

    const existing = listNotes(track, this.schema).find(
      n => n.tick === this.note.tick && n.type === this.note.type,
    );
    if (existing) return doc; // already exists, return unchanged

    // Push-model timing (plan 0061 §2): compute the new note's msTime/msLength
    // from the chart's tempos at insertion time. Without this the note lands
    // at msTime 0 and the highway (which windows by msTime) never renders it,
    // even though the piano roll — which re-derives ms from tick — shows it.
    addSchemaNote(
      track,
      {
        tick: this.note.tick,
        type: this.note.type,
        length: this.note.length ?? 0,
        flags: this.note.flags ?? 0,
      },
      this.schema,
      makeChartTiming(newDoc.parsedChart),
    );
    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// DeleteNotesCommand
// ---------------------------------------------------------------------------

export class DeleteNotesCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.note;
  readonly operations = OP.delete;
  readonly affectedTracks: ReadonlySet<TrackKeyId>;

  constructor(
    private noteIds: Set<string>,
    private readonly trackKey: TrackKey,
    private readonly schema?: InstrumentSchema,
  ) {
    this.description = `Delete ${noteIds.size} note(s)`;
    this.affectedTracks = singleTrack(trackKey);
  }

  execute(doc: ChartDocument): ChartDocument {
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;

    const schema =
      this.schema ??
      schemaForInstrument(this.trackKey.instrument) ??
      drums4LaneSchema;
    const newDoc = cloneDocWithTracks(doc, this.trackKey);
    const track = newDoc.parsedChart.trackData[idx];

    for (const note of listNotes(track, schema)) {
      if (this.noteIds.has(schemaNoteId(note.tick, note.type))) {
        removeSchemaNote(track, note.tick, note.type, schema);
      }
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
  readonly entityKinds: ReadonlySet<CommandEntityKind>;
  readonly operations = OP.move;
  /** Only `'note'` moves are track-scoped (lyric/phrase moves scope to a
   *  vocal part, not a `TrackKey`, so they leave this `undefined`). */
  readonly affectedTracks?: ReadonlySet<TrackKeyId> | undefined;
  private readonly ctx: EntityContext;

  constructor(
    // `kind` is part of the public surface so consumers iterating over
    // the undo stack (e.g. add-lyrics' manualMoveCount export metric) can
    // filter by entity kind without reflection. `readonly` keeps the
    // assignment-only contract intact.
    readonly kind: EntityKind,
    private ids: readonly string[],
    private tickDelta: number,
    private laneDelta: number,
    ctx?: EntityContext,
  ) {
    this.ctx = ctx ?? {};
    this.entityKinds = ENTITY_KIND_TO_COMMAND_KIND[kind];
    this.affectedTracks =
      kind === 'note' && this.ctx.trackKey
        ? singleTrack(this.ctx.trackKey)
        : undefined;
    const noun = KIND_LABELS[kind];
    this.description = `Move ${ids.length} ${noun}${ids.length === 1 ? '' : 's'}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const handler = entityHandlers[this.kind];
    const newDoc = cloneDocFor(this.kind, doc, this.ctx);
    const laneDelta = handler.supportsLaneDelta ? this.laneDelta : 0;
    // A kind whose ids encode position resolves the whole set at once: moving
    // them one at a time would look each id up in a document the previous
    // moves already changed.
    if (handler.moveMany) {
      handler.moveMany(newDoc, this.ids, this.tickDelta, laneDelta, this.ctx);
    } else {
      for (const id of this.ids) {
        handler.move(newDoc, id, this.tickDelta, laneDelta, this.ctx);
      }
    }
    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// ToggleFlagCommand
// ---------------------------------------------------------------------------

/** Legacy alias — the flag names `ToggleFlagCommand` was originally
 *  restricted to. Schema-generic callers can pass any `NoteFlagName`. */
export type FlagName = 'cymbal' | 'accent' | 'ghost';

export class ToggleFlagCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.note;
  readonly operations = OP.update;
  readonly affectedTracks: ReadonlySet<TrackKeyId>;

  constructor(
    private noteIds: string[],
    private flag: NoteFlagName,
    private readonly trackKey: TrackKey,
    private readonly schema: InstrumentSchema = drums4LaneSchema,
  ) {
    this.description = `Toggle ${flag} on ${noteIds.length} note(s)`;
    this.affectedTracks = singleTrack(trackKey);
  }

  execute(doc: ChartDocument): ChartDocument {
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc, this.trackKey);
    const track = newDoc.parsedChart.trackData[idx];

    const idSet = new Set(this.noteIds);
    const notes = listNotes(track, this.schema);
    const isTechnique =
      this.schema.instrument === 'guitar' || this.schema.instrument === 'bass';
    const techniqueMask = noteFlags.strum | noteFlags.hopo | noteFlags.tap;
    if (
      isTechnique &&
      (this.flag === 'strum' || this.flag === 'hopo' || this.flag === 'tap')
    ) {
      // Articulation is a chord-level choice. Selecting one gem and applying
      // H/T/S updates every gem at that tick, and never leaves contradictory
      // technique bits behind.
      const selectedTicks = new Set(
        notes
          .filter(n => idSet.has(schemaNoteId(n.tick, n.type)))
          .map(n => n.tick),
      );
      const flagBit = noteFlags[this.flag];
      for (const tick of selectedTicks) {
        const chord = notes.filter(n => n.tick === tick);
        const clear = chord.every(n => (n.flags & flagBit) !== 0);
        for (const note of chord) {
          const bits = clear
            ? note.flags & ~techniqueMask
            : (note.flags & ~techniqueMask) | flagBit;
          setNoteFlags(track, note.tick, note.type, bits, this.schema);
        }
      }
      return newDoc;
    }
    for (const note of notes) {
      if (!idSet.has(schemaNoteId(note.tick, note.type))) continue;
      const bits = toggleFlagBits(
        this.schema,
        note.type,
        note.flags,
        this.flag,
      );
      setNoteFlags(track, note.tick, note.type, bits, this.schema);
    }

    return newDoc;
  }
}

export type FretTechnique = 'natural' | 'strum' | 'hopo' | 'tap';

/** Set one mutually-exclusive guitar/bass articulation across whole chords. */
export class SetNoteTechniqueCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.note;
  readonly operations = OP.update;
  readonly affectedTracks: ReadonlySet<TrackKeyId>;

  constructor(
    private noteIds: string[],
    private technique: FretTechnique,
    private readonly trackKey: TrackKey,
    private readonly schema: InstrumentSchema,
  ) {
    this.description = `Set ${technique} on ${noteIds.length} note(s)`;
    this.affectedTracks = singleTrack(trackKey);
  }

  execute(doc: ChartDocument): ChartDocument {
    if (
      this.schema.instrument !== 'guitar' &&
      this.schema.instrument !== 'bass'
    ) {
      return doc;
    }
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;
    const newDoc = cloneDocWithTracks(doc, this.trackKey);
    const track = newDoc.parsedChart.trackData[idx];
    const notes = listNotes(track, this.schema);
    const ids = new Set(this.noteIds);
    const ticks = new Set(
      notes.filter(n => ids.has(schemaNoteId(n.tick, n.type))).map(n => n.tick),
    );
    const bit = this.technique === 'natural' ? 0 : noteFlags[this.technique];
    const techniqueMask = noteFlags.strum | noteFlags.hopo | noteFlags.tap;
    for (const note of notes) {
      if (!ticks.has(note.tick)) continue;
      setNoteFlags(
        track,
        note.tick,
        note.type,
        (note.flags & ~techniqueMask) | bit,
        this.schema,
      );
    }
    return newDoc;
  }
}

/** Apply one sustain-length delta to selected guitar/bass notes. */
export class ResizeNotesCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.note;
  readonly operations = OP.update;
  readonly affectedTracks: ReadonlySet<TrackKeyId>;

  constructor(
    private noteIds: string[],
    private lengthDelta: number,
    private readonly trackKey: TrackKey,
    private readonly schema: InstrumentSchema,
  ) {
    this.description = `Resize ${noteIds.length} note(s)`;
    this.affectedTracks = singleTrack(trackKey);
  }

  execute(doc: ChartDocument): ChartDocument {
    if (
      (this.schema.instrument !== 'guitar' &&
        this.schema.instrument !== 'bass') ||
      this.lengthDelta === 0
    ) {
      return doc;
    }
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;
    const newDoc = cloneDocWithTracks(doc, this.trackKey);
    const track = newDoc.parsedChart.trackData[idx];
    const ids = new Set(this.noteIds);
    const timing = makeChartTiming(newDoc.parsedChart);
    for (const note of listNotes(track, this.schema)) {
      if (!ids.has(schemaNoteId(note.tick, note.type))) continue;
      setNoteLength(
        track,
        note.tick,
        note.type,
        note.length + this.lengthDelta,
        timing,
      );
    }
    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// ToggleKickCommand
// ---------------------------------------------------------------------------

/**
 * Convert the selected notes between kick and a pad type. If every selected
 * note is a kick, they all convert to `padType`; otherwise every pad in the
 * selection converts to kick (existing kicks stay put). The cymbal flag is
 * dropped when converting to kick (kick can't be a cymbal); other flags
 * (accent, ghost) survive.
 *
 * A conversion that would collide with an existing note at the same tick is
 * skipped for that note.
 */
export class ToggleKickCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.note;
  readonly operations = OP.update;
  readonly affectedTracks: ReadonlySet<TrackKeyId>;

  constructor(
    private noteIds: string[],
    private readonly trackKey: TrackKey,
    private readonly padType: NoteType = noteTypes.redDrum,
  ) {
    this.description = `Toggle kick on ${noteIds.length} note(s)`;
    this.affectedTracks = singleTrack(trackKey);
  }

  execute(doc: ChartDocument): ChartDocument {
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc, this.trackKey);
    const track = newDoc.parsedChart.trackData[idx];

    const idSet = new Set(this.noteIds);
    const allNotes = getDrumNotes(track);
    const selected = allNotes.filter(n => idSet.has(noteId(n)));
    if (selected.length === 0) return doc;

    const toKick = !selected.every(n => n.type === noteTypes.kick);
    let convertedAny = false;

    // Kick↔pad conversion keeps each note's tick, but the DrumNote read carries
    // no msTime, so the remove+re-add must recompute timing or the converted
    // note lands at msTime 0 and vanishes from the highway (push model, §2).
    const timing = makeChartTiming(newDoc.parsedChart);
    for (const note of selected) {
      const targetType: NoteType = toKick ? noteTypes.kick : this.padType;
      if (note.type === targetType) continue;
      const collides = allNotes.some(
        n => n.tick === note.tick && n.type === targetType,
      );
      if (collides) continue;

      // `addDrumNote` legalizes flags for `targetType` (drops an illegal
      // kick cymbal), so the raw flag bitmask can carry over unmodified.
      removeDrumNote(track, note.tick, note.type);
      const newNote: DrumNote = {
        tick: note.tick,
        type: targetType,
        length: note.length,
        flags: note.flags,
      };
      addDrumNote(track, newNote, timing);
      convertedAny = true;
    }

    return convertedAny ? newDoc : doc;
  }
}

// ---------------------------------------------------------------------------
// AddBPMCommand
// ---------------------------------------------------------------------------

/**
 * Add or retype a BPM marker at `tick` (the highway BPM popover, 0062 §7). This
 * is a class-(a) tempo hand-edit (plan 0061 §3a), so — exactly like
 * `MoveTempoMarkerCommand` / `DeleteTempoMarkerCommand` — the note op is chosen
 * by the glue mode read at dispatch: KEEP-MS by default (notes keep their
 * wall-clock time and re-tick onto the new grid), KEEP-TICKS when glued to
 * grid (notes keep ticks and ride the moving grid via `retimeChart`). The BPM
 * is format-quantized at edit time (plan 0061 §2).
 *
 * Undo restores the pre-edit snapshot (`undoEntries`) — a KEEP-MS remap
 * quantizes/nudges notes and is not invertible in closed form, so whole-doc
 * restore is the safe inverse (plan 0061 Risks), matching the other tempo
 * commands.
 */
/**
 * KEEP-MS remap settings shared by every hand tempo edit.
 *
 * `swapSynctrack` collapses same-BPM runs by default, which is right for the
 * predictor's one-tempo-per-beat output. In an authored grid a same-BPM
 * marker is deliberate — "Add tempo marker here" inherits the governing BPM
 * so that inserting it retimes nothing, and the marker is there to be dragged
 * or retyped later. Left on, the next audio-glue edit anywhere in the song
 * silently deletes every one of them.
 */
const HAND_EDIT_REMAP: RemapKeepMsOptions = {collapseSameBpm: false};

export class AddBPMCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.tempo;
  readonly operations = OP.add;
  readonly affectedTracks?: ReadonlySet<TrackKeyId> | undefined = undefined;

  constructor(
    private tick: number,
    private bpm: number,
    private glue: TempoGlueMode,
  ) {
    this.description = `Add BPM ${bpm} at tick ${tick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const cloned = cloneDocForRetime(doc);
    const chart = cloned.parsedChart;
    const quantized = quantizeBpm(this.bpm, chart.format ?? 'chart');
    // Insert (or replace) the marker; leave msTime stale for the op below.
    chart.tempos = chart.tempos.filter(t => t.tick !== this.tick);
    chart.tempos.push({tick: this.tick, beatsPerMinute: quantized, msTime: 0});
    chart.tempos.sort((a, b) => a.tick - b.tick);

    if (this.glue === 'grid') {
      // KEEP-TICKS: notes keep ticks, ride the moving grid. The audio anchor
      // rides the grid the same way: keep its tick, recompute its ms.
      retimeChart(chart);
      return refreshAnchorKeepTick(cloned);
    }
    // KEEP-MS: the cloned notes still carry their pre-edit msTime (nothing has
    // retimed them), so swapSynctrack re-ticks them onto the corrected grid.
    // The audio anchor is audio-relative too: keep its ms, recompute its tick.
    return refreshAnchorKeepMs(
      remapKeepMs(cloned, synctrackFromChart(chart), HAND_EDIT_REMAP),
    );
  }
}

// ---------------------------------------------------------------------------
// AddTimeSignatureCommand
// ---------------------------------------------------------------------------

export class AddTimeSignatureCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.timesig;
  readonly operations = OP.add;

  constructor(
    private tick: number,
    private numerator: number,
    private denominator: number,
  ) {
    this.description = `Add time sig ${numerator}/${denominator} at tick ${tick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithTimeSignatures(doc);
    addTimeSignature(newDoc, this.tick, this.numerator, this.denominator);
    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// Tempo marker commands (plan 0061 §3 class (a); 0062 §7 sparse-marker model)
// ---------------------------------------------------------------------------

/**
 * Note-anchoring mode for a class-(a) tempo hand-edit (0062 §9). Read at
 * dispatch — the command that mutates the tempo map picks the note op from it:
 *  - `'audio'` → KEEP-MS (notes keep their wall-clock time, re-tick).
 *  - `'grid'`  → KEEP-TICKS (notes keep ticks, ride the moving grid).
 *
 * It only ever switches KEEP-MS ↔ KEEP-TICKS on these class-(a) edits; it has
 * no effect on class-(b) structural corrections (plan 0061 §3a).
 */
export type TempoGlueMode = 'audio' | 'grid';

/**
 * Deep-clone the arrays `retimeChart` mutates in place, so the KEEP-TICKS
 * path never touches the caller's original doc (KEEP-MS is already safe — it
 * builds a fresh chart via `swapSynctrack`). Unlike note-edit commands
 * (scoped to one track via `cloneDocWithTracks`), a tempo retime touches
 * *every* track's notes, so every track is cloned here.
 */
function cloneDocForRetime(doc: ChartDocument): ChartDocument {
  const cloned: ChartDocument = {
    ...doc,
    parsedChart: {
      ...doc.parsedChart,
      trackData: doc.parsedChart.trackData.map(t => cloneTrack(t)),
      tempos: doc.parsedChart.tempos.map(t => ({...t})),
      timeSignatures: doc.parsedChart.timeSignatures.map(ts => ({...ts})),
    },
  };
  const c = cloned.parsedChart;
  c.sections = c.sections.map(s => ({...s}));
  c.endEvents = c.endEvents.map(e => ({...e}));
  c.unrecognizedEventsTrackTextEvents = c.unrecognizedEventsTrackTextEvents.map(
    e => ({...e}),
  );
  for (const track of c.trackData) {
    track.starPowerSections = track.starPowerSections.map(s => ({...s}));
    track.rejectedStarPowerSections = track.rejectedStarPowerSections.map(
      s => ({
        ...s,
      }),
    );
    track.soloSections = track.soloSections.map(s => ({...s}));
    track.flexLanes = track.flexLanes.map(s => ({...s}));
    track.drumFreestyleSections = track.drumFreestyleSections.map(s => ({
      ...s,
    }));
    track.textEvents = track.textEvents.map(s => ({...s}));
    track.versusPhrases = track.versusPhrases.map(s => ({...s}));
    track.animations = track.animations.map(s => ({...s}));
  }
  if (c.vocalTracks) {
    c.vocalTracks = structuredClone(c.vocalTracks);
  }
  return cloned;
}

/**
 * Drag a sparse tempo marker to a new audio position (0062 §7). The marker's
 * two adjacent segment BPMs recompute (format-quantized), neighbours don't
 * move, and notes are handled per `glue`: KEEP-MS (audio-anchored re-tick with
 * quantize + collision nudge + section snap, plan 0061 §3 class (a)) or
 * KEEP-TICKS (plain retime). Marker 0 (song-start anchor) is immovable.
 *
 * Undo restores the pre-edit snapshot — a tempo remap is not invertible in
 * closed form (notes quantize/nudge), so whole-doc restore is the safe
 * inverse (plan 0061 Risks).
 */
export class MoveTempoMarkerCommand implements EditCommand {
  readonly description: string;
  // Intent kind is 'tempo' even under KEEP-MS glue, where every note's tick
  // is remapped as a side effect of the marker move — the note retiming
  // isn't a separate note edit the caller asked for (see `EditCommand`'s
  // `entityKinds` doc). The TEMPO capability preset relies on this: it
  // grants 'tempo' but not 'note', and this move must still be allowed.
  readonly entityKinds = KIND.tempo;
  readonly operations = OP.move;

  constructor(
    private markerTick: number,
    private newMs: number,
    private glue: TempoGlueMode,
  ) {
    this.description = `Move tempo marker at tick ${markerTick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    if (this.markerTick === 0) return doc;
    if (!doc.parsedChart.tempos.some(t => t.tick === this.markerTick))
      return doc;

    const cloned = cloneDocForRetime(doc);
    const format = cloned.parsedChart.format ?? 'chart';
    applyMarkerMoveBpms(
      cloned.parsedChart,
      this.markerTick,
      this.newMs,
      format,
    );

    if (this.glue === 'grid') {
      retimeChart(cloned.parsedChart);
      return refreshAnchorKeepTick(cloned);
    }
    // KEEP-MS: the cloned notes still carry their pre-edit msTime (nothing has
    // retimed them), so swapSynctrack re-ticks them onto the corrected grid.
    return refreshAnchorKeepMs(
      remapKeepMs(
        cloned,
        synctrackFromChart(cloned.parsedChart),
        HAND_EDIT_REMAP,
      ),
    );
  }
}

/**
 * Add a sparse tempo marker at `tick`, positioned on the current tempo line
 * so the mapping is unchanged until the user drags it (0062 §7). The inserted
 * BPM is the one already governing `tick`, so no note moves under either glue
 * mode — this is a mapping-neutral edit. A no-op if a marker already exists at
 * `tick`.
 */
export class AddTempoMarkerCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.tempo;
  readonly operations = OP.add;

  constructor(private tick: number) {
    this.description = `Add tempo marker at tick ${tick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const tempos = doc.parsedChart.tempos;
    if (tempos.some(t => t.tick === this.tick)) return doc;

    const cloned = cloneDocForRetime(doc);
    const sorted = [...cloned.parsedChart.tempos].sort(
      (a, b) => a.tick - b.tick,
    );
    // BPM governing `tick`: the last tempo at or before it (piecewise constant).
    let governing = sorted[0]?.beatsPerMinute ?? 120;
    for (const t of sorted) {
      if (t.tick <= this.tick) governing = t.beatsPerMinute;
      else break;
    }
    cloned.parsedChart.tempos.push({
      tick: this.tick,
      beatsPerMinute: governing,
      msTime: 0,
    });
    cloned.parsedChart.tempos.sort((a, b) => a.tick - b.tick);
    retimeChart(cloned.parsedChart);
    // Mapping-neutral (the inserted marker's BPM already governed this tick,
    // so no note's ms changes) — refresh keeps the anchor's tick/ms pair
    // consistent with every other retime path even though ms is unchanged.
    return refreshAnchorKeepTick(cloned);
  }
}

/**
 * Delete the sparse tempo marker at `tick`; the mapping linearizes between its
 * neighbours (the preceding segment's BPM extends to the next marker). Notes
 * are handled per `glue` (KEEP-MS re-tick vs KEEP-TICKS ride). Marker 0 (the
 * song-start anchor) can't be deleted. No-op if no marker exists at `tick`.
 */
export class DeleteTempoMarkerCommand implements EditCommand {
  readonly description: string;
  // See `MoveTempoMarkerCommand` — KEEP-MS's note re-tick is an intent side
  // effect, not a declared note edit.
  readonly entityKinds = KIND.tempo;
  readonly operations = OP.delete;

  constructor(
    private tick: number,
    private glue: TempoGlueMode,
  ) {
    this.description = `Delete tempo marker at tick ${tick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    if (this.tick === 0) return doc;
    if (!doc.parsedChart.tempos.some(t => t.tick === this.tick)) return doc;

    const cloned = cloneDocForRetime(doc);
    cloned.parsedChart.tempos = cloned.parsedChart.tempos.filter(
      t => t.tick !== this.tick,
    );

    if (this.glue === 'grid') {
      retimeChart(cloned.parsedChart);
      return refreshAnchorKeepTick(cloned);
    }
    return refreshAnchorKeepMs(
      remapKeepMs(
        cloned,
        synctrackFromChart(cloned.parsedChart),
        HAND_EDIT_REMAP,
      ),
    );
  }
}

/**
 * Delete N sparse tempo markers in one shot — the multi-marker form of
 * {@link DeleteTempoMarkerCommand}, for the piano roll's marquee selection.
 *
 * Not a `BatchCommand` of single deletes, and the difference is not
 * cosmetic. `BatchCommand` folds its members over the evolving document, so
 * N single deletes are N sequential KEEP-MS remaps: each one re-derives
 * every note's tick from ms and rounds, then the next one rounds on top of
 * that result, and each also runs its own `nudgeNoteCollisions` pass. The
 * error compounds with N. Filtering all N ticks first and remapping ONCE
 * makes the result identical to a single delete's fidelity regardless of
 * how many markers went out.
 *
 * Tick 0 (the song-start anchor) and ticks with no marker are dropped from
 * the list; if nothing is left the document is returned untouched.
 */
export class DeleteTempoMarkersCommand implements EditCommand {
  readonly description: string;
  // See `MoveTempoMarkerCommand` — KEEP-MS's note re-tick is an intent side
  // effect, not a declared note edit.
  readonly entityKinds = KIND.tempo;
  readonly operations = OP.delete;

  private readonly ticks: ReadonlySet<number>;

  constructor(
    ticks: Iterable<number>,
    private glue: TempoGlueMode,
  ) {
    this.ticks = new Set([...ticks].filter(t => t !== 0));
    this.description = `Delete ${this.ticks.size} tempo marker(s)`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const present = doc.parsedChart.tempos.filter(t => this.ticks.has(t.tick));
    if (present.length === 0) return doc;

    const cloned = cloneDocForRetime(doc);
    cloned.parsedChart.tempos = cloned.parsedChart.tempos.filter(
      t => !this.ticks.has(t.tick),
    );

    if (this.glue === 'grid') {
      retimeChart(cloned.parsedChart);
      return refreshAnchorKeepTick(cloned);
    }
    return refreshAnchorKeepMs(
      remapKeepMs(
        cloned,
        synctrackFromChart(cloned.parsedChart),
        HAND_EDIT_REMAP,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Structural tempo correction — RE-PREDICT (plan 0061 §3 class (b) / §7)
// ---------------------------------------------------------------------------

/**
 * Commit a class-(b) structural tempo correction (half/double flip) via
 * RE-PREDICT (plan 0061 §3/§7). Given the caller's structurally-
 * corrected `Synctrack` and the project's retained decoded onsets, re-runs the
 * KS-warp re-fit + fresh onset snap ({@link repredictTempo}) — or bounded
 * RESNAP when `onsets` is null (never-transcribed project).
 *
 * The glue toggle (0062 §9) does NOT apply here — it only switches KEEP-MS ↔
 * KEEP-TICKS on class-(a) edits (plan 0061 §3a). This op's choice is governed
 * solely by decoded-onset availability.
 *
 * `repredictTempo` is deterministic, so re-running it in `execute` commits the
 * same document 61-7's preview showed. Callers that must guarantee "commit
 * exactly the previewed candidate" can instead precompute the candidate and
 * commit it directly; this command is the self-contained definition.
 *
 * Undo restores the pre-edit snapshot — a tempo remap is not invertible in
 * closed form (notes are re-derived), so whole-doc restore is the safe inverse
 * (plan 0061 Risks), matching the other tempo commands.
 */
export class RepredictTempoCommand implements EditCommand {
  readonly description = 'Structural tempo correction (re-predict)';
  readonly entityKinds = KIND.tempo;
  readonly operations = OP.update;
  /** Set after execute: whether the op fell back to RESNAP (no decoded
   * onsets). The UI reads this to surface the disclosure (plan 0061 §3a). */
  usedResnapFallback = false;

  constructor(
    private correctedSync: Synctrack,
    private onsets: DecodedOnsetsFile | null,
  ) {}

  execute(doc: ChartDocument): ChartDocument {
    const anchor = getAudioAnchor(doc);
    // `this.onsets` is original-audio-relative (0064 addendum §7); shift onto
    // the padded timeline before re-deriving notes from it. Shifts a copy —
    // `this.onsets` itself is untouched so a later run (different anchor)
    // re-shifts from the source, not a stale shifted copy.
    const onsets =
      anchor && this.onsets ? shiftOnsets(this.onsets, anchor.ms) : this.onsets;
    const result = repredictTempo(doc, this.correctedSync, onsets);
    this.usedResnapFallback = result.usedResnapFallback;
    if (!anchor) return result.doc;
    // repredictTempo re-derives note ticks wholesale, but audio positions are
    // the invariant it's re-deriving them from — the anchor keeps its ms and
    // gets a fresh tick under the corrected map. Re-attach from `doc`
    // defensively (both of repredictTempo's return paths spread `...doc`, so
    // the anchor already carries over, but this doesn't rely on that).
    return refreshAnchorKeepMs(setAudioAnchor(result.doc, anchor));
  }
}

/**
 * Commit an already-computed tempo candidate exactly (plan 0061 §7's
 * "accept-or-reject IS the guard" interactive path). The half/double
 * structural-correction control runs the RE-PREDICT op ONCE up front and
 * previews the resulting `ChartDocument` via `pendingTempoCandidate`;
 * accepting must commit *that same document* — not re-run the op and risk
 * any drift between what the user evaluated and what lands. So `execute`
 * returns the captured candidate
 * verbatim (the warped tempo map and re-snapped notes included), ignoring the
 * live doc, which the pending-candidate invalidation rule guarantees is the doc
 * the candidate was derived from.
 *
 * Undo restores the pre-commit snapshot — the candidate's notes were re-derived
 * from onsets, so the edit isn't invertible in closed form; whole-doc restore is
 * the safe inverse (plan 0061 Risks), matching the other tempo commands.
 */
export class CommitTempoCandidateCommand implements EditCommand {
  readonly description = 'Commit tempo correction';
  readonly entityKinds = KIND.tempo;
  readonly operations = OP.update;

  constructor(private candidate: ChartDocument) {}

  execute(doc: ChartDocument): ChartDocument {
    const anchor = getAudioAnchor(doc);
    // The candidate is a doc captured at PREVIEW time, so any assist
    // provenance written between preview and commit (a generation record, a
    // "Keep as-is" ack) lives only on the live doc: carry the live bag over
    // rather than silently reverting it. Returns the candidate itself in the
    // common case, keeping the identity contract below intact.
    const candidate = carryAssistProvenance(doc, this.candidate);
    // No leading-silence anchor active: commit the captured candidate
    // byte-identical (object identity — "no re-run, no drift" is a tested
    // contract of this command; see commit-tempo-candidate.test.ts).
    if (!anchor) return candidate;
    // The candidate was captured from a preview computed against `doc` at
    // preview time (`previewStructural`/`previewOctave` in the piano roll),
    // which may carry a stale or absent anchor — re-derive it from the LIVE
    // `doc` being committed against (audio position is the invariant; only
    // the tick needs a fresh map).
    return refreshAnchorKeepMs(setAudioAnchor(candidate, anchor));
  }
}

// ---------------------------------------------------------------------------
// ReplaceTempoMapCommand — Chart Assist tempo-map generation (plan 0074
// Design A `generate-tempo-map` task)
// ---------------------------------------------------------------------------

export interface ReplaceTempoMapOptions {
  /**
   * True when `synctrack` was generated in the SAME assist run that also
   * (re)produced the doc's current drum transcription, so that
   * transcription's provenance should track this map rather than go stale
   * against it. Defaults to false: a standalone tempo-map regeneration is
   * the common case, and it correctly invalidates any existing drum
   * transcription (Design C) — the drums were snapped against the OLD
   * grid.
   */
  fromSameRunAsDrumTranscription?: boolean;
}

/**
 * Install a freshly generated `Synctrack` (plan Design A's
 * `generate-tempo-map` task, wrapping `runTempoPipelineFromPcm`) as the
 * doc's tempo map, re-deriving every note's tick under it.
 *
 * Re-ticking reuses `repredictTempo`'s bounded RESNAP path verbatim —
 * `onsets` is always `null` here, since the tempo pipeline never decodes
 * onsets (that is the drum-transcription CRNN's job) — the exact machinery
 * `RepredictTempoCommand` falls back to for a never-transcribed project, so
 * a fresh grid retimes through the one keep-ms remap implementation the
 * tempo commands already share rather than a second bespoke retime.
 *
 * `entityKinds` is `{tempo, timesig}`, not `note`: the note re-tick is a
 * side effect of the tempo-map swap, exactly like `MoveTempoMarkerCommand`'s
 * KEEP-MS glue (see that class's `entityKinds` doc) — so `TEMPO_CAPABILITIES`,
 * which grants `tempo`/`timesig` but deliberately withholds `note`, still
 * allows this command. `affectedTracks` is left undefined: a tempo-map swap
 * isn't scoped to one instrument track (matches `AddBPMCommand` and the
 * other tempo commands, none of which declare it).
 *
 * Restamps the recorded drum-transcription provenance onto the new map only
 * when `options.fromSameRunAsDrumTranscription` is set
 * (reflecting a transcription produced together with this exact map);
 * otherwise any existing recorded stamp is left untouched, so a standalone
 * tempo regeneration makes an existing drum transcription stale
 * (`selectTempoDerivedStale`, Design C). A doc with no drum
 * transcription provenance is untouched either way.
 *
 * Undo restores the pre-edit snapshot (and its provenance, which rides the
 * doc) — a tempo remap isn't invertible in closed form, matching every
 * other tempo command.
 */
export class ReplaceTempoMapCommand implements EditCommand {
  readonly description = 'Generate tempo map';
  readonly entityKinds = new Set<CommandEntityKind>(['tempo', 'timesig']);
  readonly operations = OP.update;

  constructor(
    private synctrack: Synctrack,
    private options: ReplaceTempoMapOptions = {},
  ) {}

  execute(doc: ChartDocument): ChartDocument {
    const anchor = getAudioAnchor(doc);
    const result = repredictTempo(doc, this.synctrack, null);
    const retimed = anchor
      ? refreshAnchorKeepMs(setAudioAnchor(result.doc, anchor))
      : result.doc;

    // A standalone regeneration leaves any recorded transcription stamp
    // behind, so the drums snapped to the OLD grid are flagged stale.
    return this.options.fromSameRunAsDrumTranscription
      ? restampTempoDerived(retimed, 'drum-transcription')
      : retimed;
  }
}

// ---------------------------------------------------------------------------
// Downbeat commands (plan 0061 §6 / §3b; plan 0062 §8)
//
// The `DownbeatFlags` store is the canonical source of truth for bar
// structure; these commands mutate it and re-derive the persisted
// `timeSignatures` from the result in the SAME command, so the in-memory
// store (recomputed from `timeSignatures` on every doc change) and the chart
// never diverge. None of them retime a note — bar relabel is plan 0061 §3a
// class (c): only the `timeSignatures` array changes; tempos and every
// event's `msTime` are untouched.
// ---------------------------------------------------------------------------

/** Clone a doc with a freshly-cloned timeSignatures array — the only field
 *  the downbeat commands replace. Notes/tempos/sections are shared (never
 *  mutated by these commands, so their `msTime` stays bit-identical). */
function cloneDocWithTimeSignatures(doc: ChartDocument): ChartDocument {
  return {
    ...doc,
    parsedChart: {
      ...doc.parsedChart,
      timeSignatures: doc.parsedChart.timeSignatures.map(ts => ({...ts})),
    },
  };
}

/**
 * Re-derive `timeSignatures` from a mutated `DownbeatFlags` store (0061 §3b
 * save direction), setting each derived event's `msTime`/`msLength` from the
 * chart's own tempos, and return a new doc carrying them. Nothing else on the
 * doc changes.
 */
function applyDownbeatFlags(
  doc: ChartDocument,
  newFlags: DownbeatFlags,
): ChartDocument {
  const chart = doc.parsedChart;
  const regions = normalizeTimeSignatures(chart.timeSignatures);
  const trailingNumerator = regions[regions.length - 1]?.numerator;
  const derived = deriveTimeSignatures(
    newFlags,
    chart.resolution,
    trailingNumerator,
  );
  return applyTimeSignatureList(doc, derived);
}

/**
 * Replace the doc's `timeSignatures` with `list`, timing each event from the
 * chart's own tempos. Nothing else on the doc changes — a bar relabel never
 * retimes a note (plan 0061 §3a class (c)).
 */
function applyTimeSignatureList(
  doc: ChartDocument,
  list: readonly DerivedTimeSignature[],
): ChartDocument {
  const timing = makeChartTiming(doc.parsedChart);
  const timeSignatures = list.map(ts => {
    const event = {
      tick: ts.tick,
      numerator: ts.numerator,
      denominator: ts.denominator,
      msTime: 0,
      msLength: 0,
    };
    applyEventTiming(event, timing);
    return event;
  });

  const newDoc = cloneDocWithTimeSignatures(doc);
  newDoc.parsedChart.timeSignatures = timeSignatures;
  return newDoc;
}

/**
 * §6's whole-song "this beat is bar 1" tap. Rotates the entire downbeat
 * lattice so the beat nearest `tapTick` becomes a downbeat, preserving each
 * region's numerator/denominator. No note is retimed — only `timeSignatures`
 * changes. No-op when the tapped beat is already a downbeat (phase 0). Undo
 * restores the pre-edit snapshot.
 */
export class RephaseDownbeatsCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.timesig;
  readonly operations = OP.update;

  /** `spanEndTick` is the piano-roll's audio-extended beat span (see
   *  {@link downbeatSpanEndTick}); omit it for callers with no audio view. */
  constructor(
    private tapTick: number,
    private spanEndTick?: number,
  ) {
    this.description = `Rephase downbeats to tick ${tapTick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const chart = doc.parsedChart;
    const newFlags = rephaseDownbeats(
      chart.timeSignatures,
      chart.resolution,
      downbeatSpanEndTick(chart, this.spanEndTick),
      this.tapTick,
    );
    if (!newFlags) return doc;

    return applyDownbeatFlags(doc, newFlags);
  }
}

// ---------------------------------------------------------------------------
// Bar-line placement (plan 0082)
//
// "Make this a downbeat", "insert a time signature change here", and dragging
// a time-signature marker are one operation: put a bar line at a tick and let
// the measure before it absorb the difference. All three run the same pure
// plan (`lib/chart-edit/downbeat`), so they can never disagree about what a
// short measure looks like. A plan that reports `noop` or `inexact` leaves the
// doc untouched — a target the format can't express is never rounded to a
// different tick behind the user's back.
// ---------------------------------------------------------------------------

/**
 * Place a bar line at `targetTick`. The measure containing it is rewritten to
 * end there, and `meterAfter` (the region's own meter when omitted) resumes at
 * the target so every later bar line counts from the new downbeat.
 */
export class PlaceDownbeatCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.timesig;
  readonly operations = OP.update;

  constructor(
    private targetTick: number,
    private meterAfter?: Meter,
  ) {
    this.description = `Place bar line at tick ${targetTick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const chart = doc.parsedChart;
    const plan = planDownbeatAt(
      chart.timeSignatures,
      chart.resolution,
      this.targetTick,
      this.meterAfter,
    );
    if (plan.status !== 'ok') return doc;
    return applyTimeSignatureList(doc, plan.timeSignatures);
  }
}

/**
 * Move the authored time signature at `fromTick` to `toTick`, keeping its own
 * meter. The drop has the same preceding-measure consequence as any other
 * bar-line placement. The tick-0 signature never moves.
 */
export class MoveTimeSignatureCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.timesig;
  readonly operations = OP.move;

  constructor(
    private fromTick: number,
    private toTick: number,
  ) {
    this.description = `Move time signature from tick ${fromTick} to ${toTick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const chart = doc.parsedChart;
    const plan = planTimeSignatureMove(
      chart.timeSignatures,
      chart.resolution,
      this.fromTick,
      this.toTick,
    );
    if (plan.status !== 'ok') return doc;
    return applyTimeSignatureList(doc, plan.timeSignatures);
  }
}

/**
 * Delete the authored time signature event at `tick`. Bars from there on
 * inherit the preceding region's meter and phase. The chart's initial
 * signature (tick 0) is not removable.
 */
export class RemoveTimeSignatureCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.timesig;
  readonly operations = OP.delete;

  constructor(private tick: number) {
    this.description = `Remove time signature at tick ${tick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    if (this.tick === 0) return doc;
    const chart = doc.parsedChart;
    if (!chart.timeSignatures.some(ts => ts.tick === this.tick)) return doc;
    const newDoc = cloneDocWithTimeSignatures(doc);
    removeTimeSignature(newDoc, this.tick);
    return newDoc;
  }
}

// ---------------------------------------------------------------------------
// BatchCommand
// ---------------------------------------------------------------------------

export class BatchCommand implements EditCommand {
  readonly description: string;
  /** Union of every member command's `entityKinds` — a batch is allowed
   *  only if the capability gate allows *every* kind any member touches. */
  readonly entityKinds: ReadonlySet<CommandEntityKind>;
  /** Union of every member command's `operations`, same rationale. */
  readonly operations: ReadonlySet<CommandOperation>;
  /** Union of every member command's `affectedTracks`; `undefined` if none
   *  of them declare one (a batch of chart-wide edits, say). */
  readonly affectedTracks?: ReadonlySet<TrackKeyId> | undefined;

  constructor(
    private commands: EditCommand[],
    description?: string,
  ) {
    this.description = description ?? `Batch: ${commands.length} command(s)`;
    const kinds = new Set<CommandEntityKind>();
    const ops = new Set<CommandOperation>();
    let tracks: Set<TrackKeyId> | undefined;
    for (const cmd of commands) {
      for (const kind of cmd.entityKinds) kinds.add(kind);
      for (const op of cmd.operations) ops.add(op);
      if (cmd.affectedTracks) {
        tracks ??= new Set<TrackKeyId>();
        for (const track of cmd.affectedTracks) tracks.add(track);
      }
    }
    this.entityKinds = kinds;
    this.operations = ops;
    this.affectedTracks = tracks;
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
}

// ---------------------------------------------------------------------------
// AddSectionCommand
// ---------------------------------------------------------------------------

export class AddSectionCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.section;
  readonly operations = OP.add;

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
}

// ---------------------------------------------------------------------------
// DeleteSectionCommand
// ---------------------------------------------------------------------------

export class DeleteSectionCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.section;
  readonly operations = OP.delete;

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
}

// ---------------------------------------------------------------------------
// RenameSectionCommand
// ---------------------------------------------------------------------------

export class RenameSectionCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.section;
  readonly operations = OP.update;

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
}

// ---------------------------------------------------------------------------
// ReplaceSectionsCommand — Chart Assist section labeling (plan 0076 item 23)
// ---------------------------------------------------------------------------

/**
 * Replace the chart's section markers with a freshly labeled set, and record
 * the grid they were placed on as `assistProvenance.sections`.
 *
 * SECTION EVENTS ONLY. `cloneDocWithSections` shares every track, the tempo
 * map, the lyrics, and the assets by reference, so this command is
 * structurally unable to touch anything but `parsedChart.sections` — which is
 * the whole point of splitting section generation out of tempo-map
 * generation (plan 0076 item 23): each one now changes exactly its own
 * artifact.
 *
 * The LinkSeg output is in seconds, so the ms→tick conversion and the
 * bar-line snap happen HERE, against the doc's grid at the moment the
 * command runs, rather than in the task — a run that finishes after the user
 * edited the tempo map still lands its markers on real bar-lines.
 *
 * Those seconds are ORIGINAL-audio-relative (the task analyzes the package's
 * own audio bytes), while the doc's grid lives on the padded timeline
 * whenever an `audioAnchor` is set — so every time shifts by `anchor.ms`
 * before conversion (0064 addendum §7, the same convention
 * `ReDeriveNotesCommand` applies to decoded onsets). Without the shift every
 * marker on a chart with leading silence lands one anchor early.
 *
 * Undo restores the pre-edit snapshot (and the provenance, which rides the
 * doc), matching the other whole-artifact replacements.
 */
export class ReplaceSectionsCommand implements EditCommand {
  readonly description = 'Generate sections';
  readonly entityKinds = KIND.section;
  readonly operations = OP.update;

  constructor(private sections: LinkSegSectionInput) {}

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    const chart = newDoc.parsedChart;
    const anchorMs = getAudioAnchor(doc)?.ms ?? 0;
    const sections: LinkSegSectionInput =
      anchorMs === 0
        ? this.sections
        : {
            ...this.sections,
            times: this.sections.times.map(t => t + anchorMs / 1000),
          };
    const timedTempos = buildTimedTempos(chart.tempos, chart.resolution);
    const lastSectionMs =
      (sections.times[sections.times.length - 1] ?? 0) * 1000;
    // The bar ladder has to reach past the last marker, or `snapTickToBar`
    // would clamp late sections onto the final enumerated bar.
    const endTick =
      Math.max(
        chartEndTick(chart),
        msToTick(lastSectionMs, timedTempos, chart.resolution, 'ceil'),
      ) + 1;
    const markers = linkSegSectionsToMarkers(sections, {
      timedTempos,
      resolution: chart.resolution,
      barTicks: buildBarTicks(chart.resolution, chart.timeSignatures, endTick),
    });

    chart.sections = [];
    for (const marker of markers) {
      addSection(newDoc, marker.tick, marker.name);
    }
    return setTempoStamp(newDoc, 'sections');
  }
}

// ---------------------------------------------------------------------------
// ReplaceDrumTrackCommand — Chart Assist drum transcription (plan 0074
// Design A)
// ---------------------------------------------------------------------------

export interface ReplaceDrumTrackOptions {
  /** Target track. Defaults to Drums Expert. */
  trackKey?: TrackKey | undefined;
}

/**
 * Replace the chart's Drums Expert track with a freshly transcribed note
 * set, applied as an in-editor command instead of remounting `EditorApp`
 * (plan 0074 Design A's `transcribe-drums` task composition). `notes` is the
 * exact payload `buildDrumsTrackFromOnsets`/`runner.ts` assemble a drums
 * track from: tick, type, length, and per-note flags (cymbal/accent/ghost),
 * i.e. `DrumNote[]` — the same shape `addDrumNote` already accepts.
 *
 * The whole target track is replaced, not just its notes: star power,
 * rejected star power, solo sections, flex lanes, freestyle sections, text
 * events, versus phrases, animations, and unrecognized MIDI events are all
 * cleared, because the chart the run persisted has none of them. Leaving
 * them would strand phrases and lanes over unrelated new notes and leave the
 * in-editor doc disagreeing with the persisted chart.
 *
 * The grid is NOT part of what is replaced. The notes are transcribed
 * against the doc's own SyncTrack, so the tempo map, the time signatures,
 * the leading-silence anchor, the sections, the lyrics and every other track
 * survive untouched — `cloneDocWithTracks` shares them by reference. There
 * is no option to adopt a different grid: predicting a tempo map is the
 * `generate-tempo-map` task and the user's own explicit choice.
 *
 * No-op (returns `doc` unchanged) if the chart has no target track — mirrors
 * `AddNoteCommand`'s missing-track handling; every chart this task runs
 * against already has one (transcription always builds/loads onto an
 * existing Drums Expert track).
 *
 * Undo restores the pre-edit snapshot (`undoEntries`) — transcription
 * output doesn't invert in closed form, so whole-doc restore is the safe
 * inverse, matching `ReplaceLyricsCommand`/the tempo commands.
 */
export class ReplaceDrumTrackCommand implements EditCommand {
  readonly description = 'Replace drum track (transcription)';
  readonly entityKinds = KIND.note;
  readonly operations = OP.update;
  readonly affectedTracks: ReadonlySet<TrackKeyId>;

  private readonly trackKey: TrackKey;

  constructor(
    private notes: DrumNote[],
    options: ReplaceDrumTrackOptions = {},
  ) {
    this.trackKey = options.trackKey ?? {
      instrument: 'drums',
      difficulty: 'expert',
    };
    this.affectedTracks = singleTrack(this.trackKey);
  }

  execute(doc: ChartDocument): ChartDocument {
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc, this.trackKey);
    const chart = newDoc.parsedChart;

    const track = clearTrackContents(chart.trackData[idx]);
    chart.trackData[idx] = track;
    const timing = makeChartTiming(chart);
    for (const note of this.notes) {
      addDrumNote(track, note, timing);
    }

    // The generating command writes the artifact AND its provenance in one
    // doc mutation (plan 0074 Design C), so undo removes both together and
    // no separate bookkeeping command is needed at the call site.
    return setTempoStamp(newDoc, 'drum-transcription');
  }
}

// ---------------------------------------------------------------------------
// AddLeadingSilenceCommand — plan 0064 editor-button addendum §5, shared by
// the Chart Assist "Add leading silence" card
// ---------------------------------------------------------------------------

/**
 * Apply a leading-silence plan captured at click time. `execute` re-derives
 * nothing from the live doc — the plan is a snapshot of what the card
 * offered the user, so redo (re-running `execute` on the doc left by undo)
 * reproduces the exact same padding. Undo restores the pre-edit snapshot,
 * matching the other tempo/anchor-affecting commands here (the ms-domain
 * shift + resync isn't invertible in closed form).
 *
 * `entityKinds` is `{tempo, timesig}`: the plan shifts the SYNC TRACK into a
 * padded ms domain and every note keeps its tick, so — exactly like
 * `MoveTempoMarkerCommand`'s KEEP-MS glue and `ReplaceTempoMapCommand` — the
 * intent is a grid edit and the notes' new ms positions are its side effect.
 * Declaring `note`/`lyric` here would make the command illegal under
 * `TEMPO_CAPABILITIES`, which is precisely the surface that offers it.
 *
 * The whole grid moving forward by a fixed pad does NOT invalidate anything
 * generated against it: the drums and the section markers moved with it, and
 * nothing landed on a different beat. So every tempo-derived record is
 * re-stamped onto the padded map rather than left behind to trip
 * `selectTempoDerivedStale` on an action that changed no musical
 * relationship.
 */
export class AddLeadingSilenceCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = new Set<CommandEntityKind>(['tempo', 'timesig']);
  readonly operations = OP.move;

  constructor(private plan: LeadingSilencePlan) {
    this.description = `Add leading silence (${plan.bars} bar${plan.bars === 1 ? '' : 's'})`;
  }

  execute(doc: ChartDocument): ChartDocument {
    // Everything shifts together, so nothing moved relative to the grid:
    // both the transcription and the section markers are still as correct as
    // they were, and neither should be flagged stale.
    return restampTempoDerived(applyLeadingSilence(doc, this.plan));
  }
}

// ---------------------------------------------------------------------------
// ReplaceLyricsCommand — Add Lyrics dialog (plan 0063 Part C)
// ---------------------------------------------------------------------------

/**
 * Whether any part of a chart's vocal tracks already carries lyrics — either
 * on `notePhrases` (the karaoke/note-driven lyrics) or `staticLyricPhrases`
 * (the display-only copy some formats carry separately). Used to gate the
 * Add Lyrics dialog's overwrite confirmation before it replaces the primary
 * `vocals` part.
 */
export function hasExistingLyrics(
  vocalTracks: NormalizedVocalTrack | undefined,
): boolean {
  return Object.values(vocalTracks?.parts ?? {}).some(
    part =>
      part.notePhrases.some(p => p.lyrics.length > 0) ||
      part.staticLyricPhrases.some(p => p.lyrics.length > 0),
  );
}

/**
 * Replace the chart's `vocals` part with freshly-aligned lyrics (Add Lyrics
 * dialog, plan 0063 Part C). Undo restores the pre-edit snapshot
 * (`undoEntries`) — the aligned syllables don't invert in closed form.
 */
export class ReplaceLyricsCommand implements EditCommand {
  readonly description = 'Add lyrics';
  readonly entityKinds = KIND.lyric;
  readonly operations = OP.update;

  constructor(private syllables: AlignedSyllable[]) {}

  execute(doc: ChartDocument): ChartDocument {
    // The aligner ran against the ORIGINAL (unpadded) audio, so its syllable
    // times are original-audio-relative (0064 addendum §7). When leading
    // silence is active, shift onto a copy — never `this.syllables` itself,
    // since redo must be able to re-run this against a doc whose anchor has
    // since changed.
    const anchor = getAudioAnchor(doc);
    const syllables = anchor
      ? this.syllables.map(s => ({
          ...s,
          startMs: s.startMs + anchor.ms,
          endMs: s.endMs + anchor.ms,
        }))
      : this.syllables;
    return applyAlignedLyricsToDoc(doc, syllables);
  }
}

// ---------------------------------------------------------------------------
// Lyrics-row editing commands (plan 0063 Round 2 §2) — right-click add/edit/
// delete on the piano-roll's lyrics row. All clone via `cloneDocFor('lyric',
// ...)` (shared with `MoveEntitiesCommand`'s lyric/phrase-start/phrase-end
// kinds): every kind here mutates `vocalTracks`, so they clone identically.
// ---------------------------------------------------------------------------

/** Add a syllable at `tick`, paired with a placeholder pitch-60 note (see
 *  `lib/chart-edit/helpers/lyrics.ts` `addLyric`). No-op (returns `doc`
 *  unchanged) when `tick` isn't inside an existing phrase, or a lyric
 *  already exists there. */
export class AddLyricCommand implements EditCommand {
  readonly description = 'Add lyric';
  readonly entityKinds = KIND.lyric;
  readonly operations = OP.add;

  constructor(
    private tick: number,
    private text: string,
    private partName: string = DEFAULT_VOCALS_PART,
  ) {}

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocFor('lyric', doc);
    const createdId = addLyric(newDoc, this.tick, this.text, this.partName);
    return createdId ? newDoc : doc;
  }
}

/** Delete the lyric at `tick` (and its paired note); deletes the phrase too
 *  if that empties it (see `deleteLyric`). No-op if no lyric exists there. */
export class DeleteLyricCommand implements EditCommand {
  readonly description = 'Delete lyric';
  readonly entityKinds = KIND.lyric;
  readonly operations = OP.delete;

  constructor(
    private tick: number,
    private partName: string = DEFAULT_VOCALS_PART,
  ) {}

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocFor('lyric', doc);
    const removed = deleteLyric(newDoc, this.tick, this.partName);
    return removed ? newDoc : doc;
  }
}

/** Replace the syllable text of the lyric at `tick` (the context menu's
 *  "Edit lyric…" inline editor). No-op if no lyric exists there. */
export class SetLyricTextCommand implements EditCommand {
  readonly description = 'Edit lyric text';
  readonly entityKinds = KIND.lyric;
  readonly operations = OP.update;

  constructor(
    private tick: number,
    private text: string,
    private partName: string = DEFAULT_VOCALS_PART,
  ) {}

  private currentText(doc: ChartDocument): string | null {
    const part = doc.parsedChart.vocalTracks?.parts?.[this.partName];
    for (const phrase of part?.notePhrases ?? []) {
      const lyric = phrase.lyrics.find(l => l.tick === this.tick);
      if (lyric) return lyric.text;
    }
    return null;
  }

  execute(doc: ChartDocument): ChartDocument {
    if (this.currentText(doc) === null) return doc;
    const newDoc = cloneDocFor('lyric', doc);
    setLyricText(newDoc, this.tick, this.text, this.partName);
    return newDoc;
  }
}

/** Create an empty phrase near `tick` (the lyrics row's "Add phrase here"
 *  on empty row space), clamped against neighboring phrases (see
 *  `addPhrase`). No-op if there's no room. */
export class AddPhraseCommand implements EditCommand {
  readonly description = 'Add phrase';
  readonly entityKinds = KIND.phrase;
  readonly operations = OP.add;

  constructor(
    private tick: number,
    private partName: string = DEFAULT_VOCALS_PART,
  ) {}

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocFor('lyric', doc);
    const createdTick = addPhrase(newDoc, this.tick, this.partName);
    return createdTick !== null ? newDoc : doc;
  }
}

/** Delete the phrase starting at `tick`, along with its lyrics/notes (the
 *  phrase-band context menu's "Delete phrase"). No-op if no phrase starts
 *  there. */
export class DeletePhraseCommand implements EditCommand {
  readonly description = 'Delete phrase';
  readonly entityKinds = KIND.phrase;
  readonly operations = OP.delete;

  constructor(
    private tick: number,
    private partName: string = DEFAULT_VOCALS_PART,
  ) {}

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocFor('lyric', doc);
    const removed = deletePhrase(newDoc, this.tick, this.partName);
    return removed ? newDoc : doc;
  }
}

/**
 * Translate whole phrases by a tick delta: both edges, plus the lyrics and
 * notes inside them, keeping each phrase's length.
 *
 * This is what selecting a phrase's start AND end edge and dragging its
 * words means — the selection says "all of this phrase", so the phrase
 * travels instead of its syllables sliding around inside fixed bounds. The
 * delta is clamped once for the whole group (`movePhrases`), so co-selected
 * phrases keep their spacing.
 */
export class MovePhrasesCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.phrase;
  readonly operations = OP.move;

  constructor(
    private startTicks: readonly number[],
    private tickDelta: number,
    private partName: string = DEFAULT_VOCALS_PART,
  ) {
    const n = startTicks.length;
    this.description = `Move ${n} phrase${n === 1 ? '' : 's'}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocFor('phrase-start', doc);
    const applied = movePhrases(
      newDoc,
      this.startTicks,
      this.tickDelta,
      this.partName,
    );
    return applied === 0 ? doc : newDoc;
  }
}

// ---------------------------------------------------------------------------
// GenerateDifficultiesCommand / DeleteLowerDifficultiesCommand — Chart
// Assist difficulty generation (plan 0074 Design C/D, Phase 4)
// ---------------------------------------------------------------------------

/** `trackKeyId()` of `instrument`'s three lower-difficulty tracks, as a
 *  `Set` — the common `affectedTracks` shape for both commands below. */
function lowerDifficultyTrackIds(
  instrument: SupportedTrackInstrument,
): ReadonlySet<TrackKeyId> {
  return new Set(
    LOWER_TRACK_DIFFICULTIES.map(difficulty =>
      trackKeyId({instrument, difficulty}),
    ),
  );
}

/** `ranges` with `msTime`/`msLength` derived from `timing`. */
function timedRanges<T extends DifficultyTierRange>(
  ranges: readonly T[],
  timing: ChartTiming,
): Array<T & {msTime: number; msLength: number}> {
  return ranges.map(range => {
    const timed = {...range, msTime: 0, msLength: 0};
    applyEventTiming(timed, timing);
    return timed;
  });
}

/**
 * Install (or replace) `instrument`'s Hard/Medium/Easy tracks from
 * freshly-generated tiers, and record the source Expert track's content
 * stamp as `assistProvenance.difficulties[instrument]` in the SAME doc
 * mutation (plan 0074 Design C/D) — so undo removes the tracks and the
 * provenance entry together, exactly like `ReplaceDrumTrackCommand`'s
 * `setTempoStamp` write.
 *
 * `sourceStamp` is the Expert track's stamp as of the moment the run's input
 * was built, NOT as of apply time: Expert stays editable during a run, and
 * stamping the post-edit Expert would mark tiers reduced from the pre-edit
 * one as fresh, permanently hiding the staleness the user should see.
 *
 * A tier replaces that difficulty's track wholesale, the same way
 * `ReplaceDrumTrackCommand` replaces Expert: an existing lower-difficulty
 * track is cleared and refilled from the tier, so its phrases, lanes and
 * sections are the generated ones and nothing of the old track survives. A
 * difficulty with no existing track is created and inserted in
 * instrument/difficulty sort order (matching `AddTrackCommand`).
 *
 * No-op (returns `doc` unchanged) if `instrument` has no Expert track —
 * there is nothing to generate from or stamp a source against.
 *
 * `entityKinds` is `{'note'}` (installing tracks is a note edit, same as
 * `AddTrackCommand`); `affectedTracks` is the three lower `TrackKey`s —
 * NOT the Expert track, which this command reads but never writes.
 *
 * Undo restores the pre-edit snapshot (`undoEntries`) — matching every
 * other assist-generation command here.
 */
export class GenerateDifficultiesCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.note;
  readonly operations = OP.add;
  readonly affectedTracks: ReadonlySet<TrackKeyId>;

  constructor(
    private readonly instrument: SupportedTrackInstrument,
    private readonly tiers: DifficultyTierSet,
    /** The source Expert track's content stamp, captured when the run's
     *  input was built. */
    private readonly sourceStamp: string,
  ) {
    this.description = `Generate ${instrument} difficulties`;
    this.affectedTracks = lowerDifficultyTrackIds(instrument);
  }

  execute(doc: ChartDocument): ChartDocument {
    const expertKey: TrackKey = {
      instrument: this.instrument,
      difficulty: 'expert',
    };
    const expert = findTrack(doc, expertKey);
    if (!expert) return doc;

    const schema =
      schemaForTrack(expert.track, doc.parsedChart.drumType) ??
      schemaForInstrument(this.instrument);
    if (!schema) return doc;

    const timing = makeChartTiming(doc.parsedChart);
    const trackData = [...doc.parsedChart.trackData];

    for (const difficulty of LOWER_TRACK_DIFFICULTIES) {
      const key: TrackKey = {instrument: this.instrument, difficulty};
      const existingIndex = trackData.findIndex(
        t => t.instrument === key.instrument && t.difficulty === key.difficulty,
      );
      const track =
        existingIndex === -1
          ? emptyTrack(key)
          : clearTrackContents(trackData[existingIndex]);
      const tier = this.tiers[difficulty];
      for (const note of tier.notes) {
        addSchemaNote(track, note, schema, timing);
      }
      track.starPowerSections = timedRanges(tier.starPowerSections, timing);
      track.rejectedStarPowerSections = timedRanges(
        tier.rejectedStarPowerSections,
        timing,
      );
      track.soloSections = timedRanges(tier.soloSections, timing);
      track.flexLanes = timedRanges(tier.flexLanes, timing);
      if (existingIndex === -1) insertTrackSorted(trackData, track);
      else trackData[existingIndex] = track;
    }

    const newDoc: ChartDocument = {
      ...doc,
      parsedChart: {...doc.parsedChart, trackData},
    };

    const provenance = getAssistProvenance(doc);
    return withAssistProvenance(newDoc, {
      ...provenance,
      difficulties: {
        ...provenance?.difficulties,
        [this.instrument]: {sourceStamp: this.sourceStamp},
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Track deletion — Chart Matrix right-click context menu (plan 0077 item 6).
// OWNER OVERRIDE (2026-08-04): the plan originally made difficulty deletion
// set-only (`DeleteLowerDifficultiesCommand`); this reintroduces deleting
// exactly one difficulty, on top of the set-shaped delete and a new
// whole-instrument delete. All three share `deleteTracks` below, so the three
// differ only in what they remove and when the provenance record survives.
// ---------------------------------------------------------------------------

/**
 * The body every track-deleting command has: drop the tracks `removes`
 * selects, and decide what becomes of the instrument's
 * `assistProvenance.difficulties[instrument]` entry — the Expert content stamp
 * a generated Hard/Medium/Easy set was produced from.
 *
 * `keepsProvenance` is asked, with the tracks that survived, whether that
 * record still describes something; when it does not, the record is dropped in
 * the same undoable step. Only that question differs between the three
 * commands, so it is the only thing they pass.
 *
 * Returns `doc` untouched when there was nothing to remove and no record to
 * clear.
 */
function deleteTracks(
  doc: ChartDocument,
  instrument: SupportedTrackInstrument,
  removes: (track: ParsedTrackData) => boolean,
  keepsProvenance: (remaining: ParsedTrackData[]) => boolean,
): ChartDocument {
  const provenance = getAssistProvenance(doc);
  const difficulties = provenance?.difficulties;
  const hadRecord = difficulties?.[instrument] !== undefined;

  const trackData = doc.parsedChart.trackData.filter(t => !removes(t));
  const removedAnyTrack = trackData.length !== doc.parsedChart.trackData.length;
  if (!removedAnyTrack && !hadRecord) return doc;

  // Spreading `doc` already carries `assistProvenance` over unchanged, so only
  // the case that actually edits the bag rewrites it.
  const newDoc: ChartDocument = {
    ...doc,
    parsedChart: {...doc.parsedChart, trackData},
  };
  if (!difficulties || !hadRecord || keepsProvenance(trackData)) return newDoc;

  const {[instrument]: _removed, ...restDifficulties} = difficulties;
  return withAssistProvenance(newDoc, {
    ...provenance,
    difficulties: restDifficulties,
  });
}

/**
 * Remove `instrument`'s Hard/Medium/Easy tracks and its
 * `assistProvenance.difficulties[instrument]` entry as one undoable unit
 * (plan 0074 Design D) — the inverse of `GenerateDifficultiesCommand`. The
 * Expert track, every other instrument's tracks, and any unrelated
 * provenance (drum transcription, other instruments' difficulty records,
 * acks) are left untouched.
 *
 * Nothing the record describes survives the whole set going away, so it is
 * always dropped.
 *
 * `entityKinds` is `{'note'}`; `affectedTracks` is the same three lower
 * `TrackKey`s `GenerateDifficultiesCommand` declares.
 *
 * Undo restores the pre-edit snapshot (`undoEntries`).
 */
export class DeleteLowerDifficultiesCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.note;
  readonly operations = OP.delete;
  readonly affectedTracks: ReadonlySet<TrackKeyId>;

  constructor(private readonly instrument: SupportedTrackInstrument) {
    this.description = `Delete ${instrument} lower difficulties`;
    this.affectedTracks = lowerDifficultyTrackIds(instrument);
  }

  execute(doc: ChartDocument): ChartDocument {
    return deleteTracks(
      doc,
      this.instrument,
      t =>
        t.instrument === this.instrument &&
        (LOWER_TRACK_DIFFICULTIES as readonly string[]).includes(t.difficulty),
      () => false,
    );
  }
}

/**
 * Remove exactly one instrument/difficulty track (plan 0077 item 6's "Delete
 * difficulty" cell action) — unlike `DeleteLowerDifficultiesCommand`, which is
 * always set-shaped (all three lower tiers together), this removes only the
 * one track named by `trackKey`.
 *
 * This is the one deletion whose provenance record can survive, and the rule
 * is the `keepsProvenance` lambda below (the plan's open provenance question,
 * decided here):
 *
 *  - Deleting Expert: the record's own subject is gone, so it is dropped
 *    unconditionally, even if generated Hard/Medium/Easy tracks survive —
 *    there is no longer an Expert to compare their staleness against
 *    (`selectDifficultyStale` reads the live Expert stamp). This is the
 *    owner's explicit instruction.
 *  - Deleting one lower tier (Hard, Medium or Easy) while at least one
 *    sibling lower tier survives: the record is KEPT. It still accurately
 *    names the Expert stamp the survivors were generated from — provenance
 *    is instrument-keyed, not per-tier — so dropping it would silently
 *    un-stale the remaining generated tracks (they'd read as hand-charted
 *    instead of AI-generated).
 *  - Deleting the last surviving lower tier: nothing the record describes
 *    remains, so it is dropped — matching `DeleteLowerDifficultiesCommand`'s
 *    rule for removing the whole set.
 *
 * No-op if the track doesn't exist. Undo restores the pre-edit snapshot.
 */
export class DeleteTrackCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.note;
  readonly operations = OP.delete;
  readonly affectedTracks: ReadonlySet<TrackKeyId>;

  constructor(private readonly trackKey: SupportedTrackKey) {
    this.description = `Delete ${trackKey.instrument} ${trackKey.difficulty} track`;
    this.affectedTracks = singleTrack(trackKey);
  }

  execute(doc: ChartDocument): ChartDocument {
    if (findTargetIndex(doc, this.trackKey) === -1) return doc;
    const {instrument, difficulty} = this.trackKey;
    return deleteTracks(
      doc,
      instrument,
      t => t.instrument === instrument && t.difficulty === difficulty,
      remaining =>
        difficulty !== 'expert' &&
        LOWER_TRACK_DIFFICULTIES.some(
          lower =>
            lower !== difficulty &&
            remaining.some(
              t => t.instrument === instrument && t.difficulty === lower,
            ),
        ),
    );
  }
}

/**
 * Remove every difficulty of one instrument (plan 0077 item 6's "Delete
 * instrument" action, offered on both the row label and each cell) and its
 * `assistProvenance.difficulties[instrument]` entry, if any — nothing that
 * entry describes survives an instrument delete, so it is always dropped,
 * unlike `DeleteTrackCommand`'s per-tier nuance above.
 *
 * No-op if the instrument has no tracks AND no provenance entry to clear.
 * Undo restores the pre-edit snapshot.
 */
export class DeleteInstrumentCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.note;
  readonly operations = OP.delete;
  readonly affectedTracks: ReadonlySet<TrackKeyId>;

  constructor(private readonly instrument: SupportedTrackInstrument) {
    this.description = `Delete ${instrument}`;
    this.affectedTracks = new Set(
      TRACK_DIFFICULTIES.map(difficulty =>
        trackKeyId({instrument, difficulty}),
      ),
    );
  }

  execute(doc: ChartDocument): ChartDocument {
    return deleteTracks(
      doc,
      this.instrument,
      t => t.instrument === this.instrument,
      () => false,
    );
  }
}
