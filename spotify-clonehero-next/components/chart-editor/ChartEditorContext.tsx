'use client';

import {
  createContext,
  useContext,
  useReducer,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import {HotkeysProvider} from '@tanstack/react-hotkeys';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {
  ChartDocument,
  DrumNote,
  DownbeatFlags,
  EntityKind,
  ParsedTrackData,
} from '@/lib/chart-edit';
import {chartEndTick, deriveDownbeatFlags, findTrack} from '@/lib/chart-edit';
import type {EditCommand, TempoGlueMode} from './commands';
import type {EditorCapabilities} from './capabilities';
import {DRUM_EDIT_CAPABILITIES} from './capabilities';
import type {HighwayMode} from '@/lib/preview/highway';
import type {SceneReconciler} from '@/lib/preview/highway/SceneReconciler';
import type {NoteRenderer} from '@/lib/preview/highway/NoteRenderer';
import type {EditorScope} from './scope';
import {DEFAULT_DRUMS_EXPERT_SCOPE, isTrackScope} from './scope';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolMode =
  | 'cursor'
  | 'place'
  | 'erase'
  | 'bpm'
  | 'timesig'
  | 'section';

/** Maximum number of undo entries before oldest are discarded. */
const UNDO_STACK_CAP = 200;

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
  /** Clipboard for copy/paste operations. */
  clipboard: DrumNote[];
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
  | {type: 'SET_CLIPBOARD'; notes: DrumNote[]}
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
  dispatch: React.Dispatch<ChartEditorAction>;
  audioManagerRef: RefObject<AudioManager | null>;
  /** Shared ref to the SceneReconciler for declarative element updates. */
  reconcilerRef: React.MutableRefObject<SceneReconciler | null>;
  /** Shared ref to the NoteRenderer for overlay state management. */
  noteRendererRef: React.MutableRefObject<NoteRenderer | null>;
  /** Per-page interaction profile. Set once at provider mount. */
  capabilities: EditorCapabilities;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

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
  clipboard: [],
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

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Recompute the downbeat-flag store from a doc's `timeSignatures` (0061 §3b
 * load direction). Called on every doc change so the store is always a pure
 * function of the chart — the "one store, incapable of desync" invariant.
 * A null doc (nothing loaded) keeps the tick-0 default.
 */
function computeDownbeatFlags(doc: ChartDocument | null): DownbeatFlags {
  if (!doc) return {downbeats: [{tick: 0, denominator: 4}]};
  const chart = doc.parsedChart;
  return deriveDownbeatFlags(
    chart.timeSignatures,
    chart.resolution,
    chartEndTick(chart),
  );
}

