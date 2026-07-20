/**
 * Command pattern for chart editing.
 *
 * All mutations to the chart go through commands. Undo/redo is snapshot
 * replay: the reducer pushes the pre-command `ChartDocument` onto
 * `undoDocStack` at dispatch time and `useUndoRedo` reinstalls docs directly
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

import type {
  ChartDocument,
  ParsedChart,
  ParsedTrackData,
  DrumNote,
  DrumNoteType,
  DrumNoteFlags,
  EntityContext,
  EntityKind,
  CommandEntityKind,
  CommandOperation,
  NormalizedVocalTrack,
  TrackKey,
} from '@/lib/chart-edit';
import {
  addDrumNote,
  removeDrumNote,
  getDrumNotes,
  setDrumNoteFlags,
  addTimeSignature,
  addSection,
  removeSection,
  entityHandlers,
  cloneDocFor,
  findTrack,
  noteId as entityNoteId,
  drums4LaneSchema,
  noteTypeToDrumNote,
  retimeChart,
  quantizeBpm,
  synctrackFromChart,
  remapKeepMs,
  applyMarkerMoveBpms,
  makeChartTiming,
  applyEventTiming,
  deriveDownbeatFlags,
  deriveTimeSignatures,
  normalizeTimeSignatures,
  markDownbeat,
  unmarkDownbeat,
  rephaseDownbeats,
  snapTickToNearestBeat,
  chartEndTick,
  DEFAULT_VOCALS_PART,
  addLyric,
  deleteLyric,
  setLyricText,
  addPhrase,
  deletePhrase,
  getAudioAnchor,
  setAudioAnchor,
  refreshAnchorKeepMs,
  refreshAnchorKeepTick,
  type DownbeatFlags,
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
export const noteId = entityNoteId;

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

// ---------------------------------------------------------------------------
// AddNoteCommand
// ---------------------------------------------------------------------------

export class AddNoteCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.note;
  readonly operations = OP.add;

  constructor(
    private note: DrumNote,
    private readonly trackKey: TrackKey,
  ) {
    this.description = `Add ${note.type} at tick ${note.tick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc, this.trackKey);
    const track = newDoc.parsedChart.trackData[idx];

    // Check for duplicates via getDrumNotes
    const existing = getDrumNotes(track).find(
      n => n.tick === this.note.tick && n.type === this.note.type,
    );
    if (existing) return doc; // already exists, return unchanged

    // Push-model timing (plan 0061 §2): compute the new note's msTime/msLength
    // from the chart's tempos at insertion time. Without this the note lands
    // at msTime 0 and the highway (which windows by msTime) never renders it,
    // even though the piano roll — which re-derives ms from tick — shows it.
    addDrumNote(
      track,
      {
        tick: this.note.tick,
        type: this.note.type,
        length: this.note.length,
        flags: {...this.note.flags},
      },
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

  constructor(
    private noteIds: Set<string>,
    private readonly trackKey: TrackKey,
  ) {
    this.description = `Delete ${noteIds.size} note(s)`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc, this.trackKey);
    const track = newDoc.parsedChart.trackData[idx];

    // Get current notes to find which ones match the IDs
    const currentNotes = getDrumNotes(track);
    for (const note of currentNotes) {
      if (this.noteIds.has(noteId(note))) {
        removeDrumNote(track, note.tick, note.type);
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
    const noun = KIND_LABELS[kind];
    this.description = `Move ${ids.length} ${noun}${ids.length === 1 ? '' : 's'}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const handler = entityHandlers[this.kind];
    const newDoc = cloneDocFor(this.kind, doc, this.ctx);
    const laneDelta = handler.supportsLaneDelta ? this.laneDelta : 0;
    for (const id of this.ids) {
      handler.move(newDoc, id, this.tickDelta, laneDelta, this.ctx);
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
  readonly entityKinds = KIND.note;
  readonly operations = OP.update;

  constructor(
    private noteIds: string[],
    private flag: FlagName,
    private readonly trackKey: TrackKey,
  ) {
    this.description = `Toggle ${flag} on ${noteIds.length} note(s)`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc, this.trackKey);
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

  constructor(
    private noteIds: string[],
    private readonly trackKey: TrackKey,
    private readonly padType: DrumNoteType = 'redDrum',
  ) {
    this.description = `Toggle kick on ${noteIds.length} note(s)`;
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

    const toKick = !selected.every(n => n.type === 'kick');
    let convertedAny = false;

    // Kick↔pad conversion keeps each note's tick, but the DrumNote read carries
    // no msTime, so the remove+re-add must recompute timing or the converted
    // note lands at msTime 0 and vanishes from the highway (push model, §2).
    const timing = makeChartTiming(newDoc.parsedChart);
    for (const note of selected) {
      const targetType: DrumNoteType = toKick ? 'kick' : this.padType;
      if (note.type === targetType) continue;
      const collides = allNotes.some(
        n => n.tick === note.tick && n.type === targetType,
      );
      if (collides) continue;

      const flags: DrumNoteFlags = {...note.flags};
      if (targetType === 'kick') delete flags.cymbal;

      removeDrumNote(track, note.tick, note.type);
      const newNote: DrumNote = {
        tick: note.tick,
        type: targetType,
        length: note.length,
        flags,
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
 * Undo restores the pre-edit snapshot (`undoDocStack`) — a KEEP-MS remap
 * quantizes/nudges notes and is not invertible in closed form, so whole-doc
 * restore is the safe inverse (plan 0061 Risks), matching the other tempo
 * commands.
 */
