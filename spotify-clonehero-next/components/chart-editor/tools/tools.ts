/**
 * The registered `EditorTool`s. `useHighwayMouseInteraction` dispatches every
 * highway pointer event through `registry.ts` into one of these.
 *
 * `cursor` mode (`ToolMode === 'cursor'`) resolves to two tools —
 * `selectMoveTool` and `boxSelectTool` — chosen by `registry.ts` at pointer-
 * down time based on whether a selectable entity is under the cursor.
 *
 * These tools act on notes only: notes are the sole kind the highway draws
 * and hit-tests (`HIGHWAY_ELEMENT_KINDS` in `lib/preview/highway/cell.ts`),
 * so section, tempo, time-signature, lyric, and phrase editing all live in
 * the piano roll.
 */

import {
  parseSchemaNoteId,
  typeToLane as schemaTypeToLane,
  fullLaneRange,
  drums4LaneSchema,
} from '@/lib/chart-edit';
import {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveEntitiesCommand,
} from '../commands';
import {prospectiveNoteAt} from '../editing/prospectiveNote';
import {
  entityContextFromScope,
  localNoteIdsForTrack,
  trackKeyFromScope,
  trackQualifiedNoteId,
} from '../scope';
import {getSelectedIds} from '@/lib/chart-editor-core';
import {AFFORDANCES} from '../affordances';
import {selectNotesInRange} from '../editing/marquee';
import {
  computeNoteDragDelta,
  exceedsDragThreshold,
  selectionLaneSpan,
} from '../editing/gestures';
import type {EditorTool, PointerHitInfo, ToolContext} from './types';

/**
 * Click-to-select / click-and-drag-to-move on notes. Only fires when a
 * selectable note is under the cursor — `boxSelectTool` handles
 * empty-highway clicks.
 */
