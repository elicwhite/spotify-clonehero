'use client';

/**
 * Single-entity marker drag state on the highway.
 *
 * Sections are the only marker kind the highway draws
 * (`HIGHWAY_ELEMENT_KINDS` in `lib/preview/highway/cell.ts`), so they are the
 * only kind this hook moves. Lyric and phrase markers are dragged in the
 * piano roll's lyrics row, which owns its own drag path.
 *
 * Note drag is multi-entity and goes through `state.selection` + the regular
 * mouse handlers. Marker drag is one-at-a-time and lives entirely inside this
 * hook: state, clamp logic, and commit handler.
 *
 * The hook is *callable* from a pointer-move handler: feed it the raw tick
 * under the cursor and it will clamp to the bounds the underlying entity
 * handler enforces on commit. The renderer ghost reads the clamped tick so it
 * never wanders past where the move could land.
 */

import {useCallback, useState} from 'react';
import {MoveEntitiesCommand, type EditCommand} from '../commands';
import {entityContextFromScope, type EditorScope} from '../scope';

export type MarkerKind = 'section';

export interface MarkerDragState {
  kind: MarkerKind;
  originalTick: number;
  /** Latest tick during drag, already clamped to handler bounds. */
  currentTick: number;
}

export interface UseMarkerDragInputs {
  activeScope: EditorScope;
  executeCommand: (cmd: EditCommand) => void;
  dispatch: (action: {
    type: 'SET_SELECTION';
    kind: MarkerKind;
    ids: Set<string>;
  }) => void;
}

export interface UseMarkerDragOutputs {
  markerDrag: MarkerDragState | null;
  /** Start a new drag for the given kind + tick. */
  beginMarkerDrag: (kind: MarkerKind, originalTick: number) => void;
  /**
   * Update the drag's currentTick to the given raw tick, clamping to whatever
   * bounds the underlying handler enforces on commit.
   */
  updateMarkerDrag: (rawTick: number) => void;
  /**
   * Commit the drag if it has actually moved (per the caller's threshold) and
   * the destination differs from the origin. Issues a MoveEntitiesCommand and
   * pins selection on the moved entity. No-op when there's no active drag.
   */
  commitMarkerDrag: (moveExceededThreshold: boolean) => void;
  /** Drop the drag without issuing a command. */
  cancelMarkerDrag: () => void;
}

/**
 * Entity-ref id for a section marker by tick. Mirrors the id format
 * `markerHitToRef` produces in `useHighwayMouseInteraction`.
 */
function markerEntityId(tick: number): string {
  return String(tick);
}

export function useMarkerDrag(
  inputs: UseMarkerDragInputs,
): UseMarkerDragOutputs {
  const {activeScope, executeCommand, dispatch} = inputs;
  const [markerDrag, setMarkerDrag] = useState<MarkerDragState | null>(null);

  const beginMarkerDrag = useCallback(
    (kind: MarkerKind, originalTick: number) => {
      setMarkerDrag({kind, originalTick, currentTick: originalTick});
    },
    [],
  );

  const updateMarkerDrag = useCallback((rawTick: number) => {
    setMarkerDrag(prev => {
      if (!prev) return prev;
      // Mirrors the clamp the chart-edit section handler applies on move: a
      // section can sit at any non-negative tick.
      const newTick = Math.max(0, rawTick);
      if (newTick === prev.currentTick) return prev;
      return {...prev, currentTick: newTick};
    });
  }, []);

  const commitMarkerDrag = useCallback(
    (moveExceededThreshold: boolean) => {
      // Side effects must happen *outside* the setState updater so React
      // doesn't see a dispatch into another component during the render
      // phase (strict-mode replays the updater and would re-fire the
      // command otherwise). Read markerDrag from the closure, run the
      // command + selection dispatch synchronously, then clear the drag.
      if (!markerDrag) return;
      const moved =
        moveExceededThreshold &&
        markerDrag.currentTick !== markerDrag.originalTick;
      if (moved) {
        const tickDelta = markerDrag.currentTick - markerDrag.originalTick;
        const originalId = markerEntityId(markerDrag.originalTick);
        const currentId = markerEntityId(markerDrag.currentTick);
        executeCommand(
          new MoveEntitiesCommand(
            markerDrag.kind,
            [originalId],
            tickDelta,
            0,
            entityContextFromScope(activeScope),
          ),
        );
        // Keep selection on the moved entity using its new id. Handlers
        // clamp on overshoot, so the actual id may differ; we re-derive
        // it here on a best-effort basis.
        dispatch({
          type: 'SET_SELECTION',
          kind: markerDrag.kind,
          ids: new Set([currentId]),
        });
      }
      setMarkerDrag(null);
    },
    [markerDrag, activeScope, executeCommand, dispatch],
  );

  const cancelMarkerDrag = useCallback(() => {
    setMarkerDrag(null);
  }, []);

  return {
    markerDrag,
    beginMarkerDrag,
    updateMarkerDrag,
    commitMarkerDrag,
    cancelMarkerDrag,
  };
}
