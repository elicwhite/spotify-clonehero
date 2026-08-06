'use client';

import {useCallback} from 'react';
import {useHotkey} from '@tanstack/react-hotkeys';
import type {Hotkey} from '@tanstack/react-hotkeys';
import {useChartEditorContext} from '../ChartEditorContext';
import {useAudioServiceContext} from '../AudioServiceContext';
import {
  getSelectedIds,
  isClipboardEmpty,
  parseTrackKeyId,
  pasteAnchorTick,
  pasteLyricsAt,
  pasteNotesAt,
  selectActiveSchema,
  selectActiveTrack,
  toClipboardLyrics,
  toClipboardNotes,
  trackKeyId,
  type ToolMode,
} from '@/lib/chart-editor-core';
import {
  localNoteIdsForTrack,
  trackKeyFromScope,
  trackQualifiedNoteId,
} from '../scope';
import {useExecuteCommand, useUndoRedo} from './useEditCommands';
import {buildDeleteSelectionCommands} from '../editing/deleteSelection';
import {
  AddLyricCommand,
  AddNoteCommand,
  DeleteLyricCommand,
  DeleteNotesCommand,
  BatchCommand,
  ToggleFlagCommand,
  noteId,
  toSchemaNote,
  translateSchemaNote,
  type EditCommand,
  type SchemaNote,
} from '../commands';
import {
  findTrack,
  lyricId,
  DEFAULT_VOCALS_PART,
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
  snapTickToGrid,
  nextGridTick,
  type InstrumentSchema,
  type NoteFlagName,
} from '@/lib/chart-edit';
import {
  buildTimedTempos,
  tickToMs,
  msToTick,
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
 * Tool mode mapped to number keys (always available via Ctrl+N, also
 * available without modifier when not in Place mode).
 *
 * Only the modes the sidebar's tool row can show as active are bound.
 * `erase` is reachable through the piano roll's context menus and
 * Delete/Backspace instead, and has no button to light up, so a hotkey into
 * it would strand the user in a mode with no visible state and no obvious
 * way out.
 */
const TOOL_SHORTCUT_MAP: Record<string, ToolMode> = {
  '1': 'cursor',
  '2': 'place',
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

function activeNoteIds(
  state: Parameters<typeof getSelectedIds>[0],
): Set<string> {
  const trackKey = trackKeyFromScope(state.activeScope);
  if (!trackKey) return new Set();
  return new Set(localNoteIdsForTrack(getSelectedIds(state, 'note'), trackKey));
}

/**
 * Registers global keyboard shortcuts for the chart editor using
 * @tanstack/react-hotkeys `useHotkey` for declarative, composable bindings.
 *
 * Generic shortcuts (shared across all editor pages):
 * - Grid navigation (Up/Down/Left/Right arrows = grid step, Mod+Up/Down =
 *   measure; Mod+Left/Right = section, bound in TransportControls)
 * - Lane keys (0-5 in Place mode = place/toggle note at cursor)
 * - Tool selection (Mod+1/2/6 always, 1/2/6 when not in Place mode)
 * - Note flags (Q, A, S)
 * - Grid snap (Shift+1 through Shift+6, Shift+0)
 * - Editing (Mod+Z undo, Mod+Shift+Z/Mod+Y redo, Delete, Mod+A, Escape)
 * - Copy/Paste (Mod+C, Mod+V, Mod+X)
 * - Loop region (Mod+L to clear)
 * - Active-track retargeting (Alt+Down / Alt+Up cycle visible tracks)
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

  // The playhead's live tick, UNSNAPPED. `state.cursorTick` only moves on
  // explicit cursor placement (arrow keys, a highway click), so anything
  // that must act "where the playhead is" — paste — has to read the audio
  // position instead. Falls back to `cursorTick` when there's no audio.
  const getPlayheadTick = useCallback((): number => {
    const am = audioManagerRef.current;
    if (!am || !state.chartDoc) return state.cursorTick;
    const timedTempos = buildTimedTempos(
      state.chartDoc.parsedChart.tempos,
      state.chartDoc.parsedChart.resolution,
    );
    if (timedTempos.length === 0) return state.cursorTick;
    return msToTick(
      am.chartTime * 1000,
      timedTempos,
      state.chartDoc.parsedChart.resolution,
    );
  }, [audioManagerRef, state.chartDoc, state.cursorTick]);

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
    return snapTickToGrid(
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
  // Clipboard (Mod+C / Mod+X / Mod+V)
  //
  // Copy captures two independent payloads: the active track's selected
  // notes (tick offsets from the earliest, see `toClipboardNotes`) and the
  // selected lyrics (millisecond offsets from the earliest, see
  // `toClipboardLyrics`). Each payload keeps its own anchor, so a mixed
  // copy pastes notes from the first note and lyrics from the first lyric.
  // -----------------------------------------------------------------------

  /** Notes currently selected on the active track, in chart terms. */
  const getSelectedTrackNotes = useCallback(() => {
    const selectedIds = activeNoteIds(state);
    const track = getActiveTrack();
    const trackKey = trackKeyFromScope(state.activeScope);
    if (selectedIds.size === 0 || !track || !trackKey) {
      return {trackKey: null, selectedIds, notes: [] as SchemaNote[]};
    }
    const schema = schemaForInstrument(trackKey.instrument) ?? drums4LaneSchema;
    const notes = listNotes(track, schema)
      .filter(n => selectedIds.has(noteId(n)))
      .map(n => toSchemaNote(n));
    return {trackKey, selectedIds, notes};
  }, [state, getActiveTrack]);

  /** Selected syllables with their RAW event text, so a paste round-trips
   *  hyphenation and pitch markers rather than the row's display text. */
  const getSelectedLyrics = useCallback(() => {
    const ids = getSelectedIds(state, 'lyric');
    const out: {tick: number; text: string; partName: string}[] = [];
    if (ids.size === 0 || !state.chartDoc) return out;
    const parts = state.chartDoc.parsedChart.vocalTracks?.parts ?? {};
    for (const [partName, part] of Object.entries(parts)) {
      for (const phrase of part.notePhrases) {
        for (const lyric of phrase.lyrics) {
          if (ids.has(lyricId(lyric.tick, partName))) {
            out.push({tick: lyric.tick, text: lyric.text, partName});
          }
        }
      }
    }
    return out;
  }, [state]);

  const writeClipboard = useCallback(() => {
    if (!state.chartDoc) return {notes: [] as SchemaNote[], lyricTicks: []};
    const {notes} = getSelectedTrackNotes();
    const lyrics = getSelectedLyrics();
    if (notes.length === 0 && lyrics.length === 0) {
      return {notes: [] as SchemaNote[], lyricTicks: []};
    }
    const timedTempos = buildTimedTempos(
      state.chartDoc.parsedChart.tempos,
      state.chartDoc.parsedChart.resolution,
    );
    dispatch({
      type: 'SET_CLIPBOARD',
      clipboard: {
        notes: toClipboardNotes(notes),
        lyrics: toClipboardLyrics(
          lyrics,
          timedTempos,
          state.chartDoc.parsedChart.resolution,
        ),
        sourceScope: state.activeScope,
      },
    });
    return {notes, lyricTicks: lyrics};
  }, [state, dispatch, getSelectedTrackNotes, getSelectedLyrics]);

  const clipboardHasSelection =
    activeNoteIds(state).size > 0 || getSelectedIds(state, 'lyric').size > 0;

  useHotkey(
    'Mod+C',
    () => {
      writeClipboard();
    },
    {enabled: clipboardHasSelection},
  );

  useHotkey(
    'Mod+X',
    () => {
      const copied = writeClipboard();
      const commands: EditCommand[] = [];
      const {trackKey, selectedIds} = getSelectedTrackNotes();
      if (trackKey && copied.notes.length > 0) {
        commands.push(
          new DeleteNotesCommand(selectedIds as Set<string>, trackKey),
        );
      }
      for (const lyric of copied.lyricTicks) {
        commands.push(new DeleteLyricCommand(lyric.tick, lyric.partName));
      }
      if (commands.length === 0) return;
      executeCommand(
        commands.length === 1
          ? commands[0]
          : new BatchCommand(commands, 'Cut selection'),
      );
      dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set()});
      dispatch({type: 'SET_SELECTION', kind: 'lyric', ids: new Set()});
    },
    {enabled: clipboardHasSelection},
  );

  // Paste places the clipboard at the PLAYHEAD. Notes land grid-snapped
  // (`pasteAnchorTick`) and keep their tick deltas; lyrics land exactly on
  // the playhead and keep their real-time spacing. Collisions resolve in
  // favour of what is already in the chart: a pasted note whose tick and lane
  // are taken is dropped, and so is a syllable whose tick is taken or that
  // falls outside every phrase. The rest of the paste still lands. The whole
  // paste runs as one `BatchCommand`, so a single undo reverses it.
  useHotkey(
    'Mod+V',
    () => {
      const clipboard = state.clipboard;
      if (isClipboardEmpty(clipboard) || !state.chartDoc) return;

      const {resolution} = state.chartDoc.parsedChart;
      const timedTempos = buildTimedTempos(
        state.chartDoc.parsedChart.tempos,
        resolution,
      );
      const playheadTick = getPlayheadTick();
      const commands: EditCommand[] = [];
      const pastedNoteIds = new Set<string>();
      const pastedLyricIds = new Set<string>();

      const trackKey = trackKeyFromScope(state.activeScope);
      if (trackKey && clipboard.notes.length > 0) {
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
        const anchorTick = pasteAnchorTick(
          playheadTick,
          resolution,
          state.gridDivision,
        );
        const translated = pasteNotesAt(clipboard.notes, anchorTick)
          .map(n => translateSchemaNote(n, sourceSchema, targetSchema))
          .filter((n): n is SchemaNote => n !== null);
        // Existing notes win a tick+lane collision: the pasted duplicate is
        // dropped and the rest of the paste still lands. Dropping it here
        // rather than letting `AddNoteCommand` no-op keeps an all-colliding
        // paste from pushing an empty step onto the undo stack.
        const targetTrack = findTrack(state.chartDoc, trackKey)?.track;
        const occupied = new Set(
          targetTrack
            ? listNotes(targetTrack, targetSchema).map(n => noteId(n))
            : [],
        );
        for (const note of translated) {
          if (occupied.has(noteId(note))) continue;
          commands.push(new AddNoteCommand(note, trackKey, targetSchema));
          pastedNoteIds.add(trackQualifiedNoteId(trackKey, noteId(note)));
        }
      }

      if (clipboard.lyrics.length > 0) {
        const placed = pasteLyricsAt(
          clipboard.lyrics,
          Math.max(0, Math.round(playheadTick)),
          timedTempos,
          resolution,
        );
        // A syllable only lands where `addLyric` would accept it: inside an
        // existing phrase, on a tick no syllable already occupies. Filtering
        // here rather than letting the command no-op keeps a paste that lands
        // nowhere from pushing an empty step onto the undo stack.
        const phrases =
          state.chartDoc.parsedChart.vocalTracks?.parts?.[DEFAULT_VOCALS_PART]
            ?.notePhrases ?? [];
        for (const lyric of placed) {
          const phrase = phrases.find(
            p => lyric.tick >= p.tick && lyric.tick <= p.tick + p.length,
          );
          if (!phrase) continue;
          if (phrase.lyrics.some(l => l.tick === lyric.tick)) continue;
          // Two copied syllables can round onto the same destination tick
          // when the target tempo is faster than the source's; the second
          // one is dropped rather than queued behind a command that would
          // find the tick taken by the time it ran.
          if (pastedLyricIds.has(lyricId(lyric.tick, DEFAULT_VOCALS_PART))) {
            continue;
          }
          commands.push(
            new AddLyricCommand(lyric.tick, lyric.text, DEFAULT_VOCALS_PART),
          );
          pastedLyricIds.add(lyricId(lyric.tick, DEFAULT_VOCALS_PART));
        }
      }

      if (commands.length === 0) return;
      executeCommand(
        new BatchCommand(commands, `Paste ${commands.length} item(s)`),
      );
      if (pastedNoteIds.size > 0) {
        dispatch({type: 'SET_SELECTION', kind: 'note', ids: pastedNoteIds});
      }
      if (pastedLyricIds.size > 0) {
        dispatch({type: 'SET_SELECTION', kind: 'lyric', ids: pastedLyricIds});
      }
    },
    {enabled: !isClipboardEmpty(state.clipboard) && state.chartDoc !== null},
  );

  // -----------------------------------------------------------------------
  // Loop clear (Mod+L)
  // -----------------------------------------------------------------------
  useHotkey('Mod+L', () => {
    dispatch({type: 'SET_LOOP_REGION', region: null});
  });

  // -----------------------------------------------------------------------
  // Select all (Mod+A)
  // -----------------------------------------------------------------------
  useHotkey('Mod+A', () => {
    const track = getActiveTrack();
    if (track) {
      const schema = getActiveSchema();
      const trackKey = trackKeyFromScope(state.activeScope);
      if (!trackKey) return;
      const allIds = new Set(
        listNotes(track, schema).map(n =>
          trackQualifiedNoteId(trackKey, noteId(n)),
        ),
      );
      dispatch({type: 'SET_SELECTION', kind: 'note', ids: allIds});
    }
  });

  // -----------------------------------------------------------------------
  // Retarget keyboard entry to another visible track (Alt+Down / Alt+Up).
  //
  // Pointer-wise, `activeScope` moves with a mousedown in a highway pane.
  // These two bindings are the keyboard-only route to the same thing, and
  // the only route at all to a visible track past the highway's pane cap
  // (it renders in the piano roll but has no pane to click).
  // -----------------------------------------------------------------------
  const cycleActiveTrack = useCallback(
    (direction: 1 | -1) => {
      const ids = Array.from(state.visibleTrackKeys);
      if (ids.length === 0) return;
      const currentId =
        state.activeScope.kind === 'track'
          ? trackKeyId(state.activeScope.track)
          : null;
      const currentIndex = currentId ? ids.indexOf(currentId) : -1;
      const nextIndex =
        currentIndex === -1
          ? direction === 1
            ? 0
            : ids.length - 1
          : (currentIndex + direction + ids.length) % ids.length;
      const nextTrack = parseTrackKeyId(ids[nextIndex]);
      if (!nextTrack) return;
      dispatch({
        type: 'SET_ACTIVE_SCOPE',
        scope: {kind: 'track', track: nextTrack},
      });
    },
    [dispatch, state.activeScope, state.visibleTrackKeys],
  );

  useHotkey('Alt+ArrowDown', () => cycleActiveTrack(1), {
    conflictBehavior: 'allow',
  });
  useHotkey('Alt+ArrowUp', () => cycleActiveTrack(-1), {
    conflictBehavior: 'allow',
  });

  // -----------------------------------------------------------------------
  // Tool selection via Mod+N (always available)
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
    const newTick = nextGridTick(
      baseTick,
      1,
      state.chartDoc.parsedChart.resolution,
      state.gridDivision,
    );
    dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
    seekToTick(newTick);
  });

  useHotkey(
    'ArrowRight',
    () => {
      if (state.isPlaying || !state.chartDoc) return;
      const baseTick = getCursorFromAudio();
      const newTick = nextGridTick(
        baseTick,
        1,
        state.chartDoc.parsedChart.resolution,
        state.gridDivision,
      );
      dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
      seekToTick(newTick);
    },
    {conflictBehavior: 'allow'},
  );

  useHotkey('ArrowDown', () => {
    if (state.isPlaying || !state.chartDoc) return;
    const baseTick = getCursorFromAudio();
    const newTick = nextGridTick(
      baseTick,
      -1,
      state.chartDoc.parsedChart.resolution,
      state.gridDivision,
    );
    dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
    seekToTick(newTick);
  });

  useHotkey(
    'ArrowLeft',
    () => {
      if (state.isPlaying || !state.chartDoc) return;
      const baseTick = getCursorFromAudio();
      const newTick = nextGridTick(
        baseTick,
        -1,
        state.chartDoc.parsedChart.resolution,
        state.gridDivision,
      );
      dispatch({type: 'SET_CURSOR_TICK', tick: newTick});
      seekToTick(newTick);
    },
    {conflictBehavior: 'allow'},
  );

  // -----------------------------------------------------------------------
  // Measure navigation (Mod+Up/Down). Mod+Left/Right is section navigation
  // instead, bound in TransportControls alongside its skip-back/skip-forward
  // buttons (same target computation, same handler) since that's what the
  // transport's tooltips advertise for those keys.
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
  // Tool selection (number keys, when NOT in Place mode)
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
        const selectedIds = activeNoteIds(state);
        if (selectedIds.size > 0 && state.chartDoc) {
          executeCommand(
            new ToggleFlagCommand(
              Array.from(selectedIds),
              flag,
              trackKey,
              schema,
            ),
          );
        }
      },
      {
        enabled: activeNoteIds(state).size > 0 && state.chartDoc !== null,
        conflictBehavior: 'allow',
      },
    );
  }

  // -----------------------------------------------------------------------
  // Delete / Backspace — act on whatever the selection holds. The piano
  // roll's marquee can select several kinds at once, so the command list
  // (and the ordering rule it must respect) is built by
  // `buildDeleteSelectionCommands`; everything goes out in ONE
  // `BatchCommand` so a single undo brings the whole sweep back.
  // -----------------------------------------------------------------------
  const selectedLyricIds = getSelectedIds(state, 'lyric');
  const selectedSectionIds = getSelectedIds(state, 'section');
  const selectedTempoIds = getSelectedIds(state, 'tempo');
  const selectedTimesigIds = getSelectedIds(state, 'timesig');

  const handleDelete = useCallback(() => {
    if (!state.chartDoc) return;
    const commands = buildDeleteSelectionCommands({
      state,
      chartDoc: state.chartDoc,
      noteIds: activeNoteIds(state),
      trackKey: trackKeyFromScope(state.activeScope) ?? null,
      glue: state.tempoGlueMode,
    });
    if (commands.length === 0) return;

    executeCommand(
      commands.length === 1
        ? commands[0]
        : new BatchCommand(commands, `Delete ${commands.length} item(s)`),
    );
    // Everything the sweep touched is gone or (for phrase edges, which are
    // never deleted) no longer worth holding, so the whole selection goes.
    dispatch({type: 'CLEAR_SELECTION'});
  }, [state, executeCommand, dispatch]);

  const canDelete =
    activeNoteIds(state).size > 0 ||
    selectedLyricIds.size > 0 ||
    selectedSectionIds.size > 0 ||
    selectedTempoIds.size > 0 ||
    selectedTimesigIds.size > 0;

  useHotkey('Delete', handleDelete, {enabled: canDelete});

  useHotkey('Backspace', handleDelete, {
    enabled: canDelete,
    conflictBehavior: 'allow',
  });

  // -----------------------------------------------------------------------
  // Escape — deselect all and switch to cursor mode. Explicitly opts out of
  // the editor's ignore-while-typing default: the piano roll's inline lyric
  // editor and the Song Details modal both use Escape to cancel, and the
  // grid-level deselect it also performs here is harmless alongside that.
  // -----------------------------------------------------------------------
  useHotkey(
    'Escape',
    () => {
      dispatch({type: 'CLEAR_SELECTION'});
      dispatch({type: 'SET_ACTIVE_TOOL', tool: 'cursor'});
    },
    {ignoreInputs: false},
  );
}
