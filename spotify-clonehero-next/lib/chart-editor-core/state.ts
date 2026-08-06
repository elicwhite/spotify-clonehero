import type {Dispatch} from 'react';
import type {
  ChartDocument,
  DownbeatFlags,
  EntityKind,
  SelectableKind,
} from '@/lib/chart-edit';
import type {
  EditCommand,
  TempoGlueMode,
} from '@/components/chart-editor/commands';
import type {TrackKeyId} from './trackInventory';
import type {EditorCapabilities} from '@/components/chart-editor/capabilities';
import type {HighwayMode} from '@/lib/preview/highway';
import type {LoopRegion} from '@/lib/preview/loopRegion';
import type {EditorScope} from '@/components/chart-editor/scope';
import type {EditorClipboard} from './clipboard';
import {EMPTY_STAMP, type AssistProvenance} from './content-stamps';
import type {TrackKey} from '@/lib/chart-edit';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '@/components/chart-editor/scope';

/**
 * The highway's pointer modes. Tempo and time-signature editing is not among
 * them: those are edited in the piano roll's tempo lane and ruler, not on the
 * highway. `activeTool` is runtime-only state seeded to `'cursor'` and never
 * persisted, so no stored value can carry a mode that no longer exists.
 */
export const TOOL_MODES = ['cursor', 'place', 'erase'] as const;

export type ToolMode = (typeof TOOL_MODES)[number];

/** Maximum number of undo entries before oldest are discarded. */
export const UNDO_STACK_CAP = 200;

/**
 * One reversible step: the command that ran, the `ChartDocument` as it was
 * before it ran, and the `visibleTrackKeys` as they were before it ran.
 *
 * Kept as one record rather than parallel stacks so the three cannot fall out
 * of alignment — there is no index to keep in step and no "what if this array
 * is shorter" case to defend against. The doc snapshot is what makes undo
 * snapshot replay instead of command inversion; the visibility snapshot is
 * what makes undo restore the rows that were on screen, since visibility is
 * separate state that a doc-changing command (a delete, and the reducer's
 * at-least-one-visible repair) can move on its own.
 */
export interface UndoEntry {
  command: EditCommand;
  doc: ChartDocument;
  visible: ReadonlySet<string>;
}

/**
 * A tempo-map edit's uncommitted result, rendered as a preview overlay (plan
 * 0061 §7 "Panel hosting contract"). This is the ONE preview channel for all
 * tempo gestures — a class-(a) marker drag in flight (0062 §7) and the §7
 * half/double control both flow through it. When non-null, both the highway
 * and the piano-roll timeline render from `doc` instead of `state.chartDoc`.
 * It is invalidated (cleared) before any command dispatch / undo / redo /
 * chart reload proceeds, since it's derived from a `chartDoc` about to change.
 */
export interface PendingTempoCandidate {
  /** Which op produced the candidate. Phase 62-3 only produces the class-(a)
   *  marker-drag ops; 're-predict'/'resnap' arrive with plan 0061 §7. */
  op: 're-predict' | 'resnap' | 'keep-ms' | 'keep-ticks';
  /** The full candidate ChartDocument produced by the op — NOT yet committed. */
  doc: ChartDocument;
}

export interface ChartEditorState {
  /**
   * Editable chart document — source of truth for both editing and
   * rendering. `chartDoc.parsedChart` is the fully-derived parsed chart
   * (HOPOs, chord flags, section ms times, etc.); commands re-parse on
   * apply so this stays consistent with the writer's output. Consumers
   * use {@link selectActiveTrack} to resolve the scoped track.
   */
  chartDoc: ChartDocument | null;

  /**
   * Downbeat-flag store (plan 0061 §3b) — the canonical source of truth for
   * bar structure. Derived from `chartDoc.parsedChart.timeSignatures` on every
   * doc change (load, command, undo, redo) via the denominator-aware
   * derivation module, so it can never disagree with the persisted chart. Bar
   * lines, bar numbering, the bar.beat readout, and the TS chips all render
   * from this; the mark/unmark and phase-rotation commands mutate it and
   * re-derive `timeSignatures` in one command. Always holds a tick-0 entry.
   */
  downbeatFlags: DownbeatFlags;