/** @internal — exported for unit tests in `__tests__/reducer.test.ts`. */
export function chartEditorReducer(
  state: ChartEditorState,
  action: ChartEditorAction,
): ChartEditorState {
  switch (action.type) {
    case 'SET_CHART_DOC':
      return {
        ...state,
        chartDoc: action.chartDoc,
        downbeatFlags: computeDownbeatFlags(action.chartDoc),
        // A chart (re)load resets the glue toggle to audio-glued (0062 §9,
        // deliberately not persisted) and drops any in-flight tempo preview.
        tempoGlueMode: 'audio',
        pendingTempoCandidate: null,
      };
    case 'SET_PLAYING':
      if (state.isPlaying === action.isPlaying) return state;
      return {...state, isPlaying: action.isPlaying};
    case 'SET_CURRENT_TIME':
      if (state.currentTimeMs === action.timeMs) return state;
      return {...state, currentTimeMs: action.timeMs};
    case 'SET_PLAYBACK_SPEED':
      return {...state, playbackSpeed: action.speed};
    case 'SET_ZOOM':
      return {...state, zoom: action.zoom};
    case 'SET_SELECTION': {
      const next = new Map(state.selection);
      const ids = action.ids instanceof Set ? action.ids : new Set(action.ids);
      if (ids.size === 0) {
        next.delete(action.kind);
      } else {
        next.set(action.kind, ids as Set<string>);
      }
      return {...state, selection: next};
    }
    case 'CLEAR_SELECTION':
      if (state.selection.size === 0) return state;
      return {...state, selection: new Map()};
    case 'SET_HOVER': {
      const next = action.hovered;
      const cur = state.hovered;
      // Reference equality fast-path: skip dispatch when nothing changed.
      if (
        cur === next ||
        (cur && next && cur.kind === next.kind && cur.id === next.id)
      ) {
        return state;
      }
      return {...state, hovered: next};
    }
    case 'SET_ACTIVE_TOOL':
      return {...state, activeTool: action.tool};
    case 'SET_GRID_DIVISION':
      return {...state, gridDivision: action.division};

    case 'EXECUTE_COMMAND': {
      // Save current chartDoc for undo
      const prevDoc = state.chartDoc;
      if (!prevDoc) return state;

      // Push to undo stack, cap at limit
      let newUndoStack = [...state.undoStack, action.command];
      let newUndoDocStack = [...state.undoDocStack, prevDoc];
      if (newUndoStack.length > UNDO_STACK_CAP) {
        newUndoStack = newUndoStack.slice(newUndoStack.length - UNDO_STACK_CAP);
        newUndoDocStack = newUndoDocStack.slice(
          newUndoDocStack.length - UNDO_STACK_CAP,
        );
      }

      return {
        ...state,
        chartDoc: action.chartDoc,
        downbeatFlags: computeDownbeatFlags(action.chartDoc),
        // An edit invalidates any in-flight tempo preview (0061 §7): the
        // candidate was derived from the pre-edit doc and rendering or
        // committing it now would desync the views from the undo stack.
        pendingTempoCandidate: null,
        dirty: true,
        undoStack: newUndoStack,
        undoDocStack: newUndoDocStack,
        // Clear redo stack on new edit (new branch)
        redoStack: [],
        redoDocStack: [],
      };
    }

    case 'UNDO': {
      if (state.undoStack.length === 0 || !state.chartDoc) return state;

      const undoneCommand = state.undoStack[state.undoStack.length - 1];

      // Check if we've returned to the saved state
      const newUndoDepth = state.undoStack.length - 1;
      const isDirty = newUndoDepth !== state.savedUndoDepth;

      return {
        ...state,
        chartDoc: action.chartDoc,
        downbeatFlags: computeDownbeatFlags(action.chartDoc),
        pendingTempoCandidate: null,
        dirty: isDirty,
        undoStack: state.undoStack.slice(0, -1),
        undoDocStack: state.undoDocStack.slice(0, -1),
        redoStack: [...state.redoStack, undoneCommand],
        redoDocStack: [...state.redoDocStack, state.chartDoc],
      };
    }

    case 'REDO': {
      if (state.redoStack.length === 0 || !state.chartDoc) return state;

      const redoneCommand = state.redoStack[state.redoStack.length - 1];

      const newUndoDepth = state.undoStack.length + 1;
      const isDirty = newUndoDepth !== state.savedUndoDepth;

      return {
        ...state,
        chartDoc: action.chartDoc,
        downbeatFlags: computeDownbeatFlags(action.chartDoc),
        pendingTempoCandidate: null,
        dirty: isDirty,
        undoStack: [...state.undoStack, redoneCommand],
        undoDocStack: [...state.undoDocStack, state.chartDoc],
        redoStack: state.redoStack.slice(0, -1),
        redoDocStack: state.redoDocStack.slice(0, -1),
      };
    }

    case 'MARK_SAVED':
      return {
        ...state,
        dirty: false,
        savedUndoDepth: state.undoStack.length,
      };

    case 'SET_CLIPBOARD':
      return {...state, clipboard: action.notes};

    case 'SET_TRACK_VOLUME': {
      return {
        ...state,
        trackVolumes: {...state.trackVolumes, [action.track]: action.volume},
      };
    }

    case 'SET_SOLO_TRACK':
      return {...state, soloTrack: action.track};

    case 'TOGGLE_MUTE_TRACK': {
      const newMuted = new Set(state.mutedTracks);
      if (newMuted.has(action.track)) {
        newMuted.delete(action.track);
      } else {
        newMuted.add(action.track);
      }
      return {...state, mutedTracks: newMuted};
    }

    case 'SET_MUTED_TRACKS':
      return {...state, mutedTracks: action.tracks};

    case 'SET_CURSOR_TICK':
      if (state.cursorTick === action.tick) return state;
      return {...state, cursorTick: Math.max(0, action.tick)};

    case 'SET_LOOP_REGION':
      return {...state, loopRegion: action.region};

    case 'SET_HIGHWAY_MODE':
      if (state.highwayMode === action.mode) return state;
      return {...state, highwayMode: action.mode};

    case 'SET_SHOW_SHEET_MUSIC':
      if (state.showSheetMusic === action.show) return state;
      return {...state, showSheetMusic: action.show};

    case 'SET_TEMPO_GLUE_MODE':
      if (state.tempoGlueMode === action.mode) return state;
      return {...state, tempoGlueMode: action.mode};

    case 'SET_PENDING_TEMPO_CANDIDATE':
      if (state.pendingTempoCandidate === action.candidate) return state;
      return {...state, pendingTempoCandidate: action.candidate};

    case 'SET_ACTIVE_SCOPE':
      if (state.activeScope === action.scope) return state;
      return {...state, activeScope: action.scope};

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ChartEditorContext = createContext<ChartEditorContextValue | null>(null);

export function ChartEditorProvider({
  children,
  capabilities = DRUM_EDIT_CAPABILITIES,
  activeScope = DEFAULT_DRUMS_EXPERT_SCOPE,
}: {
  children: ReactNode;
  capabilities?: EditorCapabilities;
  /** What the editor is editing. Pages pin this once at mount. */
  activeScope?: EditorScope;
}) {
  const [state, dispatch] = useReducer(chartEditorReducer, {
    ...initialState,
    activeScope,
  });
  const audioManagerRef = useRef<AudioManager | null>(null);
  const reconcilerRef = useRef<
    import('@/lib/preview/highway/SceneReconciler').SceneReconciler | null
  >(null);
  const noteRendererRef = useRef<
    import('@/lib/preview/highway/NoteRenderer').NoteRenderer | null
  >(null);

  return (
    <HotkeysProvider>
      <ChartEditorContext.Provider
        value={{
          state,
          dispatch,
          audioManagerRef,
          reconcilerRef,
          noteRendererRef,
          capabilities,
        }}>
        {children}
      </ChartEditorContext.Provider>
    </HotkeysProvider>
  );
}

export function useChartEditorContext(): ChartEditorContextValue {
  const ctx = useContext(ChartEditorContext);
  if (!ctx) {
    throw new Error(
      'useChartEditorContext must be used within a ChartEditorProvider',
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

const EMPTY_SET: ReadonlySet<string> = new Set();

/** Read the selection set for one entity kind. Always returns a stable empty
 *  set when the kind has no selection — never null. */
export function getSelectedIds(
  state: ChartEditorState,
  kind: EntityKind,
): ReadonlySet<string> {
  return state.selection.get(kind) ?? EMPTY_SET;
}

/** True when at least one entity of any kind is selected. */
export function isAnythingSelected(state: ChartEditorState): boolean {
  for (const set of state.selection.values()) {
    if (set.size > 0) return true;
  }
  return false;
}

/** First selected id of a kind, or null. Useful for kinds where the editor
 *  only ever holds one selected at a time (e.g. sections today). */
export function getFirstSelectedId(
  state: ChartEditorState,
  kind: EntityKind,
): string | null {
  const set = state.selection.get(kind);
  if (!set || set.size === 0) return null;
  for (const id of set) return id;
  return null;
}

// ---------------------------------------------------------------------------
// Scope selectors
// ---------------------------------------------------------------------------

/**
 * The chart document both views RENDER from (plan 0061 §7 — the one preview
 * channel). When a tempo gesture is uncommitted, `pendingTempoCandidate.doc`
 * is drawn in BOTH the highway and the piano-roll timeline; otherwise the
 * committed `chartDoc` is. Editing still targets the committed `chartDoc` — this
 * selector only chooses what is drawn, and both views call it so they can never
 * disagree about which doc is on screen.
 */
export function selectRenderDoc(state: ChartEditorState): ChartDocument | null {
  return state.pendingTempoCandidate?.doc ?? state.chartDoc;
}

/**
 * Resolve the `ParsedTrackData` slice referenced by `state.activeScope`.
 * Returns null when the scope is `vocals` / `global` or when the named
 * track doesn't exist in the document.
 */
export function selectActiveTrack(
  state: ChartEditorState,
): ParsedTrackData | null {
  const doc = state.chartDoc;
  if (!doc) return null;
  if (!isTrackScope(state.activeScope)) return null;
  return findTrack(doc, state.activeScope.track)?.track ?? null;
}
