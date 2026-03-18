'use client';

import {
  createContext,
  useContext,
  useReducer,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import {parseChartFile} from '@eliwhite/scan-chart';
import type {AudioManager} from '@/lib/preview/audioManager';
import type WaveSurfer from 'wavesurfer.js';
import type {ChartDocument, DrumNote} from '@/lib/drum-transcription/chart-io/types';
import type {EditCommand} from '../commands';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ParsedChart = ReturnType<typeof parseChartFile>;

export type ToolMode = 'cursor' | 'place' | 'erase' | 'bpm' | 'timesig';

/** Maximum number of undo entries before oldest are discarded. */
const UNDO_STACK_CAP = 200;

export interface EditorState {
  /** Parsed chart data (for rendering -- derived from chartDoc). */
  chart: ParsedChart | null;
  /** The active drum track from the parsed chart. */
  track: ParsedChart['trackData'][0] | null;

  /** The editable chart document (source of truth for editing). */
  chartDoc: ChartDocument | null;

  /** Whether audio is currently playing. */
  isPlaying: boolean;
  /** Current playback position in milliseconds. */
  currentTimeMs: number;
  /** Playback speed multiplier (e.g. 0.5, 1.0, 1.5). */
  playbackSpeed: number;

  /** Zoom level for sheet music and waveform. */
  zoom: number;

  // -- Editing state (0007a) --

  /** IDs of selected notes (composite key: `${tick}:${type}`). */
  selectedNoteIds: Set<string>;
  /** Active tool mode. */
  activeTool: ToolMode;
  /** Grid division for snapping. 0 = free (no snap). */
  gridDivision: number;
  /** Whether the chart has unsaved modifications. */
  dirty: boolean;

  // -- Undo/Redo (0007b) --

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

  // -- Confidence (0007b) --

  /** Confidence scores for notes, keyed by noteId (tick:type). */
  confidence: Map<string, number>;
  /** Whether to show confidence overlay on notes. */
  showConfidence: boolean;
  /** Threshold below which notes are flagged as low-confidence. */
  confidenceThreshold: number;

  // -- Review (0007b) --

  /** Set of note IDs that have been reviewed by the user. */
  reviewedNoteIds: Set<string>;

  // -- Audio mixing (0007b) --

  /** Per-track volume levels (0-1). */
  trackVolumes: Record<string, number>;
  /** Track name that is currently soloed (only this track is heard). */
  soloTrack: string | null;
  /** Set of track names that are muted. */
  mutedTracks: Set<string>;

  // -- Loop region (0007b) --

  /** A-B loop region in milliseconds. null = no loop. */
  loopRegion: {startMs: number; endMs: number} | null;
}

export type EditorAction =
  | {type: 'SET_CHART'; chart: ParsedChart; track: ParsedChart['trackData'][0]}
  | {type: 'SET_CHART_DOC'; chartDoc: ChartDocument}
  | {type: 'SET_PLAYING'; isPlaying: boolean}
  | {type: 'SET_CURRENT_TIME'; timeMs: number}
  | {type: 'SET_PLAYBACK_SPEED'; speed: number}
  | {type: 'SET_ZOOM'; zoom: number}
  | {type: 'SET_SELECTED_NOTES'; noteIds: Set<string>}
  | {type: 'SET_ACTIVE_TOOL'; tool: ToolMode}
  | {type: 'SET_GRID_DIVISION'; division: number}
  | {
      type: 'EXECUTE_COMMAND';
      command: EditCommand;
      /** Re-parsed chart after the command was applied. */
      chart: ParsedChart;
      /** Updated chart document after the command was applied. */
      chartDoc: ChartDocument;
    }
  // -- Undo/Redo --
  | {type: 'UNDO'; chart: ParsedChart; chartDoc: ChartDocument}
  | {type: 'REDO'; chart: ParsedChart; chartDoc: ChartDocument}
  | {type: 'MARK_SAVED'}
  // -- Clipboard --
  | {type: 'SET_CLIPBOARD'; notes: DrumNote[]}
  // -- Confidence --
  | {type: 'SET_CONFIDENCE'; confidence: Map<string, number>}
  | {type: 'SET_SHOW_CONFIDENCE'; show: boolean}
  | {type: 'SET_CONFIDENCE_THRESHOLD'; threshold: number}
  // -- Review --
  | {type: 'MARK_REVIEWED'; noteIds: string[]}
  | {type: 'SET_REVIEWED_NOTES'; noteIds: Set<string>}
  // -- Audio mixing --
  | {type: 'SET_TRACK_VOLUME'; track: string; volume: number}
  | {type: 'SET_SOLO_TRACK'; track: string | null}
  | {type: 'TOGGLE_MUTE_TRACK'; track: string}
  | {type: 'SET_MUTED_TRACKS'; tracks: Set<string>}
  // -- Loop --
  | {type: 'SET_LOOP_REGION'; region: {startMs: number; endMs: number} | null};

export interface EditorContextValue {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  audioManagerRef: RefObject<AudioManager | null>;
  wavesurferRef: RefObject<WaveSurfer | null>;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: EditorState = {
  chart: null,
  track: null,
  chartDoc: null,
  isPlaying: false,
  currentTimeMs: 0,
  playbackSpeed: 1.0,
  zoom: 1.0,
  selectedNoteIds: new Set(),
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
  // Confidence
  confidence: new Map(),
  showConfidence: true,
  confidenceThreshold: 0.7,
  // Review
  reviewedNoteIds: new Set(),
  // Audio mixing
  trackVolumes: {},
  soloTrack: null,
  mutedTracks: new Set(),
  // Loop
  loopRegion: null,
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'SET_CHART':
      return {...state, chart: action.chart, track: action.track};
    case 'SET_CHART_DOC':
      return {...state, chartDoc: action.chartDoc};
    case 'SET_PLAYING':
      return {...state, isPlaying: action.isPlaying};
    case 'SET_CURRENT_TIME':
      return {...state, currentTimeMs: action.timeMs};
    case 'SET_PLAYBACK_SPEED':
      return {...state, playbackSpeed: action.speed};
    case 'SET_ZOOM':
      return {...state, zoom: action.zoom};
    case 'SET_SELECTED_NOTES':
      return {...state, selectedNoteIds: action.noteIds};
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
        newUndoDocStack = newUndoDocStack.slice(newUndoDocStack.length - UNDO_STACK_CAP);
      }

      const newTrack = action.chart.trackData.find(
        t => t.instrument === 'drums' && t.difficulty === 'expert',
      );

      return {
        ...state,
        chart: action.chart,
        chartDoc: action.chartDoc,
        track: newTrack ?? state.track,
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
      const prevDoc = state.undoDocStack[state.undoDocStack.length - 1];

      const newTrack = action.chart.trackData.find(
        t => t.instrument === 'drums' && t.difficulty === 'expert',
      );

      // Check if we've returned to the saved state
      const newUndoDepth = state.undoStack.length - 1;
      const isDirty = newUndoDepth !== state.savedUndoDepth;

      return {
        ...state,
        chart: action.chart,
        chartDoc: prevDoc,
        track: newTrack ?? state.track,
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
      const redoDoc = state.redoDocStack[state.redoDocStack.length - 1];

      const newTrack = action.chart.trackData.find(
        t => t.instrument === 'drums' && t.difficulty === 'expert',
      );

      const newUndoDepth = state.undoStack.length + 1;
      const isDirty = newUndoDepth !== state.savedUndoDepth;

      return {
        ...state,
        chart: action.chart,
        chartDoc: redoDoc,
        track: newTrack ?? state.track,
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

    case 'SET_CONFIDENCE':
      return {...state, confidence: action.confidence};

    case 'SET_SHOW_CONFIDENCE':
      return {...state, showConfidence: action.show};

    case 'SET_CONFIDENCE_THRESHOLD':
      return {...state, confidenceThreshold: action.threshold};

    case 'MARK_REVIEWED': {
      const newReviewed = new Set(state.reviewedNoteIds);
      for (const id of action.noteIds) {
        newReviewed.add(id);
      }
      return {...state, reviewedNoteIds: newReviewed};
    }

    case 'SET_REVIEWED_NOTES':
      return {...state, reviewedNoteIds: action.noteIds};

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

    case 'SET_LOOP_REGION':
      return {...state, loopRegion: action.region};

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({children}: {children: ReactNode}) {
  const [state, dispatch] = useReducer(editorReducer, initialState);
  const audioManagerRef = useRef<AudioManager | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);

  return (
    <EditorContext.Provider
      value={{state, dispatch, audioManagerRef, wavesurferRef}}>
      {children}
    </EditorContext.Provider>
  );
}

export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error('useEditorContext must be used within an EditorProvider');
  }
  return ctx;
}
