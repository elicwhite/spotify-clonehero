'use client';

import {useEffect} from 'react';
import {useEditorContext, type ToolMode} from '../contexts/EditorContext';
import {useExecuteCommand} from './useEditCommands';
import {
  DeleteNotesCommand,
  ToggleFlagCommand,
  noteId,
  type FlagName,
} from '../commands';

/**
 * Grid division values mapped to Shift+N shortcuts.
 * Shift+1=4 (1/4), Shift+2=8 (1/8), ..., Shift+6=64 (1/64), Shift+0=0 (free)
 */
const GRID_SHORTCUT_MAP: Record<string, number> = {
  '!': 4, // Shift+1
  '@': 8, // Shift+2
  '#': 12, // Shift+3
  $: 16, // Shift+4
  '%': 32, // Shift+5
  '^': 64, // Shift+6
  ')': 0, // Shift+0
};

/**
 * Tool mode mapped to number keys 1-5.
 */
const TOOL_SHORTCUT_MAP: Record<string, ToolMode> = {
  '1': 'cursor',
  '2': 'place',
  '3': 'erase',
  '4': 'bpm',
  '5': 'timesig',
};

/**
 * Flag shortcuts: Q=cymbal, A=accent, S=ghost
 */
const FLAG_SHORTCUT_MAP: Record<string, FlagName> = {
  q: 'cymbal',
  a: 'accent',
  s: 'ghost',
};

/**
 * Registers global keyboard shortcuts for the drum transcription editor.
 *
 * - Tool selection (1-5)
 * - Note flags (Q, A, S)
 * - Grid snap (Shift+1 through Shift+6, Shift+0)
 * - Editing (Ctrl+Z undo, Ctrl+Shift+Z/Ctrl+Y redo, Delete, Ctrl+A, Escape)
 */
export function useEditorKeyboard() {
  const {state, dispatch} = useEditorContext();
  const executeCommand = useExecuteCommand();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const key = e.key;

      // Grid snap shortcuts (Shift+number produces special chars)
      if (e.shiftKey && GRID_SHORTCUT_MAP[key] !== undefined) {
        e.preventDefault();
        dispatch({
          type: 'SET_GRID_DIVISION',
          division: GRID_SHORTCUT_MAP[key],
        });
        return;
      }

      // Tool selection (1-5, without shift)
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey && TOOL_SHORTCUT_MAP[key]) {
        e.preventDefault();
        dispatch({type: 'SET_ACTIVE_TOOL', tool: TOOL_SHORTCUT_MAP[key]});
        return;
      }

      // Flag toggles (Q, A, S) - apply to selected notes
      if (
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        FLAG_SHORTCUT_MAP[key.toLowerCase()]
      ) {
        if (state.selectedNoteIds.size > 0 && state.chartDoc) {
          e.preventDefault();
          const flag = FLAG_SHORTCUT_MAP[key.toLowerCase()];
          executeCommand(
            new ToggleFlagCommand(Array.from(state.selectedNoteIds), flag),
          );
        }
        return;
      }

      // Delete / Backspace - delete selected notes
      if (key === 'Delete' || key === 'Backspace') {
        if (state.selectedNoteIds.size > 0) {
          e.preventDefault();
          executeCommand(new DeleteNotesCommand(state.selectedNoteIds));
          dispatch({type: 'SET_SELECTED_NOTES', noteIds: new Set()});
        }
        return;
      }

      // Ctrl+A / Cmd+A - select all visible notes
      if ((e.ctrlKey || e.metaKey) && key === 'a') {
        e.preventDefault();
        if (state.chartDoc) {
          const track = state.chartDoc.tracks.find(
            t => t.instrument === 'drums' && t.difficulty === 'expert',
          );
          if (track) {
            const allIds = new Set(track.notes.map(n => noteId(n)));
            dispatch({type: 'SET_SELECTED_NOTES', noteIds: allIds});
          }
        }
        return;
      }

      // Escape - deselect all
      if (key === 'Escape') {
        e.preventDefault();
        dispatch({type: 'SET_SELECTED_NOTES', noteIds: new Set()});
        return;
      }

      // Undo/Redo (placeholder -- stack is in 0007b)
      // Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y
      // Currently just prevents default; the undo stack will be wired in 0007b
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.selectedNoteIds, state.chartDoc, dispatch, executeCommand]);
}
