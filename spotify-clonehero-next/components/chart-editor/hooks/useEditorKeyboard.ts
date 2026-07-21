'use client';

import {useCallback} from 'react';
import {useHotkey} from '@tanstack/react-hotkeys';
import type {Hotkey} from '@tanstack/react-hotkeys';
import {useChartEditorContext} from '../ChartEditorContext';
import {useAudioServiceContext} from '../AudioServiceContext';
import {
  getSelectedIds,
  getFirstSelectedId,
  selectActiveSchema,
  selectActiveTrack,
  type ToolMode,
} from '@/lib/chart-editor-core';
import {trackKeyFromScope} from '../scope';
import {useExecuteCommand, useUndoRedo} from './useEditCommands';
import {
  AddNoteCommand,
  DeleteNotesCommand,
  DeleteSectionCommand,
  BatchCommand,
  ToggleFlagCommand,
  noteId,
  toSchemaNote,
  translateSchemaNote,
  type SchemaNote,
} from '../commands';
import {
  findTrack,
  drums4LaneSchema,
  drums5LaneSchema,
  guitarSchema,
  bassSchema,
  rhythmSchema,
  keysSchema,
  listNotes,
  defaultFlagBits,
  laneToType,
  schemaForInstrument,
  schemaForTrack,
  type InstrumentSchema,
  type NoteFlagName,
} from '@/lib/chart-edit';
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
 * Every schema an editor page can be actively scoped to. Lane-key and
 * flag-key hotkeys are registered once per key in the union of these
 * schemas' `defaultKey` fields (a fixed set, so hook order/count stays
 * stable across renders) and resolve the *active* schema's binding for
 * that key at keypress time — a lane/flag without a `defaultKey` in the
 * active schema simply no-ops for that key.
 */
const ALL_SCHEMAS: readonly InstrumentSchema[] = [
  drums4LaneSchema,
  drums5LaneSchema,
  guitarSchema,
  bassSchema,
  rhythmSchema,
  keysSchema,
];

/** Union of lane `defaultKey`s across every schema (place-mode keys). */
const LANE_KEYS: readonly string[] = Array.from(
  new Set(
    ALL_SCHEMAS.flatMap(schema =>
      schema.lanes
        .filter(l => l.defaultKey !== undefined)
        .map(l => l.defaultKey!),
    ),
  ),
);

/** Union of flag-binding `defaultKey`s across every schema. */
const FLAG_KEYS: readonly string[] = Array.from(
  new Set(
    ALL_SCHEMAS.flatMap(schema =>
      schema.flagBindings
        .filter(b => b.defaultKey !== undefined)
        .map(b => b.defaultKey!),
    ),
  ),
);

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
 */