export const selectMoveTool: EditorTool = {
  id: 'select-move',

  onPointerDown(ctx: ToolContext, evt: PointerHitInfo): void {
    const {entity, coords} = evt;
    // Notes are the only kind the highway hit-tests; markers are selected
    // and moved in the piano roll.
    if (entity?.kind !== 'note') return;
    if (
      !AFFORDANCES.note.selectable ||
      !ctx.capabilities.selectable.has('note')
    ) {
      return;
    }

    const trackKey = trackKeyFromScope(ctx.state.activeScope);
    // Selection ids are stored track-qualified so a note id that exists in
    // more than one track (`"0:green"` on guitar and on bass) can never
    // resolve as "mine" in another pane or piano-roll row.
    const noteSelection = getSelectedIds(ctx.state, 'note');
    const selectionId = trackKey
      ? trackQualifiedNoteId(trackKey, entity.id)
      : entity.id;
    if (evt.shiftKey) {
      const newIds = new Set(noteSelection);
      if (newIds.has(selectionId)) {
        newIds.delete(selectionId);
      } else {
        newIds.add(selectionId);
      }
      ctx.dispatch({type: 'SET_SELECTION', kind: 'note', ids: newIds});
    } else if (!noteSelection.has(selectionId)) {
      ctx.dispatch({
        type: 'SET_SELECTION',
        kind: 'note',
        ids: new Set([selectionId]),
      });
    }

    if (ctx.capabilities.draggable.has('note')) {
      ctx.dispatch({
        type: 'SET_HOVER',
        hovered: {kind: 'note', id: selectionId},
      });
      ctx.drag.setIsDragging(true);
      const parsedId = ctx.schema
        ? parseSchemaNoteId(entity.id, ctx.schema)
        : null;
      ctx.drag.setNoteDrag({
        anchorTick: entity.tick,
        anchorLane:
          parsedId && ctx.schema
            ? schemaTypeToLane(ctx.schema, parsedId.type)
            : 0,
        tickDelta: 0,
        laneDelta: 0,
        active: false,
      });
    }
    ctx.drag.setDragStart(coords);
    ctx.drag.setDragCurrent(coords);
  },

  onPointerMove(ctx: ToolContext, evt: PointerHitInfo): void {
    const {coords} = evt;
    if (ctx.drag.isDragging && ctx.drag.noteDrag && ctx.drag.dragStart) {
      const noteDrag = ctx.drag.noteDrag;
      const dx = coords.x - ctx.drag.dragStart.x;
      const dy = coords.y - ctx.drag.dragStart.y;
      if (noteDrag.active || exceedsDragThreshold(dx, dy)) {
        const snappedTick = ctx.screenToTick(coords.x, coords.y);
        const dragSchema = ctx.schema ?? drums4LaneSchema;
        const {min: minLane, max: maxLane} = fullLaneRange(dragSchema);
        const span = selectionLaneSpan(
          Array.from(getSelectedIds(ctx.state, 'note')),
          dragSchema,
          noteDrag.anchorLane,
        );
        const {tickDelta, laneDelta} = computeNoteDragDelta({
          anchorTick: noteDrag.anchorTick,
          anchorLane: noteDrag.anchorLane,
          snappedCursorTick: snappedTick,
          cursorLane: ctx.screenToLane(coords.x, coords.y),
          prevLaneDelta: noteDrag.laneDelta,
          minLane,
          maxLane,
          selectionMinLane: span.min,
          selectionMaxLane: span.max,
        });
        if (
          !noteDrag.active ||
          tickDelta !== noteDrag.tickDelta ||
          laneDelta !== noteDrag.laneDelta
        ) {
          ctx.drag.setNoteDrag({
            ...noteDrag,
            tickDelta,
            laneDelta,
            active: true,
          });
        }
        ctx.drag.setHoverTick(snappedTick);
      }
    }
  },

  onPointerUp(ctx: ToolContext): void {
    const trackKey = trackKeyFromScope(ctx.state.activeScope);
    const noteSelection = trackKey
      ? new Set(
          localNoteIdsForTrack(getSelectedIds(ctx.state, 'note'), trackKey),
        )
      : new Set<string>();
    const noteDrag = ctx.drag.noteDrag;
    if (
      noteDrag?.active &&
      (noteDrag.tickDelta !== 0 || noteDrag.laneDelta !== 0) &&
      noteSelection.size > 0
    ) {
      ctx.executeCommand(
        new MoveEntitiesCommand(
          'note',
          Array.from(noteSelection),
          noteDrag.tickDelta,
          noteDrag.laneDelta,
          entityContextFromScope(ctx.state.activeScope),
        ),
      );
    }
  },
};

/**
 * Empty-highway click/drag in cursor mode: clears stale marker selections,
 * then either clears/starts note selection (click) or marquee-selects notes
 * in the dragged rectangle (drag past the threshold).
 */
