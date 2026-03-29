'use client';

import {
  createContext,
  useContext,
  useReducer,
  type ReactNode,
} from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DrumTranscriptionState {
  /** Confidence scores for notes, keyed by noteId (tick:type). */
  confidence: Map<string, number>;
  /** Whether to show confidence overlay on notes. */
  showConfidence: boolean;
  /** Threshold below which notes are flagged as low-confidence. */
  confidenceThreshold: number;
  /** Set of note IDs that have been reviewed by the user. */
  reviewedNoteIds: Set<string>;
}

export type DrumTranscriptionAction =
  | {type: 'SET_CONFIDENCE'; confidence: Map<string, number>}
  | {type: 'SET_SHOW_CONFIDENCE'; show: boolean}
  | {type: 'SET_CONFIDENCE_THRESHOLD'; threshold: number}
  | {type: 'MARK_REVIEWED'; noteIds: string[]}
  | {type: 'SET_REVIEWED_NOTES'; noteIds: Set<string>};

export interface DrumTranscriptionContextValue {
  dtState: DrumTranscriptionState;
  dtDispatch: React.Dispatch<DrumTranscriptionAction>;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: DrumTranscriptionState = {
  confidence: new Map(),
  showConfidence: true,
  confidenceThreshold: 0.7,
  reviewedNoteIds: new Set(),
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function drumTranscriptionReducer(
  state: DrumTranscriptionState,
  action: DrumTranscriptionAction,
): DrumTranscriptionState {
  switch (action.type) {
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

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const DrumTranscriptionContext = createContext<DrumTranscriptionContextValue | null>(null);

export function DrumTranscriptionProvider({children}: {children: ReactNode}) {
  const [dtState, dtDispatch] = useReducer(drumTranscriptionReducer, initialState);

  return (
    <DrumTranscriptionContext.Provider value={{dtState, dtDispatch}}>
      {children}
    </DrumTranscriptionContext.Provider>
  );
}

export function useDrumTranscriptionContext(): DrumTranscriptionContextValue {
  const ctx = useContext(DrumTranscriptionContext);
  if (!ctx) {
    throw new Error('useDrumTranscriptionContext must be used within a DrumTranscriptionProvider');
  }
  return ctx;
}
