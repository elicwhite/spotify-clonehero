'use client';

import {useEffect, useRef} from 'react';
import {useChartEditorContext} from './ChartEditorContext';
import {useExecuteCommand, useUndoRedo} from './hooks/useEditCommands';
import {
  noteId,
  AddNoteCommand,
  DeleteNotesCommand,
  ToggleFlagCommand,
  type FlagName,
} from './commands';
import {getDrumNotes} from '@/lib/chart-edit';
import type {DrumNoteType} from '@/lib/chart-edit';
import {buildTimedTempos, tickToMs} from '@/lib/drum-transcription/timing';
import {typeToLane} from './commands';

/**
 * Registers WebMCP tools for the drum chart editor via navigator.modelContext.
 * Must be rendered inside a ChartEditorProvider.
 *
 * Tools are callable via navigator.modelContextTesting.executeTool() or
 * by any connected AI agent (Claude, etc.) through the WebMCP protocol.
 */
export default function EditorMCPTools() {
  const {state, dispatch, audioManagerRef, noteRendererRef} =
    useChartEditorContext();
  const {executeCommand} = useExecuteCommand();
  const {undo, redo, canUndo, canRedo} = useUndoRedo();

  // Use refs to capture latest values without re-registering tools.
  // The refs are updated in an effect so the writes happen after
  // commit, not during render — see react-hooks/refs.
  const stateRef = useRef(state);
  const executeCommandRef = useRef(executeCommand);
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  const canUndoRef = useRef(canUndo);
  const canRedoRef = useRef(canRedo);
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    stateRef.current = state;
    executeCommandRef.current = executeCommand;
    undoRef.current = undo;
    redoRef.current = redo;
    canUndoRef.current = canUndo;
    canRedoRef.current = canRedo;
    dispatchRef.current = dispatch;
  });

  useEffect(() => {
    if (
      !navigator.modelContext ||
      typeof navigator.modelContext.registerTool !== 'function'
    ) {
      return;
    }

    const toolNames: string[] = [];
    const register = (def: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      execute: (
        args: Record<string, unknown>,
      ) => Promise<{content: Array<{type: string; text: string}>}>;
    }) => {
      navigator.modelContext!.registerTool(def);
      toolNames.push(def.name);
    };

    // --- editor_state ---
    register({
      name: 'editor_state',
      description:
        'Get current editor state: selection, tool, position, chart info.',
      inputSchema: {type: 'object', properties: {}},
      execute: async () => {
        const s = stateRef.current;
        const am = audioManagerRef.current;
        let selectedNotes: Array<{
          id: string;
          tick: number;
          type: string;
          flags: Record<string, boolean>;
        }> = [];
        if (s.chartDoc && s.selectedNoteIds.size > 0) {
          const track = s.chartDoc.parsedChart.trackData.find(
            t => t.instrument === 'drums' && t.difficulty === 'expert',
          );
          if (track) {
            selectedNotes = getDrumNotes(track)
              .filter(n => s.selectedNoteIds.has(noteId(n)))
              .map(n => ({
                id: noteId(n),
                tick: n.tick,
                type: n.type,
                flags: {
                  cymbal: !!n.flags.cymbal,
                  accent: !!n.flags.accent,
                  ghost: !!n.flags.ghost,
                },
              }));
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  activeTool: s.activeTool,
                  cursorTick: s.cursorTick,
                  gridDivision: s.gridDivision,
                  isPlaying: s.isPlaying,
                  playbackSpeed: s.playbackSpeed,
                  zoom: s.zoom,
                  dirty: s.dirty,
                  currentTimeMs: am ? am.currentTime * 1000 : 0,
                  durationMs: am ? am.duration * 1000 : 0,
                  selectedNoteCount: s.selectedNoteIds.size,
                  selectedNotes,
                  totalNotes: s.chartDoc
                    ? (() => {
                        const t = s.chartDoc!.parsedChart.trackData.find(
                          tr =>
                            tr.instrument === 'drums' &&
                            tr.difficulty === 'expert',
                        );
                        return t ? getDrumNotes(t).length : 0;
                      })()
                    : 0,
                  sectionCount: s.chartDoc?.parsedChart.sections.length ?? 0,
                  canUndo: canUndoRef.current,
                  canRedo: canRedoRef.current,
                  highwayMode: s.highwayMode,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    });

    // --- editor_seek ---
    register({
      name: 'editor_seek',
      description: 'Seek to a time (ms) or tick position.',
      inputSchema: {
        type: 'object',
        properties: {timeMs: {type: 'number'}, tick: {type: 'number'}},
      },
      execute: async args => {
        const am = audioManagerRef.current;
        const s = stateRef.current;
        if (!am) return {content: [{type: 'text', text: 'No AudioManager'}]};
        let seekMs: number;
        if (args.tick !== undefined && s.chartDoc) {
          const tt = buildTimedTempos(
            s.chartDoc.parsedChart.tempos,
            s.chartDoc.parsedChart.resolution,
          );
          seekMs = tickToMs(
            args.tick as number,
            tt,
            s.chartDoc.parsedChart.resolution,
          );
          dispatchRef.current({
            type: 'SET_CURSOR_TICK',
            tick: args.tick as number,
          });
        } else if (args.timeMs !== undefined) {
          seekMs = args.timeMs as number;
        } else {
          return {content: [{type: 'text', text: 'Provide timeMs or tick'}]};
        }
        await am.play({time: seekMs / 1000});
        await am.pause();
        return {
          content: [{type: 'text', text: `Seeked to ${seekMs.toFixed(0)}ms`}],
        };
      },
    });

    // --- editor_list_notes ---
    register({
      name: 'editor_list_notes',
      description: 'List drum notes in a tick range.',
      inputSchema: {
        type: 'object',
        properties: {
          startTick: {type: 'number'},
          endTick: {type: 'number'},
          limit: {type: 'number'},
        },
      },
      execute: async args => {
        const s = stateRef.current;
        if (!s.chartDoc)
          return {content: [{type: 'text', text: 'No chart loaded'}]};
        const track = s.chartDoc.parsedChart.trackData.find(
          t => t.instrument === 'drums' && t.difficulty === 'expert',
        );
        if (!track)
          return {content: [{type: 'text', text: 'No expert drums track'}]};
        const startTick = (args.startTick as number) ?? 0;
        const endTick = (args.endTick as number) ?? startTick + 1920;
        const limit = (args.limit as number) ?? 50;
        const notes = getDrumNotes(track)
          .filter(n => n.tick >= startTick && n.tick <= endTick)
          .slice(0, limit)
          .map(n => ({
            id: noteId(n),
            tick: n.tick,
            type: n.type,
            lane: typeToLane(n.type),
            flags: {
              cymbal: !!n.flags.cymbal,
              accent: !!n.flags.accent,
              ghost: !!n.flags.ghost,
            },
          }));
        return {
          content: [{type: 'text', text: JSON.stringify(notes, null, 2)}],
        };
      },
    });

    // --- editor_select_note ---
    register({
      name: 'editor_select_note',
      description: 'Select a note by tick and type.',
      inputSchema: {
        type: 'object',
        properties: {
          tick: {type: 'number'},
          type: {type: 'string'},
          addToSelection: {type: 'boolean'},
        },
        required: ['tick', 'type'],
      },
      execute: async args => {
        const id = `${args.tick}:${args.type}`;
        const add = (args.addToSelection as boolean) ?? false;
        const newIds = add
          ? new Set(stateRef.current.selectedNoteIds)
          : new Set<string>();
        newIds.add(id);
        dispatchRef.current({type: 'SET_SELECTED_NOTES', noteIds: newIds});
        // NoteRenderer selection state is pushed by HighwayEditor's overlay effect
        return {
          content: [
            {type: 'text', text: `Selected: ${id} (total: ${newIds.size})`},
          ],
        };
      },
    });

    // --- editor_toggle_flag ---
    register({
      name: 'editor_toggle_flag',
      description: 'Toggle a flag (cymbal, accent, ghost) on selected notes.',
      inputSchema: {
        type: 'object',
        properties: {flag: {type: 'string'}},
        required: ['flag'],
      },
      execute: async args => {
        const flag = args.flag as FlagName;
        if (!['cymbal', 'accent', 'ghost'].includes(flag))
          return {content: [{type: 'text', text: 'Invalid flag'}]};
        const s = stateRef.current;
        if (s.selectedNoteIds.size === 0)
          return {content: [{type: 'text', text: 'No notes selected'}]};
        executeCommandRef.current(
          new ToggleFlagCommand(Array.from(s.selectedNoteIds), flag),
        );
        return {
          content: [
            {
              type: 'text',
              text: `Toggled ${flag} on ${s.selectedNoteIds.size} note(s)`,
            },
          ],
        };
      },
    });

    // --- editor_add_note ---
    register({
      name: 'editor_add_note',
      description: 'Add a drum note at a tick and type.',
      inputSchema: {
        type: 'object',
        properties: {
          tick: {type: 'number'},
          type: {type: 'string'},
          cymbal: {type: 'boolean'},
        },
        required: ['tick', 'type'],
      },
      execute: async args => {
        const type = args.type as DrumNoteType;
        const tick = args.tick as number;
        const cymbalDefault =
          type === 'yellowDrum' || type === 'blueDrum' || type === 'greenDrum';
        const cymbal = (args.cymbal as boolean) ?? cymbalDefault;
        executeCommandRef.current(
          new AddNoteCommand({tick, type, length: 0, flags: {cymbal}}),
        );
        return {
          content: [{type: 'text', text: `Added ${type} at tick ${tick}`}],
        };
      },
    });

    // --- editor_delete_selected ---
    register({
      name: 'editor_delete_selected',
      description: 'Delete all selected notes.',
      inputSchema: {type: 'object', properties: {}},
      execute: async () => {
        const s = stateRef.current;
        if (s.selectedNoteIds.size === 0)
          return {content: [{type: 'text', text: 'No notes selected'}]};
        executeCommandRef.current(new DeleteNotesCommand(s.selectedNoteIds));
        dispatchRef.current({type: 'SET_SELECTED_NOTES', noteIds: new Set()});
        return {
          content: [
            {type: 'text', text: `Deleted ${s.selectedNoteIds.size} note(s)`},
          ],
        };
      },
    });

    // --- editor_set_tool ---
    register({
      name: 'editor_set_tool',
      description:
        'Switch active tool: cursor, place, erase, bpm, timesig, section',
      inputSchema: {
        type: 'object',
        properties: {tool: {type: 'string'}},
        required: ['tool'],
      },
      execute: async args => {
        dispatchRef.current({type: 'SET_ACTIVE_TOOL', tool: args.tool as any});
        return {content: [{type: 'text', text: `Tool: ${args.tool}`}]};
      },
    });

    // --- editor_undo / editor_redo ---
    register({
      name: 'editor_undo',
      description: 'Undo the last action.',
      inputSchema: {type: 'object', properties: {}},
      execute: async () => {
        if (!canUndoRef.current)
          return {content: [{type: 'text', text: 'Nothing to undo'}]};
        undoRef.current();
        return {content: [{type: 'text', text: 'Undone'}]};
      },
    });

    register({
      name: 'editor_redo',
      description: 'Redo the last undone action.',
      inputSchema: {type: 'object', properties: {}},
      execute: async () => {
        if (!canRedoRef.current)
          return {content: [{type: 'text', text: 'Nothing to redo'}]};
        redoRef.current();
        return {content: [{type: 'text', text: 'Redone'}]};
      },
    });

    // --- editor_play / editor_pause ---
    register({
      name: 'editor_play',
      description: 'Start playback.',
      inputSchema: {type: 'object', properties: {}},
      execute: async () => {
        const am = audioManagerRef.current;
        if (!am) return {content: [{type: 'text', text: 'No AudioManager'}]};
        await am.resume();
        dispatchRef.current({type: 'SET_PLAYING', isPlaying: true});
        return {content: [{type: 'text', text: 'Playing'}]};
      },
    });

    register({
      name: 'editor_pause',
      description: 'Pause playback.',
      inputSchema: {type: 'object', properties: {}},
      execute: async () => {
        const am = audioManagerRef.current;
        if (!am) return {content: [{type: 'text', text: 'No AudioManager'}]};
        await am.pause();
        dispatchRef.current({type: 'SET_PLAYING', isPlaying: false});
        return {content: [{type: 'text', text: 'Paused'}]};
      },
    });

    return () => {
      // Cleanup: unregister tools on unmount
      if (
        navigator.modelContext &&
        typeof (navigator.modelContext as any).unregisterTool === 'function'
      ) {
        for (const name of toolNames) {
          try {
            (navigator.modelContext as any).unregisterTool(name);
          } catch {
            /* ignore */
          }
        }
      }
    };
  }, []); // Register once on mount, use refs for latest state

  return null;
}
