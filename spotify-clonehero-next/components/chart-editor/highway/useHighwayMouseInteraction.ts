'use client';

/**
 * Owns every mouse interaction on the highway: pointer down/move/up/leave,
 * hover state, drag thresholds, box-select math (delegated to
 * `selectInRange`), tool-mode dispatch, and popover-open requests.
 *
 * The hook is *pure-ish* w.r.t. its inputs: it holds local state for
 * hover/drag, but every action flows out via `onOpenPopover`,
 * `executeCommand`, `dispatch`, and the marker-drag handlers. That makes the
 * hook unit-testable with stub inputs.
 *
 * Coordinate helpers (`screenToLane` / `screenToMs` / `screenToTick` /
 * `hitTest`) live inline because they depend on the interaction manager ref
 * and the canvas size — they're tightly scoped to this hook.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import type {HitResult, InteractionManager} from '@/lib/preview/highway';
import type {NoteRenderer} from '@/lib/preview/highway/NoteRenderer';
import type {DrumNote} from '@/lib/chart-edit';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import {lyricId, phraseEndId, phraseStartId} from '@/lib/chart-edit';
import {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveEntitiesCommand,
  laneToType,
  defaultFlagsForType,
  type EditCommand,
} from '../commands';
import {entityContextFromScope, trackKeyFromScope} from '../scope';
import {
  getSelectedIds,
  type ChartEditorAction,
  type ChartEditorState,
} from '../ChartEditorContext';
import type {EditorCapabilities} from '../capabilities';
import {selectNotesInRange} from './selectInRange';
import type {HighwayPopoverState} from './HighwayPopovers';
import type {MarkerDragState, MarkerKind} from './useMarkerDrag';
import {chartMarkerKey, vocalMarkerKey} from '@/lib/preview/highway/markerKeys';

function markerHoverReconcilerKey(
  kind: MarkerKind,
  tick: number,
  partName: string,
): string {
  if (kind === 'section') return chartMarkerKey('section', tick);
  return vocalMarkerKey(kind, partName, tick);
}

export type HoveredHitType =
  | 'note'
  | 'section'
  | 'lyric'
  | 'phrase-start'
  | 'phrase-end'
  | 'highway'
  | null;

export interface UseHighwayMouseInteractionInputs {
  interactionRef: RefObject<HTMLDivElement | null>;
  interactionManagerRef: RefObject<InteractionManager | null>;
  noteRendererRef: RefObject<NoteRenderer | null>;
  state: ChartEditorState;
  capabilities: EditorCapabilities;
  activePartName: string;
  activeNotes: DrumNote[];
  timedTempos: TimedTempo[];
  resolution: number;
  markerDrag: MarkerDragState | null;
  beginMarkerDrag: (kind: MarkerKind, originalTick: number) => void;
  updateMarkerDrag: (rawTick: number) => void;
  commitMarkerDrag: (moveExceededThreshold: boolean) => void;
  executeCommand: (cmd: EditCommand) => void;
  dispatch: (action: ChartEditorAction) => void;
  /** Called from the BPM / TimeSig / Section / Section-rename tools. */
  onOpenPopover: (popover: HighwayPopoverState) => void;
}

export interface UseHighwayMouseInteractionOutputs {
  onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseMove: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseUp: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
  // Surfaces the parent component reads for cursor styling, box-select
  // rendering, and downstream renderer pushes (useHighwaySync /
  // useChartElements).
  hoverLane: number | null;
  hoverTick: number | null;
  hoveredHitType: HoveredHitType;
  hoveredMarkerKey: string | null;
  isDragging: boolean;
  dragStart: {x: number; y: number} | null;
  dragCurrent: {x: number; y: number} | null;
}

/**
 * Tick to which a HitResult corresponds for cursor / placement purposes.
 * Phrase-end uses its `endTick`; lyrics/sections/highway use their `tick`.
 */
function hitTick(hit: HitResult): number | null {
  if (!hit) return null;
  switch (hit.type) {
    case 'note':
    case 'section':
    case 'lyric':
    case 'phrase-start':
    case 'highway':
      return hit.tick;
    case 'phrase-end':
      return hit.endTick;
  }
}

