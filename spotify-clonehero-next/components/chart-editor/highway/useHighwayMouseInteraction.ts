'use client';

/**
 * Owns every mouse interaction on the highway: pointer down/move/up/leave,
 * hover state, tool-mode dispatch, and popover-open requests. Edit semantics
 * shared with the piano-roll timeline — grid/delta snapping, drag thresholds,
 * lane-locked multi-drag, and marquee range-selection — live in the shared
 * `../editing/` modules (`gestures`, `marquee`) and `lib/chart-edit`'s
 * `snapTickToGrid`; this hook only resolves screen coordinates and calls them.
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
import type {DrumNote, EntityKind} from '@/lib/chart-edit';
import {lyricId, phraseEndId, phraseStartId} from '@/lib/chart-edit';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import type {EditCommand} from '../commands';
import type {ChartEditorAction, ChartEditorState} from '@/lib/chart-editor-core';
import type {EditorCapabilities} from '../capabilities';
import type {HighwayPopoverState} from './HighwayPopovers';
import type {MarkerDragState, MarkerKind} from './useMarkerDrag';
import {
  TOOL_REGISTRY,
  resolveCursorContinuation,
  resolveToolForPointerDown,
} from '../tools/registry';
import type {
  NoteDragState as ToolNoteDragState,
  PointerHitInfo,
  ToolContext,
} from '../tools/types';

/**
 * Live state of a multi-note drag. Deltas are anchored on the grabbed note:
 * `tickDelta` is the grid-snapped tick under the cursor minus the grabbed
 * note's tick, so on release the grabbed note lands exactly on the tick the
 * cursor indicator shows. `laneDelta` moves among pad lanes only — kick is
 * not on the lane axis (grabbing a kick pins laneDelta to 0, and pad drags
 * ignore the kick strip in the highway center).
 *
 * Defined on `EditorTool`'s `ToolContext` (`../tools/types`) since
 * `selectMoveTool` owns note-drag deltas now; re-exported here so existing
 * consumers of this hook's output type are unaffected.
 */
export type NoteDragState = ToolNoteDragState;

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
  /**
   * When true, an uncommitted tempo candidate is being previewed (0061 §7):
   * the highway renders the candidate doc while commands still target the
   * committed doc, so a click could hit a candidate-only note. Editing gestures
   * (select/place/erase/drag/popover) are suppressed for the read-only
   * accept/reject preview contract (plan 0062 finding — "read-only +
   * accept/reject"); scrub (wheel) stays live since it's handled outside this
   * hook.
   */
  editingLocked?: boolean | undefined;
}

