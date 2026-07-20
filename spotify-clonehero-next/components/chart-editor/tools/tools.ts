/**
 * The registered `EditorTool`s. Each one is the direct extraction of one
 * `case` in `useHighwayMouseInteraction`'s former `switch (state.activeTool)`
 * (see plan 0038 Task 7); behavior is unchanged, only relocated so the hook
 * dispatches through `registry.ts` instead of a hardcoded switch.
 *
 * `cursor` mode (`ToolMode === 'cursor'`) resolves to two tools —
 * `selectMoveTool` and `boxSelectTool` — chosen by `registry.ts` at pointer-
 * down time based on whether a selectable entity is under the cursor,
 * mirroring the single `case 'cursor':` branch it replaces.
 *
 * `sectionTool` (the toolbar's "add section" tool, `ToolMode === 'section'`)
 * is distinct from the double-click-to-rename affordance on an *existing*
 * section: that rename gesture fires while `selectMoveTool` (cursor mode) is
 * active, since it targets an already-selectable entity, not a new one.
 */

import {
  lyricId,
  phraseEndId,
  phraseStartId,
  parseSchemaNoteId,
  typeToLane as schemaTypeToLane,
} from '@/lib/chart-edit';
import {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveEntitiesCommand,
  FIRST_PAD_LANE,
  LAST_PAD_LANE,
  KICK_LANE,
} from '../commands';
import {prospectiveNoteAt} from '../editing/prospectiveNote';
import {entityContextFromScope, trackKeyFromScope} from '../scope';
import {getSelectedIds} from '@/lib/chart-editor-core';
import {AFFORDANCES} from '../affordances';
import {selectNotesInRange} from '../editing/marquee';
import {computeNoteDragDelta, exceedsDragThreshold} from '../editing/gestures';
import type {EditorTool, PointerHitInfo, ToolContext} from './types';

/**
 * Click-to-select / click-and-drag-to-move on notes and side markers, plus
 * the double-click-to-rename affordance for `inlineEditable` kinds
 * (sections today). Only fires when a selectable entity is under the
 * cursor — `boxSelectTool` handles empty-highway clicks.
 */
