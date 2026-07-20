import type {ChartDocument, DownbeatFlags} from '@/lib/chart-edit';
import {chartEndTick, deriveDownbeatFlags} from '@/lib/chart-edit';
import type {ChartEditorAction, ChartEditorState} from './state';
import {UNDO_STACK_CAP} from './state';

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