export const boxSelectTool: EditorTool = {
  id: 'box-select',

  onPointerDown(ctx: ToolContext, evt: PointerHitInfo): void {
    for (const k of [
      'section',
      'lyric',
      'phrase-start',
      'phrase-end',
    ] as const) {
      if (getSelectedIds(ctx.state, k).size > 0) {
        ctx.dispatch({type: 'SET_SELECTION', kind: k, ids: new Set()});
      }
    }
    if (ctx.capabilities.selectable.has('note')) {
      if (!evt.shiftKey) {
        ctx.dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set()});
      }
      ctx.drag.setDragStart(evt.coords);
      ctx.drag.setDragCurrent(evt.coords);
    }
  },

  onPointerUp(ctx: ToolContext, evt: PointerHitInfo): void {
    const dragStart = ctx.drag.dragStart;
    if (!dragStart) return;
    const coords = evt.coords;
    const x1 = Math.min(dragStart.x, coords.x);
    const x2 = Math.max(dragStart.x, coords.x);
    const y1 = Math.min(dragStart.y, coords.y);
    const y2 = Math.max(dragStart.y, coords.y);

    if (!exceedsDragThreshold(x2 - x1, y2 - y1)) return;

    // y2 is lower on screen = earlier time; y1 is higher = later.
    const lane1 = ctx.screenToLane(x1, y1);
    const lane2 = ctx.screenToLane(x2, y2);
    const selected = selectNotesInRange(
      ctx.activeNotes,
      {
        msMin: ctx.screenToMs(x1, y2),
        msMax: ctx.screenToMs(x2, y1),
        laneMin: Math.min(lane1, lane2),
        laneMax: Math.max(lane1, lane2),
      },
      ctx.timedTempos,
      ctx.resolution,
      ctx.schema ?? drums4LaneSchema,
    );

    const trackKey = trackKeyFromScope(ctx.state.activeScope);
    if (trackKey) {
      // Marquee results are local ids from this track's note list; store
      // them track-qualified like every other selection id.
      const qualified = new Set(
        Array.from(selected).map(id => trackQualifiedNoteId(trackKey, id)),
      );
      if (evt.shiftKey) {
        const current = new Set(getSelectedIds(ctx.state, 'note'));
        qualified.forEach(id => current.add(id));
        ctx.dispatch({type: 'SET_SELECTION', kind: 'note', ids: current});
      } else {
        ctx.dispatch({type: 'SET_SELECTION', kind: 'note', ids: qualified});
      }
    } else if (evt.shiftKey) {
      const merged = new Set(getSelectedIds(ctx.state, 'note'));
      selected.forEach(id => merged.add(id));
      ctx.dispatch({type: 'SET_SELECTION', kind: 'note', ids: merged});
    } else {
      ctx.dispatch({type: 'SET_SELECTION', kind: 'note', ids: selected});
    }
  },
};

/** Click to add a note; click an existing note to remove it (toggle). */
export const placeNoteTool: EditorTool = {
  id: 'place',

  onPointerDown(ctx: ToolContext, evt: PointerHitInfo): void {
    const trackKey = trackKeyFromScope(ctx.state.activeScope);
    if (!trackKey || !ctx.schema) return;
    if (evt.hit?.type === 'note') {
      ctx.executeCommand(
        new DeleteNotesCommand(new Set([evt.hit.noteId]), trackKey),
      );
      return;
    }
    // The prospective note (lane → type → flags) is computed by the shared
    // unit both views use, so the highway and the piano-roll ghost predict —
    // and add — the identical note.
    const prospective = prospectiveNoteAt(evt.lane, evt.tick, ctx.schema);
    ctx.executeCommand(
      new AddNoteCommand(
        {
          tick: prospective.tick,
          type: prospective.type,
          length: 0,
          flags: prospective.flags,
        },
        trackKey,
        ctx.schema,
      ),
    );
  },
};

/** Click/paint-drag to delete notes under the cursor. Notes are the only
 *  kind the highway hit-tests; markers are erased from the piano roll. */
export const eraseTool: EditorTool = {
  id: 'erase',

  onPointerDown(ctx: ToolContext, evt: PointerHitInfo): void {
    const {entity} = evt;
    if (
      entity &&
      AFFORDANCES[entity.kind].deletable &&
      entity.kind === 'note'
    ) {
      const trackKey = trackKeyFromScope(ctx.state.activeScope);
      if (trackKey) {
        ctx.executeCommand(
          new DeleteNotesCommand(new Set([entity.id]), trackKey),
        );
      }
    }
    ctx.drag.setIsErasing(true);
  },

  onPointerMove(ctx: ToolContext, evt: PointerHitInfo): void {
    if (!ctx.drag.isErasing) return;
    const trackKey = trackKeyFromScope(ctx.state.activeScope);
    if (trackKey && evt.hit?.type === 'note') {
      ctx.executeCommand(
        new DeleteNotesCommand(new Set([evt.hit.noteId]), trackKey),
      );
    }
  },
};
