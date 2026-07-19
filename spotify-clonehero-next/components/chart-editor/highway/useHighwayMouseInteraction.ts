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
import type {DrumNote, DrumNoteType} from '@/lib/chart-edit';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import {lyricId, phraseEndId, phraseStartId} from '@/lib/chart-edit';
import {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveEntitiesCommand,
  typeToLane,
  LAST_PAD_LANE,
  type EditCommand,
} from '../commands';
import {prospectiveNoteAt} from '../editing/prospectiveNote';
import {entityContextFromScope, trackKeyFromScope} from '../scope';
import {
  getSelectedIds,
  type ChartEditorAction,
  type ChartEditorState,
} from '../ChartEditorContext';
import type {EditorCapabilities} from '../capabilities';
import {AFFORDANCES} from '../affordances';
import type {EntityKind} from '@/lib/chart-edit';
import {selectNotesInRange} from '../editing/marquee';
import {computeNoteDragDelta, exceedsDragThreshold} from '../editing/gestures';
import type {HighwayPopoverState} from './HighwayPopovers';
import type {MarkerDragState, MarkerKind} from './useMarkerDrag';

/**
 * Live state of a multi-note drag. Deltas are anchored on the grabbed note:
 * `tickDelta` is the grid-snapped tick under the cursor minus the grabbed
 * note's tick, so on release the grabbed note lands exactly on the tick the
 * cursor indicator shows. `laneDelta` moves among pad lanes only — kick is
 * not on the lane axis (grabbing a kick pins laneDelta to 0, and pad drags
 * ignore the kick strip in the highway center).
 */
export interface NoteDragState {
  /** Tick of the grabbed note when the drag began. */
  anchorTick: number;
  /** Editor lane (0=kick, 1-4=pads) of the grabbed note. */
  anchorLane: number;
  tickDelta: number;
  laneDelta: number;
  /** True once the pointer has moved past the drag threshold. */
  active: boolean;
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
      const aff = entity ? AFFORDANCES[entity.kind] : null;

      switch (state.activeTool) {
        case 'cursor': {
          // Inline-edit on double-click for kinds that declare it. Today
          // only sections wire up an inline editor (rename popover); other
          // inlineEditable kinds (lyric) edit through the side panel and
          // can grow into this slot.
          if (
            entity &&
            aff?.inlineEditable &&
            capabilities.selectable.has(entity.kind)
          ) {
            const now = Date.now();
            const last = lastClickRef.current;
            if (last && last.tick === entity.tick && now - last.time < 400) {
              lastClickRef.current = null;
              if (entity.kind === 'section') {
                const currentName = hit?.type === 'section' ? hit.name : '';
                onOpenPopover({
                  kind: 'section-rename',
                  tick: entity.tick,
                  x: coords.x,
                  y: coords.y,
                  initialSectionName: currentName,
                  currentSectionName: currentName,
                });
                dispatch({
                  type: 'SET_SELECTION',
                  kind: 'section',
                  ids: new Set([entity.id]),
                });
                break;
              }
            }
            lastClickRef.current = {tick: entity.tick, time: now};
          }

          // Selectable hit: replace or toggle selection. Notes do shift-aware
          // multi-select; markers replace (single-marker selection only).
          if (
            entity &&
            aff?.selectable &&
            capabilities.selectable.has(entity.kind)
          ) {
            if (entity.kind === 'note') {
              const noteSelection = getSelectedIds(state, 'note');
              if (e.shiftKey) {
                const newIds = new Set(noteSelection);
                if (newIds.has(entity.id)) {
                  newIds.delete(entity.id);
                } else {
                  newIds.add(entity.id);
                }
                dispatch({type: 'SET_SELECTION', kind: 'note', ids: newIds});
              } else if (!noteSelection.has(entity.id)) {
                dispatch({
                  type: 'SET_SELECTION',
                  kind: 'note',
                  ids: new Set([entity.id]),
                });
              }
            } else {
              dispatch({
                type: 'SET_SELECTION',
                kind: entity.kind,
                ids: new Set([entity.id]),
              });
              // Clear note selection so the editor doesn't carry stale notes.
              if (getSelectedIds(state, 'note').size > 0) {
                dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set()});
              }
            }

            // Drag init: gated on the page's draggable capability. Notes
            // start a multi-note drag; markers start a single-entity drag
            // through the existing `useMarkerDrag` handler. Both pin hover
            // to the dragged entity so the highlight stays put even if the
            // mousedown landed without a prior mousemove (focus-shift,
            // touch tap-and-drag).
            if (capabilities.draggable.has(entity.kind)) {
              dispatch({
                type: 'SET_HOVER',
                hovered: {kind: entity.kind, id: entity.id},
              });
              if (entity.kind === 'note') {
                setIsDragging(true);
                // Anchor the drag on the grabbed note's own tick + lane so
                // release lands it exactly on the snapped cursor tick, even
                // when the note started off-grid.
                const type = entity.id.slice(
                  entity.id.indexOf(':') + 1,
                ) as DrumNoteType;
                setNoteDrag({
                  anchorTick: entity.tick,
                  anchorLane: typeToLane(type),
                  tickDelta: 0,
                  laneDelta: 0,
                  active: false,
                });
              } else {
                beginMarkerDrag(entity.kind as MarkerKind, entity.tick);
              }
            }
            setDragStart(coords);
            setDragCurrent(coords);
            break;
          }

