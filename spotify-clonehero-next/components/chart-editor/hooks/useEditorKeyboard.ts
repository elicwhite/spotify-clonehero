'use client';

import {useCallback} from 'react';
import {useHotkey} from '@tanstack/react-hotkeys';
import type {Hotkey} from '@tanstack/react-hotkeys';
import {useChartEditorContext, type ToolMode} from '../ChartEditorContext';
import {useExecuteCommand, useUndoRedo} from './useEditCommands';
import {
  AddNoteCommand,
  DeleteNotesCommand,
  DeleteSectionCommand,
  BatchCommand,
  ToggleFlagCommand,
  noteId,
  laneToType,
  defaultFlagsForType,
  type FlagName,
} from '../commands';
import type {DrumNote, DrumNoteType} from '@/lib/chart-edit';
import {getDrumNotes} from '@/lib/chart-edit';
import {
  buildTimedTempos,
  tickToMs,
  msToTick,
  snapToGrid,
  getNextGridTick,
  getNextMeasureTick,
} from '@/lib/drum-transcription/timing';

/**
 * Grid division values mapped to Shift+N shortcuts.
 * Shift+1=4 (1/4), Shift+2=8 (1/8), ..., Shift+6=64 (1/64), Shift+0=0 (free)
 */
const GRID_SHORTCUT_MAP: Record<string, number> = {
  '1': 4,
  '2': 8,
  '3': 12,
  '4': 16,
  '5': 32,
  '6': 64,
  '0': 0,
};

/**
 * Tool mode mapped to number keys 1-6 (always available via Ctrl+N,
 * also available without modifier when not in Place mode).
 */
const TOOL_SHORTCUT_MAP: Record<string, ToolMode> = {
  '1': 'cursor',
  '2': 'place',
  '3': 'erase',
  '4': 'bpm',
  '5': 'timesig',
  '6': 'section',
};

/**
 * Lane key mapping for keys mode (Place tool): 1=kick, 2=red, 3=yellow, 4=blue, 5=green.
 */
