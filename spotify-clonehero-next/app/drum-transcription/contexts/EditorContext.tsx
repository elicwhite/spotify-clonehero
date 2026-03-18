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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ParsedChart = ReturnType<typeof parseChartFile>;

export interface EditorState {
  /** Parsed chart data (read-only in this plan). */
  chart: ParsedChart | null;
  /** The active drum track from the parsed chart. */
  track: ParsedChart['trackData'][0] | null;

  /** Whether audio is currently playing. */
  isPlaying: boolean;
  /** Current playback position in milliseconds. */
  currentTimeMs: number;
  /** Playback speed multiplier (e.g. 0.5, 1.0, 1.5). */
  playbackSpeed: number;

  /** Zoom level for sheet music and waveform. */
  zoom: number;
}

export type EditorAction =
  | {type: 'SET_CHART'; chart: ParsedChart; track: ParsedChart['trackData'][0]}
  | {type: 'SET_PLAYING'; isPlaying: boolean}
  | {type: 'SET_CURRENT_TIME'; timeMs: number}
  | {type: 'SET_PLAYBACK_SPEED'; speed: number}
  | {type: 'SET_ZOOM'; zoom: number};

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
  isPlaying: false,
  currentTimeMs: 0,
  playbackSpeed: 1.0,
  zoom: 1.0,
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'SET_CHART':
      return {...state, chart: action.chart, track: action.track};
    case 'SET_PLAYING':
      return {...state, isPlaying: action.isPlaying};
    case 'SET_CURRENT_TIME':
      return {...state, currentTimeMs: action.timeMs};
    case 'SET_PLAYBACK_SPEED':
      return {...state, playbackSpeed: action.speed};
    case 'SET_ZOOM':
      return {...state, zoom: action.zoom};
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