export const selectMoveTool: EditorTool = {
  id: 'select-move',

  onPointerDown(ctx: ToolContext, evt: PointerHitInfo): void {
    const {hit, entity, coords} = evt;
    if (!entity) return;
    const aff = AFFORDANCES[entity.kind];

    if (aff.inlineEditable && ctx.capabilities.selectable.has(entity.kind)) {
      const now = Date.now();
      const last = ctx.drag.lastClick;
      if (last && last.tick === entity.tick && now - last.time < 400) {
        ctx.drag.setLastClick(null);
        if (entity.kind === 'section') {
          const currentName = hit?.type === 'section' ? hit.name : '';
          ctx.onOpenPopover({
            kind: 'section-rename',
            tick: entity.tick,
            x: coords.x,
            y: coords.y,
            initialSectionName: currentName,
            currentSectionName: currentName,
          });
          ctx.dispatch({
            type: 'SET_SELECTION',
            kind: 'section',
            ids: new Set([entity.id]),
          });
          return;
        }
      }
      ctx.drag.setLastClick({tick: entity.tick, time: now});
    }

    if (!aff.selectable || !ctx.capabilities.selectable.has(entity.kind)) {
      return;
    }

    if (entity.kind === 'note') {
      const noteSelection = getSelectedIds(ctx.state, 'note');
      if (evt.shiftKey) {
        const newIds = new Set(noteSelection);
        if (newIds.has(entity.id)) {
          newIds.delete(entity.id);
        } else {
          newIds.add(entity.id);
        }
        ctx.dispatch({type: 'SET_SELECTION', kind: 'note', ids: newIds});
      } else if (!noteSelection.has(entity.id)) {
        ctx.dispatch({
          type: 'SET_SELECTION',
          kind: 'note',
          ids: new Set([entity.id]),
        });
      }
    } else {
      ctx.dispatch({
        type: 'SET_SELECTION',
        kind: entity.kind,
        ids: new Set([entity.id]),
      });
      if (getSelectedIds(ctx.state, 'note').size > 0) {
        ctx.dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set()});
      }
    }

    if (ctx.capabilities.draggable.has(entity.kind)) {
      ctx.dispatch({
        type: 'SET_HOVER',
        hovered: {kind: entity.kind, id: entity.id},
      });
      if (entity.kind === 'note') {
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
      } else {
        ctx.beginMarkerDrag(entity.kind, entity.tick);
      }
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
        const {tickDelta, laneDelta} = computeNoteDragDelta({
          anchorTick: noteDrag.anchorTick,
          anchorLane: noteDrag.anchorLane,
          snappedCursorTick: snappedTick,
          cursorLane: ctx.screenToLane(coords.x, coords.y),
          selectionSize: getSelectedIds(ctx.state, 'note').size,
          prevLaneDelta: noteDrag.laneDelta,
          minPadLane: FIRST_PAD_LANE,
          maxPadLane: LAST_PAD_LANE,
          excludedLane: KICK_LANE,
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

    if (ctx.markerDrag && ctx.drag.dragStart) {
      ctx.updateMarkerDrag(ctx.screenToTick(coords.x, coords.y));
    }
  },

  onPointerUp(ctx: ToolContext, evt: PointerHitInfo): void {
    const noteSelection = getSelectedIds(ctx.state, 'note');
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

    if (ctx.markerDrag && ctx.drag.dragStart) {
      const dx = evt.coords.x - ctx.drag.dragStart.x;
      const dy = evt.coords.y - ctx.drag.dragStart.y;
      ctx.commitMarkerDrag(exceedsDragThreshold(dx, dy));
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
    );

    if (evt.shiftKey) {
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

/** Click/paint-drag to delete deletable entities under the cursor. Only
 *  notes have a wired delete command today; other deletable kinds
 *  (sections, lyrics, phrases) no-op until their handler lands. */
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

/** Opens the BPM popover, pre-filled with the tempo in effect at the
 *  clicked tick. */
export const tempoMarkerTool: EditorTool = {
  id: 'bpm',

  onPointerDown(ctx: ToolContext, evt: PointerHitInfo): void {
    let initialBpm = 120;
    if (ctx.timedTempos.length > 0) {
      let idx = 0;
      for (let i = 1; i < ctx.timedTempos.length; i++) {
        if (ctx.timedTempos[i].tick <= evt.tick) idx = i;
        else break;
      }
      initialBpm = ctx.timedTempos[idx].beatsPerMinute;
    }
    ctx.onOpenPopover({
      kind: 'bpm',
      tick: evt.tick,
      x: evt.coords.x,
      y: evt.coords.y,
      initialBpm,
    });
  },
};

/** Opens the time-signature popover at the clicked tick. */
export const timeSignatureMarkerTool: EditorTool = {
  id: 'timesig',

  onPointerDown(ctx: ToolContext, evt: PointerHitInfo): void {
    ctx.onOpenPopover({
      kind: 'timesig',
      tick: evt.tick,
      x: evt.coords.x,
      y: evt.coords.y,
    });
  },
};

/** Opens the "add section" popover at the clicked tick. Renaming an
 *  *existing* section is `selectMoveTool`'s double-click affordance, not
 *  this tool — see the module doc comment. */
export const sectionTool: EditorTool = {
  id: 'section',

  onPointerDown(ctx: ToolContext, evt: PointerHitInfo): void {
    ctx.onOpenPopover({
      kind: 'section',
      tick: evt.tick,
      x: evt.coords.x,
      y: evt.coords.y,
    });
  },
};

/**
 * Lyrics-timing selection for the add-lyrics flow (plan 0038 §Design lists
 * this alongside the highway switch tools). Not wired to a `ToolMode` yet —
 * `/add-lyrics` doesn't route through `useHighwayMouseInteraction` today —
 * so this scopes `selectMoveTool`'s selection behavior to lyric/phrase
 * entities only, ready to register once the add-lyrics timing UI adopts the
 * shared highway interaction hook.
 */
export const lyricsTimingTool: EditorTool = {
  id: 'lyrics-timing',

  onPointerDown(ctx: ToolContext, evt: PointerHitInfo): void {
    const {entity} = evt;
    if (!entity) return;
    if (
      entity.kind !== 'lyric' &&
      entity.kind !== 'phrase-start' &&
      entity.kind !== 'phrase-end'
    ) {
      return;
    }
    if (!ctx.capabilities.selectable.has(entity.kind)) return;
    ctx.dispatch({
      type: 'SET_SELECTION',
      kind: entity.kind,
      ids: new Set([entity.id]),
    });
    if (ctx.capabilities.draggable.has(entity.kind)) {
      ctx.dispatch({
        type: 'SET_HOVER',
        hovered: {kind: entity.kind, id: entity.id},
      });
      ctx.beginMarkerDrag(entity.kind, entity.tick);
      ctx.drag.setDragStart(evt.coords);
      ctx.drag.setDragCurrent(evt.coords);
    }
  },

  onPointerMove(ctx: ToolContext, evt: PointerHitInfo): void {
    if (ctx.markerDrag && ctx.drag.dragStart) {
      ctx.updateMarkerDrag(ctx.screenToTick(evt.coords.x, evt.coords.y));
    }
  },

  onPointerUp(ctx: ToolContext, evt: PointerHitInfo): void {
    if (ctx.markerDrag && ctx.drag.dragStart) {
      const dx = evt.coords.x - ctx.drag.dragStart.x;
      const dy = evt.coords.y - ctx.drag.dragStart.y;
      ctx.commitMarkerDrag(exceedsDragThreshold(dx, dy));
    }
  },
};

// Referenced for the id helpers used when building `EntityRef`s outside this
// module (registry.ts); re-exported so callers don't reach into chart-edit
// directly just for these three.
export {lyricId, phraseEndId, phraseStartId};