  /**
   * Note-anchoring mode for class-(a) tempo hand-edits (0062 §9). It is edit
   * semantics — it selects which op a tempo-marker command runs (`'audio'` →
   * KEEP-MS, `'grid'` → KEEP-TICKS) — so it lives on the store, not on the
   * panel: any view that dispatches a tempo command must resolve it
   * identically, and the command reads it at dispatch. **Not persisted** — it
   * resets to `'audio'` on every chart load (a mode saved from a prior session
   * would silently move transcribed notes off the audio).
   */
  tempoGlueMode: TempoGlueMode;

  /**
   * In-flight tempo-gesture preview (0061 §7). Null when no tempo gesture is
   * uncommitted; while a marker drag is live it holds the candidate doc both
   * views render from. See {@link PendingTempoCandidate}.
   */
  pendingTempoCandidate: PendingTempoCandidate | null;

  /**
   * What the editor is currently editing. Defaults to
   * `DEFAULT_DRUMS_EXPERT_SCOPE`; consumer pages override it explicitly via
   * the `<ChartEditorProvider activeScope={...}>` prop.
   */
  activeScope: EditorScope;

  /** Whether audio is currently playing. */
  isPlaying: boolean;
  /** Current playback position in milliseconds. */
  currentTimeMs: number;
  /** Playback speed multiplier (e.g. 0.5, 1.0, 1.5). */
  playbackSpeed: number;

  /** Zoom level for sheet music and waveform. */
  zoom: number;

  // -- Editing state --

  /**
   * Per-kind selection. Each set holds opaque ids whose format is defined
   * by the corresponding `EntityKindHandler` in `chart-edit`, or (for the
   * handler-less `'tempo'`/`'timesig'` kinds) is `String(tick)`. Use the
   * `getSelectedIds` / `isAnythingSelected` helpers to read.
   *
   * Keyed by `SelectableKind`, not `EntityKind`: the piano roll's marquee
   * can sweep tempo markers and time-signature chips into the selection
   * alongside notes, sections and lyrics. Consumers that only understand
   * the reconciler's kinds (`useChartElements`' selection push) must filter
   * rather than assume every key is an `EntityKind`.
   */
  selection: Map<SelectableKind, Set<string>>;
  /**
   * Single-entity hover anchor — what the cursor (or active drag) is
   * pinned to. Source of truth for the reconciler's `setHoveredKey` push;
   * mouse handlers dispatch SET_HOVER on movement, drag begin pins it to
   * the dragged entity, drag end relinquishes back to the next mousemove.
   *
   * Null when nothing is hovered. The id format matches the per-kind
   * selection-store id (see `getSelectedIds`); a single utility translates
   * to reconciler keys (`reconcilerKeyFor`) at the push effect.
   */
  hovered: {kind: EntityKind; id: string} | null;
  /** Active tool mode. */
  activeTool: ToolMode;
  /** Grid division for snapping. 0 = free (no snap). */
  gridDivision: number;
  /** Whether the chart has unsaved modifications. */
  dirty: boolean;

  // -- Undo/Redo --

  /** Reversible steps, most recent last. Popping one restores everything the
   *  step needs — see {@link UndoEntry}. */
  undoEntries: UndoEntry[];
  /** Undone steps, most recent last; redo pops from here. */
  redoEntries: UndoEntry[];
  /**
   * Clipboard for copy/paste operations. Notes are schema-typed
   * (`SchemaNote` — raw scan-chart `NoteType` + flag bitmask, not the
   * drums-only `DrumNote` facade) and tagged with the scope they were copied
   * from, so paste can translate lane-by-lane into the *target* scope's
   * `InstrumentSchema` (`translateSchemaNote`) instead of assuming the
   * source and destination tracks share a schema. See {@link EditorClipboard}
   * for the anchor-relative units notes and lyrics are stored in. Null when
   * nothing has been copied yet.
   */
  clipboard: EditorClipboard | null;
  /** Depth of undo stack when the last save occurred. */
  savedUndoDepth: number;