const LANE_KEY_MAP: Record<string, number> = {
  '1': 0, // kick
  '2': 1, // redDrum
  '3': 2, // yellowDrum
  '4': 3, // blueDrum
  '5': 4, // greenDrum
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
 * Registers global keyboard shortcuts for the chart editor using
 * @tanstack/react-hotkeys `useHotkey` for declarative, composable bindings.
 *
 * Generic shortcuts (shared across all editor pages):
 * - Grid navigation (Up/Down/Left/Right arrows = grid step, Mod+arrows = measure)
 * - Lane keys (1-5 in Place mode = place/toggle note at cursor)
 * - Tool selection (Mod+1-6 always, 1-6 when not in Place mode)
 * - Note flags (Q, A, S)
 * - Grid snap (Shift+1 through Shift+6, Shift+0)
 * - Editing (Mod+Z undo, Mod+Shift+Z/Mod+Y redo, Delete, Mod+A, Escape)
 * - Copy/Paste (Mod+C, Mod+V, Mod+X)
 * - Loop region (Mod+L to clear)
 * - Save (Mod+S)
 *
 * @param onSave - Callback for Mod+S save
 * @param onNotesModified - Optional callback when notes are modified (e.g. for marking reviewed)
 */
export function useEditorKeyboard(
  onSave?: () => void,
  onNotesModified?: (noteIds: string[]) => void,
) {
  const {state, dispatch, audioManagerRef} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();
  const {undo, redo, canUndo, canRedo} = useUndoRedo();

  // Get expert notes for clipboard and navigation
  const getExpertTrack = useCallback(() => {
    if (!state.chartDoc) return null;
    return state.chartDoc.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    ) ?? null;
  }, [state.chartDoc]);

  // Helper: sync cursor tick from current audio position.
  // After playback or timeline clicks, the audio position may have moved
  // without updating cursorTick. This returns the current audio position
  // snapped to the grid, suitable as a base for grid navigation.
  const getCursorFromAudio = useCallback((): number => {
    const am = audioManagerRef.current;
    if (!am || !state.chartDoc) return state.cursorTick;
    const timedTempos = buildTimedTempos(
      state.chartDoc.tempos,
      state.chartDoc.chartTicksPerBeat,
    );
    if (timedTempos.length === 0) return state.cursorTick;
    const currentMs = am.chartTime * 1000;
    const tick = msToTick(currentMs, timedTempos, state.chartDoc.chartTicksPerBeat);
    return snapToGrid(tick, state.chartDoc.chartTicksPerBeat, state.gridDivision);
  }, [audioManagerRef, state.chartDoc, state.cursorTick, state.gridDivision]);

  // Helper: seek AudioManager to a tick position (without starting playback)
  const seekToTick = useCallback(
    async (tick: number) => {
      const am = audioManagerRef.current;
      if (!am || !state.chartDoc) return;
      const timedTempos = buildTimedTempos(
        state.chartDoc.tempos,
        state.chartDoc.chartTicksPerBeat,
      );
      const ms = tickToMs(tick, timedTempos, state.chartDoc.chartTicksPerBeat);
      const wasPlaying = am.isPlaying;
      await am.playChartTime(ms / 1000);
      if (!wasPlaying) {
        await am.pause();
      }
    },
    [audioManagerRef, state.chartDoc],
  );

  // -----------------------------------------------------------------------
  // Save (Mod+S)
  // -----------------------------------------------------------------------
  useHotkey('Mod+S', () => {
    onSave?.();
  });

  // -----------------------------------------------------------------------
  // Undo / Redo
  // -----------------------------------------------------------------------
  useHotkey('Mod+Z', () => {
    undo();
  }, {enabled: canUndo});

  useHotkey('Mod+Shift+Z', () => {
    redo();
  }, {enabled: canRedo, conflictBehavior: 'allow'});

  useHotkey('Mod+Y', () => {
    redo();
  }, {enabled: canRedo, conflictBehavior: 'allow'});

  // -----------------------------------------------------------------------
  // Copy (Mod+C)
  // -----------------------------------------------------------------------
  useHotkey('Mod+C', () => {
    if (state.selectedNoteIds.size === 0) return;
    const track = getExpertTrack();
    if (!track) return;
    const selected = getDrumNotes(track).filter(n =>
      state.selectedNoteIds.has(noteId(n)),
    );
    if (selected.length === 0) return;

    const minTick = Math.min(...selected.map(n => n.tick));
    const normalized: DrumNote[] = selected.map(n => ({
      ...n,
      tick: n.tick - minTick,
      flags: {...n.flags},
    }));
    dispatch({type: 'SET_CLIPBOARD', notes: normalized});
  }, {enabled: state.selectedNoteIds.size > 0});

  // -----------------------------------------------------------------------
  // Cut (Mod+X)
  // -----------------------------------------------------------------------
  useHotkey('Mod+X', () => {
    if (state.selectedNoteIds.size === 0) return;
    const track = getExpertTrack();
    if (!track) return;
    const selected = getDrumNotes(track).filter(n =>
      state.selectedNoteIds.has(noteId(n)),
    );
    if (selected.length === 0) return;

    // Copy
    const minTick = Math.min(...selected.map(n => n.tick));
    const normalized: DrumNote[] = selected.map(n => ({
      ...n,
      tick: n.tick - minTick,
      flags: {...n.flags},
    }));
    dispatch({type: 'SET_CLIPBOARD', notes: normalized});

    // Delete
    executeCommand(new DeleteNotesCommand(state.selectedNoteIds));
    dispatch({type: 'SET_SELECTED_NOTES', noteIds: new Set()});
  }, {enabled: state.selectedNoteIds.size > 0});

  // -----------------------------------------------------------------------
  // Paste (Mod+V)
  // -----------------------------------------------------------------------
  useHotkey('Mod+V', () => {
    if (state.clipboard.length === 0 || !state.chartDoc) return;
    const cursorTick = state.cursorTick;

    const commands = state.clipboard.map(
      n =>
        new AddNoteCommand({
          ...n,
          tick: n.tick + cursorTick,
          flags: {...n.flags},
        }),
    );

    if (commands.length > 0) {
      executeCommand(
        new BatchCommand(commands, `Paste ${commands.length} note(s)`),
      );

      const newIds = new Set(
        state.clipboard.map(n => noteId({...n, tick: n.tick + cursorTick})),
      );
      dispatch({type: 'SET_SELECTED_NOTES', noteIds: newIds});
    }
  }, {enabled: state.clipboard.length > 0 && state.chartDoc !== null});

  // -----------------------------------------------------------------------
  // Loop clear (Mod+L)
  // -----------------------------------------------------------------------
  useHotkey('Mod+L', () => {
    dispatch({type: 'SET_LOOP_REGION', region: null});
    const am = audioManagerRef.current;
    if (am) {
      am.setPracticeMode(null);
    }
  });

  // -----------------------------------------------------------------------
  // Select all (Mod+A)
  // -----------------------------------------------------------------------
  useHotkey('Mod+A', () => {
    const track = getExpertTrack();
    if (track) {
      const allIds = new Set(getDrumNotes(track).map(n => noteId(n)));
      dispatch({type: 'SET_SELECTED_NOTES', noteIds: allIds});
    }
  });

  // -----------------------------------------------------------------------
  // Tool selection via Mod+1-6 (always available)
  // -----------------------------------------------------------------------
  for (const [key, tool] of Object.entries(TOOL_SHORTCUT_MAP)) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHotkey(`Mod+${key}` as Hotkey, () => {
      dispatch({type: 'SET_ACTIVE_TOOL', tool});
    }, {conflictBehavior: 'allow'});
  }

  // -----------------------------------------------------------------------
  // Grid navigation (arrows, no modifier)
  // -----------------------------------------------------------------------
  useHotkey('ArrowUp', () => {
    if (state.isPlaying || !state.chartDoc) return;
    const baseTick = getCursorFromAudio();
    const newTick = getNextGridTick(
      baseTick,
      1,
      state.gridDivision,
      state.chartDoc.chartTicksPerBeat,
    );
    dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
    seekToTick(newTick);
  });

  useHotkey('ArrowRight', () => {
    if (state.isPlaying || !state.chartDoc) return;
    const baseTick = getCursorFromAudio();
    const newTick = getNextGridTick(
      baseTick,
      1,
      state.gridDivision,
      state.chartDoc.chartTicksPerBeat,
    );
    dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
    seekToTick(newTick);
  }, {conflictBehavior: 'allow'});

  useHotkey('ArrowDown', () => {
    if (state.isPlaying || !state.chartDoc) return;
    const baseTick = getCursorFromAudio();
    const newTick = getNextGridTick(
      baseTick,
      -1,
      state.gridDivision,
      state.chartDoc.chartTicksPerBeat,
    );
    dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
    seekToTick(newTick);
  });

  useHotkey('ArrowLeft', () => {
    if (state.isPlaying || !state.chartDoc) return;
    const baseTick = getCursorFromAudio();
    const newTick = getNextGridTick(
      baseTick,
      -1,
      state.gridDivision,
      state.chartDoc.chartTicksPerBeat,
    );
    dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
    seekToTick(newTick);
  }, {conflictBehavior: 'allow'});

  // -----------------------------------------------------------------------
  // Measure navigation (Mod+arrows)
  // -----------------------------------------------------------------------
  useHotkey('Mod+ArrowUp', () => {
    if (state.isPlaying || !state.chartDoc) return;
    const baseTick = getCursorFromAudio();
    const newTick = getNextMeasureTick(
      baseTick,
      1,
      state.chartDoc.chartTicksPerBeat,
      state.chartDoc.timeSignatures,
    );
    dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
    seekToTick(newTick);
  });

  useHotkey('Mod+ArrowRight', () => {
    if (state.isPlaying || !state.chartDoc) return;
    const baseTick = getCursorFromAudio();
    const newTick = getNextMeasureTick(
      baseTick,
      1,
      state.chartDoc.chartTicksPerBeat,
      state.chartDoc.timeSignatures,
    );
    dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
    seekToTick(newTick);
  }, {conflictBehavior: 'allow'});

  useHotkey('Mod+ArrowDown', () => {
    if (state.isPlaying || !state.chartDoc) return;
    const baseTick = getCursorFromAudio();
    const newTick = getNextMeasureTick(
      baseTick,
      -1,
      state.chartDoc.chartTicksPerBeat,
      state.chartDoc.timeSignatures,
    );
    dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
    seekToTick(newTick);
  });

  useHotkey('Mod+ArrowLeft', () => {
    if (state.isPlaying || !state.chartDoc) return;
    const baseTick = getCursorFromAudio();
    const newTick = getNextMeasureTick(
      baseTick,
      -1,
      state.chartDoc.chartTicksPerBeat,
      state.chartDoc.timeSignatures,
    );
    dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
    seekToTick(newTick);
  }, {conflictBehavior: 'allow'});

  // -----------------------------------------------------------------------
  // Grid snap shortcuts (Shift+number)
  // -----------------------------------------------------------------------
  for (const [key, division] of Object.entries(GRID_SHORTCUT_MAP)) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHotkey(`Shift+${key}` as Hotkey, () => {
      dispatch({type: 'SET_GRID_DIVISION', division});
    }, {conflictBehavior: 'allow'});
  }

  // -----------------------------------------------------------------------
  // Lane keys (1-5) in Place mode — place/toggle note at cursor
  // -----------------------------------------------------------------------
  for (const [key, lane] of Object.entries(LANE_KEY_MAP)) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHotkey(key as Hotkey, () => {
      if (!state.chartDoc) return;
      const type: DrumNoteType = laneToType(lane);
      const tick = state.cursorTick;

      const track = getExpertTrack();
      if (track) {
        const existing = getDrumNotes(track).find(
          n => n.tick === tick && n.type === type,
        );
        if (existing) {
          const id = noteId(existing);
          executeCommand(new DeleteNotesCommand(new Set([id])));
          onNotesModified?.([id]);
        } else {
          const newNote: DrumNote = {
            tick,
            type,
            length: 0,
            flags: defaultFlagsForType(type),
          };
          executeCommand(new AddNoteCommand(newNote));
          onNotesModified?.([noteId(newNote)]);
        }
      }
    }, {enabled: state.activeTool === 'place', conflictBehavior: 'allow'});
  }

  // -----------------------------------------------------------------------
  // Tool selection (1-6, when NOT in Place mode)
  // -----------------------------------------------------------------------
  for (const [key, tool] of Object.entries(TOOL_SHORTCUT_MAP)) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHotkey(key as Hotkey, () => {
      dispatch({type: 'SET_ACTIVE_TOOL', tool});
    }, {enabled: state.activeTool !== 'place', conflictBehavior: 'allow'});
  }

  // -----------------------------------------------------------------------
  // Flag toggles (Q, A, S) — apply to selected notes
  // -----------------------------------------------------------------------
  for (const [key, flag] of Object.entries(FLAG_SHORTCUT_MAP)) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHotkey(key.toUpperCase() as Hotkey, () => {
      if (state.selectedNoteIds.size > 0 && state.chartDoc) {
        executeCommand(
          new ToggleFlagCommand(Array.from(state.selectedNoteIds), flag),
        );
        onNotesModified?.(Array.from(state.selectedNoteIds));
      }
    }, {enabled: state.selectedNoteIds.size > 0 && state.chartDoc !== null, conflictBehavior: 'allow'});
  }

  // -----------------------------------------------------------------------
  // Delete / Backspace — delete selected notes or selected section
  // -----------------------------------------------------------------------
  const handleDelete = useCallback(() => {
    if (state.selectedSectionTick !== null && state.chartDoc) {
      const section = state.chartDoc.sections.find(
        s => s.tick === state.selectedSectionTick,
      );
      if (section) {
        executeCommand(
          new DeleteSectionCommand(section.tick, section.name),
        );
        dispatch({type: 'SET_SELECTED_SECTION', tick: null});
      }
      return;
    }
    if (state.selectedNoteIds.size > 0) {
      onNotesModified?.(Array.from(state.selectedNoteIds));
      executeCommand(new DeleteNotesCommand(state.selectedNoteIds));
      dispatch({type: 'SET_SELECTED_NOTES', noteIds: new Set()});
    }
  }, [state.selectedSectionTick, state.selectedNoteIds, state.chartDoc, executeCommand, dispatch, onNotesModified]);

  useHotkey('Delete', handleDelete, {
    enabled: state.selectedNoteIds.size > 0 || state.selectedSectionTick !== null,
  });

  useHotkey('Backspace', handleDelete, {
    enabled: state.selectedNoteIds.size > 0 || state.selectedSectionTick !== null,
    conflictBehavior: 'allow',
  });

  // -----------------------------------------------------------------------
  // Escape — deselect all and switch to cursor mode
  // -----------------------------------------------------------------------
  useHotkey('Escape', () => {
    dispatch({type: 'SET_SELECTED_NOTES', noteIds: new Set()});
    dispatch({type: 'SET_SELECTED_SECTION', tick: null});
    dispatch({type: 'SET_ACTIVE_TOOL', tool: 'cursor'});
  });
}