export class AddBPMCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.tempo;
  readonly operations = OP.add;

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
    return refreshAnchorKeepMs(remapKeepMs(cloned, synctrackFromChart(chart)));
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
      remapKeepMs(cloned, synctrackFromChart(cloned.parsedChart)),
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
      remapKeepMs(cloned, synctrackFromChart(cloned.parsedChart)),
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
    // No leading-silence anchor active: commit the captured candidate
    // byte-identical (object identity — "no re-run, no drift" is a tested
    // contract of this command; see commit-tempo-candidate.test.ts).
    if (!anchor) return this.candidate;
    // The candidate was captured from a preview computed against `doc` at
    // preview time (`previewStructural`/`previewOctave` in the piano roll),
    // which may carry a stale or absent anchor — re-derive it from the LIVE
    // `doc` being committed against (audio position is the invariant; only
    // the tick needs a fresh map).
    return refreshAnchorKeepMs(setAudioAnchor(this.candidate, anchor));
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

  const timing = makeChartTiming(chart);
  const timeSignatures = derived.map(ts => {
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
 * Mark the beat nearest `tapTick` as a downbeat (0062 §8). The tap snaps to
 * the nearest denominator-scaled beat; a mid-bar mark produces a derived
 * meter change. No-op if the nearest beat is already a downbeat (or the chart
 * has no beats). Undo restores the pre-edit snapshot.
 */
export class MarkDownbeatCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.timesig;
  readonly operations = OP.update;

  /** `spanEndTick` is the piano-roll's audio-extended beat span (see
   *  {@link downbeatSpanEndTick}); omit it for callers with no audio view. */
  constructor(
    private tapTick: number,
    private spanEndTick?: number,
  ) {
    this.description = `Mark downbeat near tick ${tapTick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const chart = doc.parsedChart;
    const endTick = downbeatSpanEndTick(chart, this.spanEndTick);
    const beatTick = snapTickToNearestBeat(
      chart.timeSignatures,
      chart.resolution,
      endTick,
      this.tapTick,
    );
    if (beatTick == null) return doc;

    const flags = deriveDownbeatFlags(
      chart.timeSignatures,
      chart.resolution,
      endTick,
    );
    const newFlags = markDownbeat(flags, beatTick);
    if (!newFlags) return doc;

    return applyDownbeatFlags(doc, newFlags);
  }

}

/**
 * Remove the downbeat at `tick` (0062 §8). Beat 0 is never removable. No-op if
 * no downbeat exists there. Undo restores the pre-edit snapshot.
 */
export class UnmarkDownbeatCommand implements EditCommand {
  readonly description: string;
  readonly entityKinds = KIND.timesig;
  readonly operations = OP.update;

  /** `spanEndTick` is the piano-roll's audio-extended beat span (see
   *  {@link downbeatSpanEndTick}); omit it for callers with no audio view. */
  constructor(
    private tick: number,
    private spanEndTick?: number,
  ) {
    this.description = `Remove downbeat at tick ${tick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    if (this.tick === 0) return doc;
    const chart = doc.parsedChart;
    const flags = deriveDownbeatFlags(
      chart.timeSignatures,
      chart.resolution,
      downbeatSpanEndTick(chart, this.spanEndTick),
    );
    const newFlags = unmarkDownbeat(flags, this.tick);
    if (!newFlags) return doc;

    return applyDownbeatFlags(doc, newFlags);
  }

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
// BatchCommand
// ---------------------------------------------------------------------------

export class BatchCommand implements EditCommand {
  readonly description: string;
  /** Union of every member command's `entityKinds` — a batch is allowed
   *  only if the capability gate allows *every* kind any member touches. */
  readonly entityKinds: ReadonlySet<CommandEntityKind>;
  /** Union of every member command's `operations`, same rationale. */
  readonly operations: ReadonlySet<CommandOperation>;

  constructor(
    private commands: EditCommand[],
    description?: string,
  ) {
    this.description = description ?? `Batch: ${commands.length} command(s)`;
    const kinds = new Set<CommandEntityKind>();
    const ops = new Set<CommandOperation>();
    for (const cmd of commands) {
      for (const kind of cmd.entityKinds) kinds.add(kind);
      for (const op of cmd.operations) ops.add(op);
    }
    this.entityKinds = kinds;
    this.operations = ops;
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

/** Editor lane kick occupies. Kick isn't part of the pad-lane axis (it
 *  spans the full highway), so this lane is always excluded from the pad
 *  range below — derived from the schema, not assumed to be a fixed index. */
export const KICK_LANE = typeToLane('kick');

/** Every lane except kick's, in schema order. */
const PAD_LANE_INDICES = LANE_ORDER.map((_, i) => i).filter(
  i => i !== KICK_LANE,
);

/** First pad lane index — everything outside `[FIRST_PAD_LANE,
 *  LAST_PAD_LANE]` is kick. */
export const FIRST_PAD_LANE = Math.min(...PAD_LANE_INDICES);
/** Highest pad lane index. */
export const LAST_PAD_LANE = Math.max(...PAD_LANE_INDICES);

/** Map a lane index (0-4) to a DrumNoteType. */
export function laneToType(lane: number): DrumNoteType {
  return LANE_ORDER[Math.max(0, Math.min(LANE_ORDER.length - 1, lane))];
}

/**
 * Shift a note type by a lane delta among the pad lanes. Kick isn't part of
 * the lane axis (it spans the full highway), so kick never shifts and pads
 * clamp at the pad-lane boundaries. Pad ↔ kick conversion goes through
 * `ToggleKickCommand`.
 */
export function shiftLane(type: DrumNoteType, delta: number): DrumNoteType {
  const currentLane = typeToLane(type);
  if (currentLane < FIRST_PAD_LANE || currentLane > LAST_PAD_LANE) return type;
  const newLane = Math.max(
    FIRST_PAD_LANE,
    Math.min(LAST_PAD_LANE, currentLane + delta),
  );
  return laneToType(newLane);
}

/** Default flags for a new note in a given lane. Cymbal-by-default lanes
 *  come from the schema's `cymbal.appliesTo` binding. */
export function defaultFlagsForType(type: DrumNoteType): DrumNoteFlags {
  return CYMBAL_DEFAULT_TYPES.has(type) ? {cymbal: true} : {};
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
 * (`undoDocStack`) — the aligned syllables don't invert in closed form.
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