/**
 * Translate a side-marker hit (section/lyric/phrase-start/phrase-end) into
 * its EntityKind + id. Notes and highway hits have separate paths.
 *
 * Lyric and phrase ids are namespaced by `partName` so harm1/harm2/harm3
 * lyrics with the same tick don't collide.
 */
function markerHitToRef(
  hit: HitResult,
  partName: string,
): {kind: MarkerKind; id: string; tick: number} | null {
  if (!hit) return null;
  switch (hit.type) {
    case 'section':
      return {kind: 'section', id: String(hit.tick), tick: hit.tick};
    case 'lyric':
      return {kind: 'lyric', id: lyricId(hit.tick, partName), tick: hit.tick};
    case 'phrase-start':
      return {
        kind: 'phrase-start',
        id: phraseStartId(hit.tick, partName),
        tick: hit.tick,
      };
    case 'phrase-end':
      return {
        kind: 'phrase-end',
        id: phraseEndId(hit.endTick, partName),
        tick: hit.endTick,
      };
    default:
      return null;
  }
}

export function useHighwayMouseInteraction(
  inputs: UseHighwayMouseInteractionInputs,
): UseHighwayMouseInteractionOutputs {
  const {
    interactionRef,
    interactionManagerRef,
    noteRendererRef,
    state,
    capabilities,
    activePartName,
    activeNotes,
    timedTempos,
    resolution,
    markerDrag,
    beginMarkerDrag,
    updateMarkerDrag,
    commitMarkerDrag,
    executeCommand,
    dispatch,
    onOpenPopover,
  } = inputs;

  const [hoverLane, setHoverLane] = useState<number | null>(null);
  const [hoverTick, setHoverTick] = useState<number | null>(null);
  const [hoveredHitType, setHoveredHitType] = useState<HoveredHitType>(null);
  const [hoveredMarkerKey, setHoveredMarkerKey] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [dragStart, setDragStart] = useState<{x: number; y: number} | null>(
    null,
  );
  const [dragCurrent, setDragCurrent] = useState<{x: number; y: number} | null>(
    null,
  );

  // Double-click tracking for section rename.
  const lastClickRef = useRef<{tick: number; time: number} | null>(null);

  // -----------------------------------------------------------------------
  // Coordinate helpers via InteractionManager
  // -----------------------------------------------------------------------

  const getCanvasSize = useCallback((): {w: number; h: number} => {
    const el = interactionRef.current;
    if (!el) return {w: 1, h: 1};
    return {w: el.offsetWidth, h: el.offsetHeight};
  }, [interactionRef]);

  const screenToLane = useCallback(
    (x: number, y: number): number => {
      const im = interactionManagerRef.current;
      if (!im) return 0;
      const {w, h} = getCanvasSize();
      return im.screenToLane(x, y, w, h);
    },
    [getCanvasSize, interactionManagerRef],
  );

  const screenToMs = useCallback(
    (x: number, y: number): number => {
      const im = interactionManagerRef.current;
      if (!im) return 0;
      const {w, h} = getCanvasSize();
      return im.screenToMs(x, y, w, h);
    },
    [getCanvasSize, interactionManagerRef],
  );

  const screenToTick = useCallback(
    (x: number, y: number): number => {
      const im = interactionManagerRef.current;
      if (!im) return 0;
      const {w, h} = getCanvasSize();
      return im.screenToTick(x, y, w, h, state.gridDivision);
    },
    [getCanvasSize, interactionManagerRef, state.gridDivision],
  );

  const hitTestAt = useCallback(
    (x: number, y: number): HitResult => {
      const im = interactionManagerRef.current;
      if (!im) return null;
      const {w, h} = getCanvasSize();
      return im.hitTest(x, y, w, h, state.gridDivision);
    },
    [getCanvasSize, interactionManagerRef, state.gridDivision],
  );

  // -----------------------------------------------------------------------
  // Pixel coordinate helper
  // -----------------------------------------------------------------------

  const getElementCoords = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>): {x: number; y: number} => {
      const el = interactionRef.current!;
      const rect = el.getBoundingClientRect();
      return {x: e.clientX - rect.left, y: e.clientY - rect.top};
    },
    [interactionRef],
  );

  // -----------------------------------------------------------------------
  // Mouse handlers
  // -----------------------------------------------------------------------

  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const coords = getElementCoords(e);
      const hit = hitTestAt(coords.x, coords.y);
      const lane =
        hit && 'lane' in hit ? hit.lane : screenToLane(coords.x, coords.y);
      const tick = hitTick(hit) ?? screenToTick(coords.x, coords.y);

      switch (state.activeTool) {
        case 'cursor': {
          const markerRef = markerHitToRef(hit, activePartName);

          // Section: double-click → rename popover (drum-edit only).
          if (
            markerRef?.kind === 'section' &&
            capabilities.selectable.has('section')
          ) {
            const now = Date.now();
            const last = lastClickRef.current;
            if (last && last.tick === markerRef.tick && now - last.time < 400) {
              lastClickRef.current = null;
              const currentName = hit?.type === 'section' ? hit.name : '';
              onOpenPopover({
                kind: 'section-rename',
                tick: markerRef.tick,
                x: coords.x,
                y: coords.y,
                initialSectionName: currentName,
                currentSectionName: currentName,
              });
              dispatch({
                type: 'SET_SELECTION',
                kind: 'section',
                ids: new Set([markerRef.id]),
              });
              break;
            }
            lastClickRef.current = {tick: markerRef.tick, time: now};
          }

          // Marker hit: select + (optionally) start single-entity drag.
          if (markerRef && capabilities.selectable.has(markerRef.kind)) {
            dispatch({
              type: 'SET_SELECTION',
              kind: markerRef.kind,
              ids: new Set([markerRef.id]),
            });
            // Clear note selection so the editor doesn't carry stale notes.
            if (getSelectedIds(state, 'note').size > 0) {
              dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set()});
            }
            if (capabilities.draggable.has(markerRef.kind)) {
              beginMarkerDrag(markerRef.kind, markerRef.tick);
              setDragStart(coords);
              setDragCurrent(coords);
            }
            break;
          }

          // Click missed any selectable marker — clear marker selections so
          // the panel doesn't keep showing stale state.
          for (const k of [
            'section',
            'lyric',
            'phrase-start',
            'phrase-end',
          ] as const) {
            if (getSelectedIds(state, k).size > 0) {
              dispatch({type: 'SET_SELECTION', kind: k, ids: new Set()});
            }
          }

          // Note hit: select + start multi-note drag (drum-edit only).
          if (hit?.type === 'note' && capabilities.selectable.has('note')) {
            const id = hit.noteId;
            const noteSelection = getSelectedIds(state, 'note');
            if (e.shiftKey) {
              const newIds = new Set(noteSelection);
              if (newIds.has(id)) {
                newIds.delete(id);
              } else {
                newIds.add(id);
              }
              dispatch({type: 'SET_SELECTION', kind: 'note', ids: newIds});
            } else if (!noteSelection.has(id)) {
              dispatch({
                type: 'SET_SELECTION',
                kind: 'note',
                ids: new Set([id]),
              });
            }
            if (capabilities.draggable.has('note')) {
              setIsDragging(true);
            }
            setDragStart(coords);
            setDragCurrent(coords);
          } else if (capabilities.selectable.has('note')) {
            // Empty / inert hit when notes are selectable: box-select or deselect.
            if (!e.shiftKey) {
              dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set()});
            }
            setDragStart(coords);
            setDragCurrent(coords);
          }
          break;
        }
        case 'place': {
          const trackKey = trackKeyFromScope(state.activeScope);
          if (!trackKey) break;
          const type = laneToType(lane);
          // Toggle: if a note exists at this position, remove it.
          if (hit?.type === 'note') {
            executeCommand(
              new DeleteNotesCommand(new Set([hit.noteId]), trackKey),
            );
          } else {
            executeCommand(
              new AddNoteCommand(
                {
                  tick,
                  type,
                  length: 0,
                  flags: defaultFlagsForType(type),
                },
                trackKey,
              ),
            );
          }
          break;
        }
        case 'erase': {
          const trackKey = trackKeyFromScope(state.activeScope);
          if (!trackKey) break;
          if (hit?.type === 'note') {
            executeCommand(
              new DeleteNotesCommand(new Set([hit.noteId]), trackKey),
            );
          }
          setIsErasing(true);
          break;
        }
        case 'bpm': {
          // Pre-fill with the current BPM at this position.
          let initialBpm = 120;
          if (timedTempos.length > 0) {
            let idx = 0;
            for (let i = 1; i < timedTempos.length; i++) {
              if (timedTempos[i].tick <= tick) idx = i;
              else break;
            }
            initialBpm = timedTempos[idx].beatsPerMinute;
          }
          onOpenPopover({
            kind: 'bpm',
            tick,
            x: coords.x,
            y: coords.y,
            initialBpm,
          });
          break;
        }
        case 'timesig': {
          onOpenPopover({kind: 'timesig', tick, x: coords.x, y: coords.y});
          break;
        }
        case 'section': {
          onOpenPopover({kind: 'section', tick, x: coords.x, y: coords.y});
          break;
        }
      }
    },
    [
      activePartName,
      beginMarkerDrag,
      capabilities,
      dispatch,
      executeCommand,
      getElementCoords,
      hitTestAt,
      onOpenPopover,
      screenToLane,
      screenToTick,
      state,
      timedTempos,
    ],
  );

  const onMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const coords = getElementCoords(e);
      const hit = hitTestAt(coords.x, coords.y);
      const markerRef = markerHitToRef(hit, activePartName);

      // Update hover lane/tick from hit result.
      if (hit) {
        setHoverLane(
          'lane' in hit ? hit.lane : screenToLane(coords.x, coords.y),
        );
        setHoverTick(hitTick(hit) ?? screenToTick(coords.x, coords.y));
        setHoveredHitType(hit.type);
      } else {
        setHoverLane(screenToLane(coords.x, coords.y));
        setHoverTick(screenToTick(coords.x, coords.y));
        setHoveredHitType(null);
      }

      // Update note hover highlight via NoteRenderer.
      const hoveredNoteId = hit?.type === 'note' ? hit.noteId : null;
      noteRendererRef.current?.setHoveredNoteId(hoveredNoteId);

      // Track the side-marker under the cursor so its visual gets the
      // hover-bright background. Skip while a drag is in progress: the
      // dragged marker handles its own visual state via markerDrag.
      let nextMarkerKey: string | null = null;
      if (
        !markerDrag &&
        markerRef &&
        capabilities.hoverable.has(markerRef.kind)
      ) {
        nextMarkerKey = markerHoverReconcilerKey(
          markerRef.kind,
          markerRef.tick,
          activePartName,
        );
      }
      if (nextMarkerKey !== hoveredMarkerKey) {
        setHoveredMarkerKey(nextMarkerKey);
      }

      if (dragStart) {
        setDragCurrent(coords);
      }

      // Marker drag: update the live preview tick. The hook clamps to whatever
      // bounds the underlying handler enforces on commit (lyrics stay inside
      // their phrase, phrase-start can't cross the previous phrase's end, etc.).
      if (markerDrag && dragStart) {
        updateMarkerDrag(screenToTick(coords.x, coords.y));
      }

      // Erase mode: paint-erase while dragging.
      if (isErasing && state.activeTool === 'erase') {
        const trackKey = trackKeyFromScope(state.activeScope);
        if (trackKey && hit?.type === 'note') {
          executeCommand(
            new DeleteNotesCommand(new Set([hit.noteId]), trackKey),
          );
        }
      }
    },
    [
      activePartName,
      capabilities,
      dragStart,
      executeCommand,
      getElementCoords,
      hitTestAt,
      hoveredMarkerKey,
      isErasing,
      markerDrag,
      noteRendererRef,
      screenToLane,
      screenToTick,
      state.activeScope,
      state.activeTool,
      updateMarkerDrag,
    ],
  );

  const onMouseUp = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const coords = getElementCoords(e);

      const noteSelection = getSelectedIds(state, 'note');
      if (state.activeTool === 'cursor' && dragStart && dragCurrent) {
        if (isDragging && noteSelection.size > 0) {
          // Complete drag-move.
          const dx = coords.x - dragStart.x;
          const dy = coords.y - dragStart.y;
          // Only apply if moved more than a small threshold.
          if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            const laneDelta =
              screenToLane(coords.x, coords.y) -
              screenToLane(dragStart.x, dragStart.y);
            const startTick = screenToTick(dragStart.x, dragStart.y);
            const endTick = screenToTick(coords.x, coords.y);
            const tickDelta = endTick - startTick;
            if (laneDelta !== 0 || tickDelta !== 0) {
              executeCommand(
                new MoveEntitiesCommand(
                  'note',
                  Array.from(noteSelection),
                  tickDelta,
                  laneDelta,
                  entityContextFromScope(state.activeScope),
                ),
              );
            }
          }
        } else {
          // Complete box selection.
          const x1 = Math.min(dragStart.x, coords.x);
          const x2 = Math.max(dragStart.x, coords.x);
          const y1 = Math.min(dragStart.y, coords.y);
          const y2 = Math.max(dragStart.y, coords.y);

          // Only do box select if dragged more than a small threshold.
          if (Math.abs(x2 - x1) > 5 || Math.abs(y2 - y1) > 5) {
            // y2 is lower on screen = earlier time; y1 is higher = later.
            const lane1 = screenToLane(x1, y1);
            const lane2 = screenToLane(x2, y2);
            const selected = selectNotesInRange(
              activeNotes,
              {
                msMin: screenToMs(x1, y2),
                msMax: screenToMs(x2, y1),
                laneMin: Math.min(lane1, lane2),
                laneMax: Math.max(lane1, lane2),
              },
              timedTempos,
              resolution,
            );

            if (e.shiftKey) {
              // Add to existing selection.
              const merged = new Set(noteSelection);
              selected.forEach(id => merged.add(id));
              dispatch({type: 'SET_SELECTION', kind: 'note', ids: merged});
            } else {
              dispatch({type: 'SET_SELECTION', kind: 'note', ids: selected});
            }
          }
        }
      }

      // Complete single-entity marker drag (sections, lyrics, phrases). The
      // hook owns the actual command + selection update; we just pass the
      // moved-past-threshold bit derived from pixel delta.
      if (markerDrag && dragStart) {
        const dx = coords.x - dragStart.x;
        const dy = coords.y - dragStart.y;
        commitMarkerDrag(Math.abs(dx) > 5 || Math.abs(dy) > 5);
      }

      setIsDragging(false);
      setDragStart(null);
      setDragCurrent(null);
      setIsErasing(false);
    },
    [
      activeNotes,
      commitMarkerDrag,
      dispatch,
      dragCurrent,
      dragStart,
      executeCommand,
      getElementCoords,
      isDragging,
      markerDrag,
      resolution,
      screenToLane,
      screenToMs,
      screenToTick,
      state,
      timedTempos,
    ],
  );

  const onMouseLeave = useCallback(() => {
    setHoverLane(null);
    setHoverTick(null);
    setHoveredHitType(null);
    setHoveredMarkerKey(null);
    setIsErasing(false);
    // Clear note hover highlight.
    noteRendererRef.current?.setHoveredNoteId(null);
    if (!isDragging && !markerDrag) {
      setDragStart(null);
      setDragCurrent(null);
    }
  }, [isDragging, markerDrag, noteRendererRef]);

  return useMemo(
    () => ({
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseLeave,
      hoverLane,
      hoverTick,
      hoveredHitType,
      hoveredMarkerKey,
      isDragging,
      dragStart,
      dragCurrent,
    }),
    [
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseLeave,
      hoverLane,
      hoverTick,
      hoveredHitType,
      hoveredMarkerKey,
      isDragging,
      dragStart,
      dragCurrent,
    ],
  );
}