  /** Track rows shown in the stacked piano roll and as highway panes on
   *  surfaces that ship the Chart Matrix (`capabilities.showChartMatrix`);
   *  the matrix is the only thing that writes it, and surfaces without one
   *  render `activeScope` instead. Only ever names tracks the loaded doc
   *  contains — the reducer reconciles every write against `chartDoc`. */
  visibleTrackKeys: ReadonlySet<string>;

  // -- Cursor --

  /** Current cursor position in ticks (editing position, independent of playback). */
  cursorTick: number;

  // -- Loop region --

  /** A-B loop region in chart-relative milliseconds. null = no loop. */
  loopRegion: LoopRegion | null;

  /** Highway display mode: 'classic' (texture) or 'waveform' (audio waveform surface). */
  highwayMode: HighwayMode;

  /**
   * Whether the sheet-music notation pane renders beside the highway.
   * The inverse of /sheet-music's viewCloneHero toggle: here the highway
   * is always shown and notation is the optional pane.
   */
  showSheetMusic: boolean;

  // -- Staleness (plan 0074 Design C) --

  /**
   * Per-track content stamp (`content-stamps.ts`), keyed by `trackKeyId`.
   * Recomputed for exactly the tracks named in a command's `affectedTracks`
   * on `EXECUTE_COMMAND` (everything else carried over unchanged); fully
   * recomputed from the restored doc on `UNDO`/`REDO`/`SET_CHART_DOC`.
   * Compared against `assistProvenance.difficulties[instrument].sourceStamp`
   * to detect difficulty staleness.
   */
  trackStamps: Readonly<Record<TrackKeyId, string>>;

  /**
   * Content stamp of the tempo map (`content-stamps.ts`), recomputed
   * whenever an executed command's `entityKinds` includes `tempo` or
   * `timesig`, and fully recomputed on `UNDO`/`REDO`/`SET_CHART_DOC`.
   * Compared against `assistProvenance.drumTranscription.tempoStamp` to
   * detect drum-transcription staleness.
   */
  tempoStamp: string;
}

