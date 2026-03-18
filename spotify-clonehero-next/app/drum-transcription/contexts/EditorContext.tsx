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
import type {ChartDocument} from '@/lib/drum-transcription/chart-io/types';
import type {EditCommand} from '../commands';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ParsedChart = ReturnType<typeof parseChartFile>;

export type ToolMode = 'cursor' | 'place' | 'erase' | 'bpm' | 'timesig';

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
    };

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
      // Find the expert drums track in the new chart
      const newTrack = action.chart.trackData.find(
        t => t.instrument === 'drums' && t.difficulty === 'expert',
      );
      return {
        ...state,
        chart: action.chart,
        chartDoc: action.chartDoc,
        track: newTrack ?? state.track,
        dirty: true,
      };
    }
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