export function useEditorKeyboard(onSave?: () => void) {
  const {state, dispatch} = useChartEditorContext();
  const {audioManagerRef} = useAudioServiceContext();
  const {executeCommand} = useExecuteCommand();
  const {undo, redo, canUndo, canRedo} = useUndoRedo();

  // Active-scope notes for clipboard and navigation. When the editor is
  // pinned to a non-track scope (e.g. add-lyrics with `{kind: 'vocals'}`)
  // there's no notes track to operate on.
  const getActiveTrack = useCallback(() => selectActiveTrack(state), [state]);

  // Active-scope schema, for lane/flag keyboard shortcuts and note
  // add/select. Falls back to `drums4LaneSchema` for non-track scopes so
  // callers that unconditionally need a schema (e.g. select-all with no
  // track) still get sane lane math for an empty result.
  const getActiveSchema = useCallback(
    () => selectActiveSchema(state) ?? drums4LaneSchema,
    [state],
  );

  // Helper: sync cursor tick from current audio position.
  // After playback or timeline clicks, the audio position may have moved
  // without updating cursorTick. This returns the current audio position
  // snapped to the grid, suitable as a base for grid navigation.
  const getCursorFromAudio = useCallback((): number => {
    const am = audioManagerRef.current;
    if (!am || !state.chartDoc) return state.cursorTick;
    const timedTempos = buildTimedTempos(
      state.chartDoc.parsedChart.tempos,
      state.chartDoc.parsedChart.resolution,
    );
    if (timedTempos.length === 0) return state.cursorTick;
    const currentMs = am.chartTime * 1000;
    const tick = msToTick(
      currentMs,
      timedTempos,
      state.chartDoc.parsedChart.resolution,
    );
    return snapToGrid(
      tick,
      state.chartDoc.parsedChart.resolution,
      state.gridDivision,
    );
  }, [audioManagerRef, state.chartDoc, state.cursorTick, state.gridDivision]);

  // Helper: seek AudioManager to a tick position (without starting playback)
  const seekToTick = useCallback(
    async (tick: number) => {
      const am = audioManagerRef.current;
      if (!am || !state.chartDoc) return;
      const timedTempos = buildTimedTempos(
        state.chartDoc.parsedChart.tempos,
        state.chartDoc.parsedChart.resolution,
      );
      const ms = tickToMs(
        tick,
        timedTempos,
        state.chartDoc.parsedChart.resolution,
      );
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
  useHotkey(
    'Mod+Z',
    () => {
      undo();
    },
    {enabled: canUndo},
  );

  useHotkey(
    'Mod+Shift+Z',
    () => {
      redo();
    },
    {enabled: canRedo, conflictBehavior: 'allow'},
  );

  useHotkey(
    'Mod+Y',
    () => {
      redo();
    },
    {enabled: canRedo, conflictBehavior: 'allow'},
  );

  // -----------------------------------------------------------------------
  // Copy (Mod+C)
  // -----------------------------------------------------------------------
  useHotkey(
    'Mod+C',
    () => {
      if (getSelectedIds(state, 'note').size === 0) return;
      const track = getActiveTrack();
      const trackKey = trackKeyFromScope(state.activeScope);
      if (!track || !trackKey) return;
      const schema =
        schemaForInstrument(trackKey.instrument) ?? drums4LaneSchema;
      const selected = listNotes(track, schema).filter(n =>
        getSelectedIds(state, 'note').has(noteId(n)),
      );
      if (selected.length === 0) return;

      const minTick = Math.min(...selected.map(n => n.tick));
      const notes: SchemaNote[] = selected.map(n =>
        toSchemaNote({...n, tick: n.tick - minTick}),
      );
      dispatch({
        type: 'SET_CLIPBOARD',
        clipboard: {notes, sourceScope: state.activeScope},
      });
    },
    {enabled: getSelectedIds(state, 'note').size > 0},
  );

  // -----------------------------------------------------------------------
  // Cut (Mod+X)
  // -----------------------------------------------------------------------
  useHotkey(
    'Mod+X',
    () => {
      if (getSelectedIds(state, 'note').size === 0) return;
      const track = getActiveTrack();
      const trackKey = trackKeyFromScope(state.activeScope);
      if (!track || !trackKey) return;
      const schema =
        schemaForInstrument(trackKey.instrument) ?? drums4LaneSchema;
      const selected = listNotes(track, schema).filter(n =>
        getSelectedIds(state, 'note').has(noteId(n)),
      );
      if (selected.length === 0) return;

      // Copy
      const minTick = Math.min(...selected.map(n => n.tick));
      const notes: SchemaNote[] = selected.map(n =>
        toSchemaNote({...n, tick: n.tick - minTick}),
      );
      dispatch({
        type: 'SET_CLIPBOARD',
        clipboard: {notes, sourceScope: state.activeScope},
      });

      // Delete
      executeCommand(
        new DeleteNotesCommand(
          new Set(getSelectedIds(state, 'note')),
          trackKey,
        ),
      );
      dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set()});
    },
    {enabled: getSelectedIds(state, 'note').size > 0},
  );

  // -----------------------------------------------------------------------
  // Paste (Mod+V)
  // -----------------------------------------------------------------------
  useHotkey(
    'Mod+V',
    () => {
      const clipboard = state.clipboard;
      if (!clipboard || clipboard.notes.length === 0 || !state.chartDoc) return;
      const cursorTick = state.cursorTick;

      const trackKey = trackKeyFromScope(state.activeScope);
      if (!trackKey) return;
      const targetSchema = selectActiveSchema(state) ?? drums4LaneSchema;
      // Source track is resolved via drumType from the same chartDoc — the
      // clipboard doesn't store its own drumType, but drumType is a
      // chart-level (not track-level) property, so the active doc's value
      // applies to the source scope too.
      const sourceTrackKey = trackKeyFromScope(clipboard.sourceScope);
      const sourceTrack = sourceTrackKey
        ? findTrack(state.chartDoc, sourceTrackKey)?.track
        : null;
      const sourceSchema = sourceTrack
        ? (schemaForTrack(sourceTrack, state.chartDoc.parsedChart.drumType) ??
          targetSchema)
        : targetSchema;

      // Translate each note through the target track's schema (lane-by-lane
      // via translateSchemaNote) so pasting across instruments/difficulties
      // with different lane layouts lands on the right lane rather than
      // reusing the source's raw NoteType. Notes with no counterpart lane
      // in the target schema are dropped.
      const translated = clipboard.notes
        .map(n =>
          translateSchemaNote(
            {...n, tick: n.tick + cursorTick},
            sourceSchema,
            targetSchema,
          ),
        )
        .filter((n): n is SchemaNote => n !== null);

      const commands = translated.map(
        n => new AddNoteCommand(n, trackKey, targetSchema),
      );

      if (commands.length > 0) {
        executeCommand(
          new BatchCommand(commands, `Paste ${commands.length} note(s)`),
        );

        const newIds = new Set(translated.map(n => noteId(n)));
        dispatch({type: 'SET_SELECTION', kind: 'note', ids: newIds});
      }
    },
    {enabled: state.clipboard !== null && state.chartDoc !== null},
  );

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
    const track = getActiveTrack();
    if (track) {
      const schema = getActiveSchema();
      const allIds = new Set(listNotes(track, schema).map(n => noteId(n)));
      dispatch({type: 'SET_SELECTION', kind: 'note', ids: allIds});
    }
  });

  // -----------------------------------------------------------------------
  // Tool selection via Mod+1-6 (always available)
  // -----------------------------------------------------------------------
  for (const [key, tool] of Object.entries(TOOL_SHORTCUT_MAP)) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHotkey(
      `Mod+${key}` as Hotkey,
      () => {
        dispatch({type: 'SET_ACTIVE_TOOL', tool});
      },
      {conflictBehavior: 'allow'},
    );
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
      state.chartDoc.parsedChart.resolution,
    );
    dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
    seekToTick(newTick);
  });

  useHotkey(
    'ArrowRight',
    () => {
      if (state.isPlaying || !state.chartDoc) return;
      const baseTick = getCursorFromAudio();
      const newTick = getNextGridTick(
        baseTick,
        1,
        state.gridDivision,
        state.chartDoc.parsedChart.resolution,
      );
      dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
      seekToTick(newTick);
    },
    {conflictBehavior: 'allow'},
  );

  useHotkey('ArrowDown', () => {
    if (state.isPlaying || !state.chartDoc) return;
    const baseTick = getCursorFromAudio();
    const newTick = getNextGridTick(
      baseTick,
      -1,
      state.gridDivision,
      state.chartDoc.parsedChart.resolution,
    );
    dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
    seekToTick(newTick);
  });

  useHotkey(
    'ArrowLeft',
    () => {
      if (state.isPlaying || !state.chartDoc) return;
      const baseTick = getCursorFromAudio();
      const newTick = getNextGridTick(
        baseTick,
        -1,
        state.gridDivision,
        state.chartDoc.parsedChart.resolution,
      );
      dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
      seekToTick(newTick);
    },
    {conflictBehavior: 'allow'},
  );

  // -----------------------------------------------------------------------
  // Measure navigation (Mod+arrows)
  // -----------------------------------------------------------------------
  useHotkey('Mod+ArrowUp', () => {
    if (state.isPlaying || !state.chartDoc) return;
    const baseTick = getCursorFromAudio();
    const newTick = getNextMeasureTick(
      baseTick,
      1,
      state.chartDoc.parsedChart.resolution,
      state.chartDoc.parsedChart.timeSignatures,
    );
    dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
    seekToTick(newTick);
  });

  useHotkey(
    'Mod+ArrowRight',
    () => {
      if (state.isPlaying || !state.chartDoc) return;
      const baseTick = getCursorFromAudio();
      const newTick = getNextMeasureTick(
        baseTick,
        1,
        state.chartDoc.parsedChart.resolution,
        state.chartDoc.parsedChart.timeSignatures,
      );
      dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
      seekToTick(newTick);
    },
    {conflictBehavior: 'allow'},
  );

  useHotkey('Mod+ArrowDown', () => {
    if (state.isPlaying || !state.chartDoc) return;
    const baseTick = getCursorFromAudio();
    const newTick = getNextMeasureTick(
      baseTick,
      -1,
      state.chartDoc.parsedChart.resolution,
      state.chartDoc.parsedChart.timeSignatures,
    );
    dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
    seekToTick(newTick);
  });

  useHotkey(
    'Mod+ArrowLeft',
    () => {
      if (state.isPlaying || !state.chartDoc) return;
      const baseTick = getCursorFromAudio();
      const newTick = getNextMeasureTick(
        baseTick,
        -1,
        state.chartDoc.parsedChart.resolution,
        state.chartDoc.parsedChart.timeSignatures,
      );
      dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
      seekToTick(newTick);
    },
    {conflictBehavior: 'allow'},
  );

  // -----------------------------------------------------------------------
  // Grid snap shortcuts (Shift+number)
  // -----------------------------------------------------------------------
  for (const [key, division] of Object.entries(GRID_SHORTCUT_MAP)) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHotkey(
      `Shift+${key}` as Hotkey,
      () => {
        dispatch({type: 'SET_GRID_DIVISION', division});
      },
      {conflictBehavior: 'allow'},
    );
  }

  // -----------------------------------------------------------------------
  // Lane keys in Place mode — place/toggle note at cursor. Registered once
  // per key in `LANE_KEYS` (the union across every schema, so hook order
  // is stable); each handler resolves the *active* schema's lane for that
  // key and no-ops if the active schema has no lane bound to it.
  // -----------------------------------------------------------------------
  for (const key of LANE_KEYS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHotkey(
      key as Hotkey,
      () => {
        if (!state.chartDoc) return;
        const trackKey = trackKeyFromScope(state.activeScope);
        if (!trackKey) return;
        const schema = getActiveSchema();
        const lane = schema.lanes.find(l => l.defaultKey === key);
        if (!lane) return;
        const type = laneToType(schema, lane.index);
        const tick = state.cursorTick;

        const track = getActiveTrack();
        if (track) {
          const existing = listNotes(track, schema).find(
            n => n.tick === tick && n.type === type,
          );
          if (existing) {
            const id = noteId(existing);
            executeCommand(new DeleteNotesCommand(new Set([id]), trackKey));
          } else {
            executeCommand(
              new AddNoteCommand(
                toSchemaNote({
                  tick,
                  type,
                  length: 0,
                  flags: defaultFlagBits(schema, type),
                }),
                trackKey,
                schema,
              ),
            );
          }
        }
      },
      {enabled: state.activeTool === 'place', conflictBehavior: 'allow'},
    );
  }

  // -----------------------------------------------------------------------
  // Tool selection (1-6, when NOT in Place mode)
  // -----------------------------------------------------------------------
  for (const [key, tool] of Object.entries(TOOL_SHORTCUT_MAP)) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHotkey(
      key as Hotkey,
      () => {
        dispatch({type: 'SET_ACTIVE_TOOL', tool});
      },
      {enabled: state.activeTool !== 'place', conflictBehavior: 'allow'},
    );
  }

  // -----------------------------------------------------------------------
  // Flag toggles — apply to selected notes. Registered once per key in
  // `FLAG_KEYS` (the union across every schema); each handler resolves the
  // active schema's flag binding for that key and no-ops if the active
  // schema has none bound to it.
  // -----------------------------------------------------------------------
  for (const key of FLAG_KEYS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHotkey(
      key.toUpperCase() as Hotkey,
      () => {
        const trackKey = trackKeyFromScope(state.activeScope);
        if (!trackKey) return;
        const schema = getActiveSchema();
        const binding = schema.flagBindings.find(b => b.defaultKey === key);
        if (!binding) return;
        const flag: NoteFlagName = binding.flag;
        if (getSelectedIds(state, 'note').size > 0 && state.chartDoc) {
          executeCommand(
            new ToggleFlagCommand(
              Array.from(getSelectedIds(state, 'note')),
              flag,
              trackKey,
              schema,
            ),
          );
        }
      },
      {
        enabled:
          getSelectedIds(state, 'note').size > 0 && state.chartDoc !== null,
        conflictBehavior: 'allow',
      },
    );
  }

  // -----------------------------------------------------------------------
  // Delete / Backspace — delete selected notes or selected section
  // -----------------------------------------------------------------------
  const handleDelete = useCallback(() => {
    const selectedSectionId = getFirstSelectedId(state, 'section');
    const selectedSectionTick =
      selectedSectionId !== null
        ? Number.parseInt(selectedSectionId, 10)
        : null;
    if (selectedSectionTick !== null && state.chartDoc) {
      const section = state.chartDoc.parsedChart.sections.find(
        s => s.tick === selectedSectionTick,
      );
      if (section) {
        executeCommand(new DeleteSectionCommand(section.tick, section.name));
        dispatch({type: 'SET_SELECTION', kind: 'section', ids: new Set()});
      }
      return;
    }
    const selectedNotes = getSelectedIds(state, 'note');
    if (selectedNotes.size > 0) {
      const trackKey = trackKeyFromScope(state.activeScope);
      if (!trackKey) return;
      executeCommand(
        new DeleteNotesCommand(selectedNotes as Set<string>, trackKey),
      );
      dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set()});
    }
  }, [state, executeCommand, dispatch]);

  useHotkey('Delete', handleDelete, {
    enabled:
      getSelectedIds(state, 'note').size > 0 ||
      getFirstSelectedId(state, 'section') !== null,
  });

  useHotkey('Backspace', handleDelete, {
    enabled:
      getSelectedIds(state, 'note').size > 0 ||
      getFirstSelectedId(state, 'section') !== null,
    conflictBehavior: 'allow',
  });

  // -----------------------------------------------------------------------
  // Escape — deselect all and switch to cursor mode
  // -----------------------------------------------------------------------
  useHotkey('Escape', () => {
    dispatch({type: 'CLEAR_SELECTION'});
    dispatch({type: 'SET_ACTIVE_TOOL', tool: 'cursor'});
  });
}