export type ChartEditorAction =
  | {type: 'SET_CHART_DOC'; chartDoc: ChartDocument}
  | {type: 'SET_PLAYING'; isPlaying: boolean}
  | {type: 'SET_CURRENT_TIME'; timeMs: number}
  | {type: 'SET_PLAYBACK_SPEED'; speed: number}
  | {type: 'SET_ZOOM'; zoom: number}
  /** Replace the selection set for one entity kind. */
  | {type: 'SET_SELECTION'; kind: SelectableKind; ids: ReadonlySet<string>}
  /**
   * Replace several kinds' selection sets in one dispatch. The piano roll's
   * marquee updates up to seven kinds per pointer-move; sending them as one
   * action keeps that a single re-render, and the reducer returns the same
   * state object when no kind's set actually changed, so a marquee dragged
   * across empty space costs nothing.
   */
  | {
      type: 'SET_SELECTION_MULTI';
      selection: Partial<Record<SelectableKind, ReadonlySet<string>>>;
    }
  /** Clear selection across all entity kinds. */
  | {type: 'CLEAR_SELECTION'}
  /** Set the single hovered entity (or null to clear). */
  | {type: 'SET_HOVER'; hovered: {kind: EntityKind; id: string} | null}
  | {type: 'SET_ACTIVE_TOOL'; tool: ToolMode}
  | {type: 'SET_GRID_DIVISION'; division: number}
  | {
      type: 'EXECUTE_COMMAND';
      command: EditCommand;
      /** Updated chart document (with re-parsed parsedChart) after apply. */
      chartDoc: ChartDocument;
    }
  /**
   * Replace the doc's `assistProvenance` bag without touching the undo or
   * redo stacks (plan 0074 Design C). Used for "Keep as-is" acknowledgments:
   * a dismissal is a UI decision about a recommendation, not a chart edit,
   * so routing it through `EXECUTE_COMMAND` would push a bogus "Update
   * assist provenance" entry onto the undo stack and — worse — discard the
   * user's redo branch. Generation provenance still rides its generating
   * command (`ReplaceDrumTrackCommand`), which is what makes undo remove a
   * generated track and its provenance together.
   */
  | {type: 'SET_ASSIST_PROVENANCE'; provenance: AssistProvenance}
  /**
   * The song-details dialog's save: a doc whose `song.ini` metadata (and the
   * drum recommendation's provenance) differ from the current one. Not
   * `SET_CHART_DOC`, which means "a different chart is now open" and reseeds
   * track selection, scope and every content stamp — none of which this edit
   * touches, since it changes no note, tempo or section.
   */
  | {type: 'SET_CHART_METADATA'; chartDoc: ChartDocument}
  // -- Undo/Redo --
  | {type: 'UNDO'; chartDoc: ChartDocument}
  | {type: 'REDO'; chartDoc: ChartDocument}
  | {type: 'MARK_SAVED'}
  // -- Clipboard --
  | {
      type: 'SET_CLIPBOARD';
      clipboard: EditorClipboard | null;
    }
  | {type: 'SET_TRACK_VISIBILITY'; track: TrackKey; visible: boolean}
  | {type: 'SET_VISIBLE_TRACKS'; tracks: ReadonlySet<string>}
  // -- Cursor --
  | {type: 'SET_CURSOR_TICK'; tick: number}
  // -- Loop --
  | {type: 'SET_LOOP_REGION'; region: LoopRegion | null}
  // -- Highway mode --
  | {type: 'SET_HIGHWAY_MODE'; mode: HighwayMode}
  // -- Sheet music pane --
  | {type: 'SET_SHOW_SHEET_MUSIC'; show: boolean}
  // -- Tempo editing (0062 §7/§9) --
  | {type: 'SET_TEMPO_GLUE_MODE'; mode: TempoGlueMode}
  | {
      type: 'SET_PENDING_TEMPO_CANDIDATE';
      candidate: PendingTempoCandidate | null;
    }
  // -- Scope --
  | {type: 'SET_ACTIVE_SCOPE'; scope: EditorScope};

/**
 * The editor's shared state + dispatch. Renderer handles are deliberately
 * absent: each highway pane owns its own `SceneReconciler`/`NoteRenderer`
 * and passes them to its own hooks, so there is no single renderer for the
 * context to name (plan 0074 Phase 3).
 */
export interface ChartEditorContextValue {
  state: ChartEditorState;
  dispatch: Dispatch<ChartEditorAction>;
  /** Per-page interaction profile. Set once at provider mount. */
  capabilities: EditorCapabilities;
}

/** @internal — exported for unit tests. */
export const initialState: ChartEditorState = {
  chartDoc: null,
  downbeatFlags: {downbeats: [{tick: 0, denominator: 4}]},
  tempoGlueMode: 'audio',
  pendingTempoCandidate: null,
  activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
  isPlaying: false,
  currentTimeMs: 0,
  playbackSpeed: 1.0,
  zoom: 1.0,
  selection: new Map(),
  hovered: null,
  activeTool: 'cursor',
  // 1/16: the finest division most charts are written on, so the default
  // lands notes where they belong without a trip to the snap control.
  gridDivision: 16,
  dirty: false,
  // Undo/Redo
  undoEntries: [],
  redoEntries: [],
  clipboard: null,
  savedUndoDepth: 0,
  visibleTrackKeys: new Set(),
  // Cursor
  cursorTick: 0,
  // Loop
  loopRegion: null,
  // Highway mode
  highwayMode: 'classic' as HighwayMode,
  // Sheet music pane
  showSheetMusic: false,
  // Staleness
  trackStamps: {},
  tempoStamp: EMPTY_STAMP,
};