export interface UseHighwayMouseInteractionOutputs {
  onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseMove: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseUp: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
  // Surfaces the parent component reads for cursor styling and box-select
  // rendering. Hover state itself lives in `state.hovered` on the editor
  // reducer; the reconciler push effect translates it to a reconciler key.
  hoverLane: number | null;
  hoverTick: number | null;
  hoveredHitType: HoveredHitType;
  isDragging: boolean;
  /** Live note-drag deltas for the renderer preview (null outside a drag). */
  noteDrag: NoteDragState | null;
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

/**
 * Unified hit → entity-ref translation across all selectable kinds.
 * Notes and side-markers funnel through one shape so the cursor-tool
 * dispatch can read affordances by kind without per-hit-type branches.
 *
 * Returns null for highway-plane hits or when there's no hit.
 */
function hitToEntityRef(
  hit: HitResult,
  partName: string,
): {kind: EntityKind; id: string; tick: number} | null {
  if (!hit) return null;
  if (hit.type === 'note') {
    return {kind: 'note', id: hit.noteId, tick: hit.tick};
  }
  return markerHitToRef(hit, partName);
}

export function useHighwayMouseInteraction(
  inputs: UseHighwayMouseInteractionInputs,
): UseHighwayMouseInteractionOutputs {
  const {
    interactionRef,
    interactionManagerRef,
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
    editingLocked = false,
  } = inputs;

  const [hoverLane, setHoverLane] = useState<number | null>(null);
  const [hoverTick, setHoverTick] = useState<number | null>(null);
  const [hoveredHitType, setHoveredHitType] = useState<HoveredHitType>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [noteDrag, setNoteDrag] = useState<NoteDragState | null>(null);
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
  // Tool context — built fresh per pointer event and handed to whichever
  // `EditorTool`(s) `../tools/registry` resolves for `state.activeTool`.
  // -----------------------------------------------------------------------

  const buildToolContext = useCallback((): ToolContext => {
    return {
      state,
      capabilities,
      activePartName,
      activeNotes,
      timedTempos,
      resolution,
      dispatch,
      executeCommand,
      onOpenPopover,
      screenToLane,
      screenToMs,
      screenToTick,
      markerDrag,
      beginMarkerDrag,
      updateMarkerDrag,
      commitMarkerDrag,
      drag: {
        isDragging,
        setIsDragging,
        noteDrag,
        setNoteDrag,
        isErasing,
        setIsErasing,
        dragStart,
        setDragStart,
        dragCurrent,
        setDragCurrent,
        setHoverTick,
        lastClick: lastClickRef.current,
        setLastClick: value => {
          lastClickRef.current = value;
        },
      },
    };
  }, [
    activeNotes,
    activePartName,
    beginMarkerDrag,
    capabilities,
    commitMarkerDrag,
    dispatch,
    dragCurrent,
    dragStart,
    executeCommand,
    isDragging,
    isErasing,
    markerDrag,
    noteDrag,
    onOpenPopover,
    resolution,
    screenToLane,
    screenToMs,
    screenToTick,
    state,
    timedTempos,
    updateMarkerDrag,
  ]);

  // -----------------------------------------------------------------------
  // Mouse handlers
  // -----------------------------------------------------------------------

  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      // Read-only while a tempo candidate is previewed: no select/place/erase/
      // drag/popover can start (the accept/reject bar is the only affordance).
      if (editingLocked) return;
      const coords = getElementCoords(e);
      const hit = hitTestAt(coords.x, coords.y);
      const lane =
        hit && 'lane' in hit ? hit.lane : screenToLane(coords.x, coords.y);
      const tick = hitTick(hit) ?? screenToTick(coords.x, coords.y);

      const entity = hitToEntityRef(hit, activePartName);

      const evt: PointerHitInfo = {
        coords,
        shiftKey: e.shiftKey,
        hit,
        lane,
        tick,
        entity,
      };
      const tool = resolveToolForPointerDown(state.activeTool, evt, capabilities);
      tool?.onPointerDown(buildToolContext(), evt);
    },
    [
      activePartName,
      buildToolContext,
      capabilities,
      editingLocked,
      getElementCoords,
      hitTestAt,
      screenToLane,
      screenToTick,
      state.activeTool,
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

      // Update the editor's hover anchor. While a drag is active, leave the
      // dragged entity hovered: the drag-begin dispatch pinned it, and we
      // don't want the hover visual to flicker as the cursor passes over
      // other entities mid-drag.
      if (!markerDrag && !isDragging) {
        let nextHover: {
          kind: 'note' | 'section' | 'lyric' | 'phrase-start' | 'phrase-end';
          id: string;
        } | null = null;
        if (hit?.type === 'note' && capabilities.hoverable.has('note')) {
          nextHover = {kind: 'note', id: hit.noteId};
        } else if (markerRef && capabilities.hoverable.has(markerRef.kind)) {
          nextHover = {kind: markerRef.kind, id: markerRef.id};
        }
        dispatch({type: 'SET_HOVER', hovered: nextHover});
      }

      if (dragStart) {
        setDragCurrent(coords);
      }

      // Tool-specific move continuation: note-drag/marker-drag preview
      // (`selectMoveTool`) and paint-erase (`eraseTool`). `'cursor'` mode
      // routes to whichever tool started the in-flight gesture — see
      // `resolveCursorContinuation`.
      const evt: PointerHitInfo = {
        coords,
        shiftKey: e.shiftKey,
        hit,
        lane:
          hit && 'lane' in hit ? hit.lane : screenToLane(coords.x, coords.y),
        tick: hitTick(hit) ?? screenToTick(coords.x, coords.y),
        entity: hitToEntityRef(hit, activePartName),
      };
      const ctx = buildToolContext();
      if (state.activeTool === 'cursor') {
        resolveCursorContinuation(ctx).onPointerMove?.(ctx, evt);
      } else {
        for (const tool of TOOL_REGISTRY[state.activeTool]) {
          tool.onPointerMove?.(ctx, evt);
        }
      }
    },
    [
      activePartName,
      buildToolContext,
      capabilities.hoverable,
      dispatch,
      dragStart,
      getElementCoords,
      hitTestAt,
      isDragging,
      markerDrag,
      screenToLane,
      screenToTick,
      state.activeTool,
    ],
  );

  const onMouseUp = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const coords = getElementCoords(e);

      // Tool-specific up completion: drag-move-commit or box-select-commit
      // (`'cursor'` mode, routed to whichever tool owns the in-flight
      // gesture) and marker-drag commit (any tool, since a marker drag can
      // be released while the pointer has moved off the highway plane).
      if (dragStart && dragCurrent) {
        const evt: PointerHitInfo = {
          coords,
          shiftKey: e.shiftKey,
          hit: null,
          lane: screenToLane(coords.x, coords.y),
          tick: screenToTick(coords.x, coords.y),
          entity: null,
        };
        const ctx = buildToolContext();
        if (state.activeTool === 'cursor') {
          resolveCursorContinuation(ctx).onPointerUp?.(ctx, evt);
        } else {
          for (const tool of TOOL_REGISTRY[state.activeTool]) {
            tool.onPointerUp?.(ctx, evt);
          }
        }
      }

      setIsDragging(false);
      setNoteDrag(null);
      setDragStart(null);
      setDragCurrent(null);
      setIsErasing(false);
    },
    [
      buildToolContext,
      dragCurrent,
      dragStart,
      getElementCoords,
      screenToLane,
      screenToTick,
      state.activeTool,
    ],
  );

  const onMouseLeave = useCallback(() => {
    setHoverLane(null);
    setHoverTick(null);
    setHoveredHitType(null);
    setIsErasing(false);
    // Clear hover state in the editor reducer (no entity is under the
    // cursor any more). Drag retains its own pin, so a leave during a
    // multi-note or marker drag does not clear the dragged entity's hover.
    if (!isDragging && !markerDrag) {
      dispatch({type: 'SET_HOVER', hovered: null});
      setDragStart(null);
      setDragCurrent(null);
    }
  }, [dispatch, isDragging, markerDrag]);

  return useMemo(
    () => ({
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseLeave,
      hoverLane,
      hoverTick,
      hoveredHitType,
      isDragging,
      noteDrag,
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
      isDragging,
      noteDrag,
      dragStart,
      dragCurrent,
    ],
  );
}
