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
  ParsedChart,
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
import {repredictTempo} from '@/lib/drum-transcription/pipeline/repredict';

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
  /** Notes as they were before execute(), for undo. */
  private originals: DrumNote[] = [];
  /** Notes as they exist after execute(), for undo removal. */
  private converted: DrumNote[] = [];

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

    const newDoc = cloneDocWithTracks(doc);
    const track = newDoc.parsedChart.trackData[idx];

    const idSet = new Set(this.noteIds);
    const allNotes = getDrumNotes(track);
    const selected = allNotes.filter(n => idSet.has(noteId(n)));
    if (selected.length === 0) return doc;

    const toKick = !selected.every(n => n.type === 'kick');
    this.originals = [];
    this.converted = [];

    for (const note of selected) {
      const targetType: DrumNoteType = toKick ? 'kick' : this.padType;
      if (note.type === targetType) continue;
      const collides = allNotes.some(
        n => n.tick === note.tick && n.type === targetType,
      );
      if (collides) continue;

      const flags: DrumNoteFlags = {...note.flags};
      if (targetType === 'kick') delete flags.cymbal;

      this.originals.push({...note, flags: {...note.flags}});
      removeDrumNote(track, note.tick, note.type);
      const newNote: DrumNote = {
        tick: note.tick,
        type: targetType,
        length: note.length,
        flags,
      };
      addDrumNote(track, newNote);
      this.converted.push({...newNote, flags: {...flags}});
    }

    return this.originals.length > 0 ? newDoc : doc;
  }

  undo(doc: ChartDocument): ChartDocument {
    const idx = findTargetIndex(doc, this.trackKey);
    if (idx === -1) return doc;

    const newDoc = cloneDocWithTracks(doc);
    const track = newDoc.parsedChart.trackData[idx];

    for (const note of this.converted) {
      removeDrumNote(track, note.tick, note.type);
    }
    for (const note of this.originals) {
      addDrumNote(track, {...note, flags: {...note.flags}});
    }
    return newDoc;
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
 * Undo restores the pre-edit snapshot — a KEEP-MS remap quantizes/nudges notes
 * and is not invertible in closed form, so whole-doc restore is the safe
 * inverse (plan 0061 Risks), matching the other tempo commands.
 */
export class AddBPMCommand implements EditCommand {
  readonly description: string;
  private prevDoc: ChartDocument | null = null;

  constructor(
    private tick: number,
    private bpm: number,
    private glue: TempoGlueMode,
  ) {
    this.description = `Add BPM ${bpm} at tick ${tick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    this.prevDoc = doc;
    const cloned = cloneDocForRetime(doc);
    const chart = cloned.parsedChart;
    const quantized = quantizeBpm(this.bpm, chart.format ?? 'chart');
    // Insert (or replace) the marker; leave msTime stale for the op below.
    chart.tempos = chart.tempos.filter(t => t.tick !== this.tick);
    chart.tempos.push({tick: this.tick, beatsPerMinute: quantized, msTime: 0});
    chart.tempos.sort((a, b) => a.tick - b.tick);

    if (this.glue === 'grid') {
      // KEEP-TICKS: notes keep ticks, ride the moving grid.
      retimeChart(chart);
      return cloned;
    }
    // KEEP-MS: the cloned notes still carry their pre-edit msTime (nothing has
    // retimed them), so swapSynctrack re-ticks them onto the corrected grid.
    return remapKeepMs(cloned, synctrackFromChart(chart));
  }

  undo(doc: ChartDocument): ChartDocument {
    return this.prevDoc ?? doc;
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
 * builds a fresh chart via `swapSynctrack`). Notes are cloned by
 * `cloneDocWithTracks`; this adds the section/vocal/end arrays.
 */
function cloneDocForRetime(doc: ChartDocument): ChartDocument {
  const cloned = cloneDocWithTracks(doc);
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
  private prevDoc: ChartDocument | null = null;

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

    this.prevDoc = doc;
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
      return cloned;
    }
    // KEEP-MS: the cloned notes still carry their pre-edit msTime (nothing has
    // retimed them), so swapSynctrack re-ticks them onto the corrected grid.
    return remapKeepMs(cloned, synctrackFromChart(cloned.parsedChart));
  }

  undo(doc: ChartDocument): ChartDocument {
    return this.prevDoc ?? doc;
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
  private prevDoc: ChartDocument | null = null;

  constructor(private tick: number) {
    this.description = `Add tempo marker at tick ${tick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    const tempos = doc.parsedChart.tempos;
    if (tempos.some(t => t.tick === this.tick)) return doc;

    this.prevDoc = doc;
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
    return cloned;
  }

  undo(doc: ChartDocument): ChartDocument {
    return this.prevDoc ?? doc;
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
  private prevDoc: ChartDocument | null = null;

  constructor(
    private tick: number,
    private glue: TempoGlueMode,
  ) {
    this.description = `Delete tempo marker at tick ${tick}`;
  }

  execute(doc: ChartDocument): ChartDocument {
    if (this.tick === 0) return doc;
    if (!doc.parsedChart.tempos.some(t => t.tick === this.tick)) return doc;

    this.prevDoc = doc;
    const cloned = cloneDocForRetime(doc);
    cloned.parsedChart.tempos = cloned.parsedChart.tempos.filter(
      t => t.tick !== this.tick,
    );

    if (this.glue === 'grid') {
      retimeChart(cloned.parsedChart);
      return cloned;
    }
    return remapKeepMs(cloned, synctrackFromChart(cloned.parsedChart));
  }

  undo(doc: ChartDocument): ChartDocument {
    return this.prevDoc ?? doc;
  }
}

// ---------------------------------------------------------------------------
// Structural tempo correction — RE-PREDICT (plan 0061 §3 class (b) / §7)
// ---------------------------------------------------------------------------

/**
 * Commit a class-(b) structural tempo correction (half/double flip, tap-tempo
 * fit) via RE-PREDICT (plan 0061 §3/§7). Given the caller's structurally-
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
  private prevDoc: ChartDocument | null = null;
  /** Set after execute: whether the op fell back to RESNAP (no decoded
   * onsets). The UI reads this to surface the disclosure (plan 0061 §3a). */
  usedResnapFallback = false;

  constructor(
    private correctedSync: Synctrack,
    private onsets: DecodedOnsetsFile | null,
  ) {}

  execute(doc: ChartDocument): ChartDocument {
    this.prevDoc = doc;
    const result = repredictTempo(doc, this.correctedSync, this.onsets);
    this.usedResnapFallback = result.usedResnapFallback;
    return result.doc;
  }

  undo(doc: ChartDocument): ChartDocument {
    return this.prevDoc ?? doc;
  }
}

/**
 * Commit an already-computed tempo candidate exactly (plan 0061 §7's
 * "accept-or-reject IS the guard" interactive path). The half/double + tap-tempo
 * control runs the RE-PREDICT op ONCE up front and previews the resulting
 * `ChartDocument` via `pendingTempoCandidate`; accepting must commit *that same
 * document* — not re-run the op and risk any drift between what the user
 * evaluated and what lands. So `execute` returns the captured candidate
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
  private prevDoc: ChartDocument | null = null;

  constructor(private candidate: ChartDocument) {}

  execute(doc: ChartDocument): ChartDocument {
    this.prevDoc = doc;
    return this.candidate;
  }

  undo(doc: ChartDocument): ChartDocument {
    return this.prevDoc ?? doc;
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
  private prevDoc: ChartDocument | null = null;

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

    this.prevDoc = doc;
    return applyDownbeatFlags(doc, newFlags);
  }

  undo(doc: ChartDocument): ChartDocument {
    return this.prevDoc ?? doc;
  }
}

/**
 * Remove the downbeat at `tick` (0062 §8). Beat 0 is never removable. No-op if
 * no downbeat exists there. Undo restores the pre-edit snapshot.
 */
export class UnmarkDownbeatCommand implements EditCommand {
  readonly description: string;
  private prevDoc: ChartDocument | null = null;

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

    this.prevDoc = doc;
    return applyDownbeatFlags(doc, newFlags);
  }

  undo(doc: ChartDocument): ChartDocument {
    return this.prevDoc ?? doc;
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
  private prevDoc: ChartDocument | null = null;

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

    this.prevDoc = doc;
    return applyDownbeatFlags(doc, newFlags);
  }

  undo(doc: ChartDocument): ChartDocument {
    return this.prevDoc ?? doc;
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

/** Highest pad lane index (kick is lane 0; pads are 1..LAST_PAD_LANE). */
export const LAST_PAD_LANE = LANE_ORDER.length - 1;

/** Map a lane index (0-4) to a DrumNoteType. */
export function laneToType(lane: number): DrumNoteType {
  return LANE_ORDER[Math.max(0, Math.min(LANE_ORDER.length - 1, lane))];
}

/**
 * Shift a note type by a lane delta among the pad lanes. Kick isn't part of
 * the lane axis (it spans the full highway), so kick never shifts and pads
 * clamp at the first pad lane. Pad ↔ kick conversion goes through
 * `ToggleKickCommand`.
 */
export function shiftLane(type: DrumNoteType, delta: number): DrumNoteType {
  const currentLane = typeToLane(type);
  if (currentLane <= 0) return type;
  const newLane = Math.max(
    1,
    Math.min(LANE_ORDER.length - 1, currentLane + delta),
  );
  return laneToType(newLane);
}

/** Default flags for a new note in a given lane. Cymbal-by-default lanes
 *  come from the schema's `cymbal.appliesTo` binding. */
export function defaultFlagsForType(type: DrumNoteType): DrumNoteFlags {
  return CYMBAL_DEFAULT_TYPES.has(type) ? {cymbal: true} : {};
}
