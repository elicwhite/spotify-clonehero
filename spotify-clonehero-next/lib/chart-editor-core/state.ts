import type {Dispatch, MutableRefObject} from 'react';
import type {ChartDocument, DownbeatFlags, EntityKind} from '@/lib/chart-edit';
import type {
  EditCommand,
  SchemaNote,
  TempoGlueMode,
} from '@/components/chart-editor/commands';
import type {EditorCapabilities} from '@/components/chart-editor/capabilities';
import type {HighwayMode} from '@/lib/preview/highway';
import type {SceneReconciler} from '@/lib/preview/highway/SceneReconciler';
import type {NoteRenderer} from '@/lib/preview/highway/NoteRenderer';
import type {EditorScope} from '@/components/chart-editor/scope';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '@/components/chart-editor/scope';

export type ToolMode =
  | 'cursor'
  | 'place'
  | 'erase'
  | 'bpm'
  | 'timesig'
  | 'section';

/** Maximum number of undo entries before oldest are discarded. */
export const UNDO_STACK_CAP = 200;

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
   * Per-entity-kind selection. Each set holds opaque ids whose format is
   * defined by the corresponding `EntityKindHandler` in `chart-edit`. Use
   * the `getSelectedIds` / `isAnythingSelected` helpers to read.
   */
  selection: Map<EntityKind, Set<string>>;
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

  /** Stack of executed commands, most recent last. */
  undoStack: EditCommand[];
  /** Stack of undone commands, most recent last. */
  redoStack: EditCommand[];
  /** Copy of chart doc snapshots for each undo/redo step. */
  undoDocStack: ChartDocument[];
  /** Copy of chart doc snapshots for redo. */
  redoDocStack: ChartDocument[];
  /**
   * Clipboard for copy/paste operations (plan 0037 Task 6). Schema-typed
   * (`SchemaNote` — raw scan-chart `NoteType` + flag bitmask, not the
   * drums-only `DrumNote` facade) and tagged with the scope it was copied
   * from, so paste can translate lane-by-lane into the *target* scope's
   * `InstrumentSchema` (`translateSchemaNote`) instead of assuming the
   * source and destination tracks share a schema. Null when nothing has
   * been copied yet.
   */
  clipboard: {notes: SchemaNote[]; sourceScope: EditorScope} | null;
  /** Depth of undo stack when the last save occurred. */
  savedUndoDepth: number;

  // -- Audio mixing --

  /** Per-track volume levels (0-1). */
  trackVolumes: Record<string, number>;
  /** Track name that is currently soloed (only this track is heard). */
  soloTrack: string | null;
  /** Set of track names that are muted. */
  mutedTracks: Set<string>;

  // -- Cursor --

  /** Current cursor position in ticks (editing position, independent of playback). */
  cursorTick: number;

  // -- Loop region --

  /** A-B loop region in milliseconds. null = no loop. */
  loopRegion: {startMs: number; endMs: number} | null;

  /** Highway display mode: 'classic' (texture) or 'waveform' (audio waveform surface). */
  highwayMode: HighwayMode;

  /**
   * Whether the sheet-music notation pane renders beside the highway.
   * The inverse of /sheet-music's viewCloneHero toggle: here the highway
   * is always shown and notation is the optional pane.
   */
  showSheetMusic: boolean;
}

export type ChartEditorAction =
  | {type: 'SET_CHART_DOC'; chartDoc: ChartDocument}
  | {type: 'SET_PLAYING'; isPlaying: boolean}
  | {type: 'SET_CURRENT_TIME'; timeMs: number}
  | {type: 'SET_PLAYBACK_SPEED'; speed: number}
  | {type: 'SET_ZOOM'; zoom: number}
  /** Replace the selection set for one entity kind. */
  | {type: 'SET_SELECTION'; kind: EntityKind; ids: ReadonlySet<string>}
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
  // -- Undo/Redo --
  | {type: 'UNDO'; chartDoc: ChartDocument}
  | {type: 'REDO'; chartDoc: ChartDocument}
  | {type: 'MARK_SAVED'}
  // -- Clipboard --
  | {
      type: 'SET_CLIPBOARD';
      clipboard: {notes: SchemaNote[]; sourceScope: EditorScope} | null;
    }
  // -- Audio mixing --
  | {type: 'SET_TRACK_VOLUME'; track: string; volume: number}
  | {type: 'SET_SOLO_TRACK'; track: string | null}
  | {type: 'TOGGLE_MUTE_TRACK'; track: string}
  | {type: 'SET_MUTED_TRACKS'; tracks: Set<string>}
  // -- Cursor --
  | {type: 'SET_CURSOR_TICK'; tick: number}
  // -- Loop --
  | {type: 'SET_LOOP_REGION'; region: {startMs: number; endMs: number} | null}
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

export interface ChartEditorContextValue {
  state: ChartEditorState;
  dispatch: Dispatch<ChartEditorAction>;
  /** Shared ref to the SceneReconciler for declarative element updates. */
  reconcilerRef: MutableRefObject<SceneReconciler | null>;
  /** Shared ref to the NoteRenderer for overlay state management. */
  noteRendererRef: MutableRefObject<NoteRenderer | null>;
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
  gridDivision: 4,
  dirty: false,
  // Undo/Redo
  undoStack: [],
  redoStack: [],
  undoDocStack: [],
  redoDocStack: [],
  clipboard: null,
  savedUndoDepth: 0,
  // Audio mixing
  trackVolumes: {},
  soloTrack: null,
  mutedTracks: new Set(),
  // Cursor
  cursorTick: 0,
  // Loop
  loopRegion: null,
  // Highway mode
  highwayMode: 'classic' as HighwayMode,
  // Sheet music pane
  showSheetMusic: false,
};