          // No selectable entity under the cursor. Clear marker selections
          // so the panel doesn't show stale state, then handle the empty-
          // highway case for notes (drum-edit only).
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
          if (capabilities.selectable.has('note')) {
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
          // Toggle: if a note exists at this position, remove it.
          if (hit?.type === 'note') {
            executeCommand(
              new DeleteNotesCommand(new Set([hit.noteId]), trackKey),
            );
          } else {
            // The prospective note (lane → type → flags) is computed by the
            // shared unit both views use, so the highway and the piano-roll
            // ghost predict — and add — the identical note.
            const prospective = prospectiveNoteAt(lane, tick);
            executeCommand(
              new AddNoteCommand(
                {
                  tick: prospective.tick,
                  type: prospective.type,
                  length: 0,
                  flags: prospective.flags,
                },
                trackKey,
              ),
            );
          }
          break;
        }
        case 'erase': {
          // Erase tool: delete the entity if its kind declares deletable.
          // Today only notes have a wired delete command; other deletable
          // kinds (sections, lyrics, phrases) no-op until their handler
          // lands in plan 0034.
          if (entity && aff?.deletable) {
            if (entity.kind === 'note') {
              const trackKey = trackKeyFromScope(state.activeScope);
              if (trackKey) {
                executeCommand(
                  new DeleteNotesCommand(new Set([entity.id]), trackKey),
                );
              }
            }
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
      editingLocked,
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

      // Note drag: update the live preview deltas once past the threshold.
      // The tick delta comes from the grid-snapped cursor tick relative to
      // the grabbed note, so the preview (and the eventual commit) snaps to
      // the current grid subdivision. Lane deltas move among pads only; the
      // kick strip in the highway center is not a lane target.
      if (isDragging && noteDrag && dragStart) {
        const dx = coords.x - dragStart.x;
        const dy = coords.y - dragStart.y;
        if (noteDrag.active || exceedsDragThreshold(dx, dy)) {
          const snappedTick = screenToTick(coords.x, coords.y);
          const {tickDelta, laneDelta} = computeNoteDragDelta({
            anchorTick: noteDrag.anchorTick,
            anchorLane: noteDrag.anchorLane,
            snappedCursorTick: snappedTick,
            cursorLane: screenToLane(coords.x, coords.y),
            selectionSize: getSelectedIds(state, 'note').size,
            prevLaneDelta: noteDrag.laneDelta,
            minPadLane: 1,
            maxPadLane: LAST_PAD_LANE,
          });
          if (
            !noteDrag.active ||
            tickDelta !== noteDrag.tickDelta ||
            laneDelta !== noteDrag.laneDelta
          ) {
            setNoteDrag({...noteDrag, tickDelta, laneDelta, active: true});
          }
          // The cursor indicator shows the exact tick the grabbed note will
          // land on, even when the pointer is over another note.
          setHoverTick(snappedTick);
        }
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
      dispatch,
      dragStart,
      executeCommand,
      getElementCoords,
      hitTestAt,
      isDragging,
      isErasing,
      markerDrag,
      noteDrag,
      screenToLane,
      screenToTick,
      state,
      updateMarkerDrag,
    ],
  );

  const onMouseUp = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const coords = getElementCoords(e);

      const noteSelection = getSelectedIds(state, 'note');
      if (state.activeTool === 'cursor' && dragStart && dragCurrent) {
        if (isDragging && noteSelection.size > 0) {
          // Complete drag-move using the same anchored deltas the live
          // preview showed, so the grabbed note lands exactly where the
          // cursor indicator said it would.
          if (
            noteDrag?.active &&
            (noteDrag.tickDelta !== 0 || noteDrag.laneDelta !== 0)
          ) {
            executeCommand(
              new MoveEntitiesCommand(
                'note',
                Array.from(noteSelection),
                noteDrag.tickDelta,
                noteDrag.laneDelta,
                entityContextFromScope(state.activeScope),
              ),
            );
          }
        } else {
          // Complete box selection.
          const x1 = Math.min(dragStart.x, coords.x);
          const x2 = Math.max(dragStart.x, coords.x);
          const y1 = Math.min(dragStart.y, coords.y);
          const y2 = Math.max(dragStart.y, coords.y);

          // Only do box select if dragged more than a small threshold.
          if (exceedsDragThreshold(x2 - x1, y2 - y1)) {
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
        commitMarkerDrag(exceedsDragThreshold(dx, dy));
      }

      setIsDragging(false);
      setNoteDrag(null);
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
      noteDrag,
      resolution,
      screenToLane,
      screenToMs,
      state,
      timedTempos,
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
