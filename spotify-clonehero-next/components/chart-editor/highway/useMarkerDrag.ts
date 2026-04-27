'use client';

/**
 * Single-entity marker drag state (sections, lyrics, phrase-start, phrase-end).
 *
 * Note drag is multi-entity and goes through `state.selection` + the regular
 * mouse handlers. Marker drag is one-at-a-time and lives entirely inside this
 * hook: state, clamp logic, and commit handler.
 *
 * The hook is *callable* from a pointer-move handler: feed it the raw tick
 * under the cursor and it will clamp to the bounds the underlying entity
 * handler enforces on commit (lyrics stay in their phrase, phrase-start can't
 * cross the previous phrase's end, etc.). The renderer ghost reads the
 * clamped tick so it never wanders past where the move could land.
 */

import {useCallback, useState} from 'react';
import type {parseChartFile} from '@eliwhite/scan-chart';
import {lyricId, phraseEndId, phraseStartId} from '@/lib/chart-edit';
import {MoveEntitiesCommand, type EditCommand} from '../commands';
import {entityContextFromScope, type EditorScope} from '../scope';

type ParsedChart = ReturnType<typeof parseChartFile>;

export type MarkerKind = 'section' | 'lyric' | 'phrase-start' | 'phrase-end';

export interface MarkerDragState {
  kind: MarkerKind;
  originalTick: number;
  /** Latest tick during drag, already clamped to handler bounds. */
  currentTick: number;
}

export interface UseMarkerDragInputs {
  chart: ParsedChart | null;
  activeScope: EditorScope;
  activePartName: string;
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
 * Build the entity-ref id for a side-marker by kind + tick + active part.
 * Mirrors the id format `markerHitToRef` produces in HighwayEditor.
 */
function markerEntityId(
  kind: MarkerKind,
  tick: number,
  partName: string,
): string {
  switch (kind) {
    case 'section':
      return String(tick);
    case 'lyric':
      return lyricId(tick, partName);
    case 'phrase-start':
      return phraseStartId(tick, partName);
    case 'phrase-end':
      return phraseEndId(tick, partName);
  }
}

/**
 * Tick range that a marker drag is allowed to settle into, mirroring the
 * clamping each chart-edit handler applies on move. Sections drag freely;
 * only lyrics + phrase markers are bounded.
 */
function computeMarkerDragBounds(
  chart: ParsedChart,
  kind: MarkerKind,
  originalTick: number,
  partName: string,
): {min: number; max: number} {
  if (kind === 'section') return {min: 0, max: Number.POSITIVE_INFINITY};

  const phrases = chart.vocalTracks?.parts?.[partName]?.notePhrases ?? [];

  if (kind === 'lyric') {
    // Lyric stays inside the phrase that owns it.
    const phrase = phrases.find(p =>
      p.lyrics.some(l => l.tick === originalTick),
    );
    if (!phrase) return {min: 0, max: Number.POSITIVE_INFINITY};
    return {min: phrase.tick, max: phrase.tick + phrase.length};
  }

  if (kind === 'phrase-start') {
    const idx = phrases.findIndex(p => p.tick === originalTick);
    if (idx === -1) return {min: 0, max: Number.POSITIVE_INFINITY};
    const phrase = phrases[idx];
    const prev = phrases[idx - 1];
    return {
      min: prev ? prev.tick + prev.length : 0,
      // Keep at least 1 tick of phrase length; matches MIN_PHRASE_LENGTH.
      max: phrase.tick + phrase.length - 1,
    };
  }

  // phrase-end
  const idx = phrases.findIndex(p => p.tick + p.length === originalTick);
  if (idx === -1) return {min: 0, max: Number.POSITIVE_INFINITY};
  const phrase = phrases[idx];
  const next = phrases[idx + 1];
  return {
    min: phrase.tick + 1,
    max: next ? next.tick : Number.POSITIVE_INFINITY,
  };
}

export function useMarkerDrag(
  inputs: UseMarkerDragInputs,
): UseMarkerDragOutputs {
  const {chart, activeScope, activePartName, executeCommand, dispatch} = inputs;
  const [markerDrag, setMarkerDrag] = useState<MarkerDragState | null>(null);

  const beginMarkerDrag = useCallback(
    (kind: MarkerKind, originalTick: number) => {
      setMarkerDrag({kind, originalTick, currentTick: originalTick});
    },
    [],
  );

  const updateMarkerDrag = useCallback(
    (rawTick: number) => {
      setMarkerDrag(prev => {
        if (!prev || !chart) return prev;
        const bounds = computeMarkerDragBounds(
          chart,
          prev.kind,
          prev.originalTick,
          activePartName,
        );
        const newTick = Math.max(bounds.min, Math.min(bounds.max, rawTick));
        if (newTick === prev.currentTick) return prev;
        return {...prev, currentTick: newTick};
      });
    },
    [chart, activePartName],
  );

  const commitMarkerDrag = useCallback(
    (moveExceededThreshold: boolean) => {
      // Read state functionally so we don't re-create this callback on every
      // markerDrag change, but still observe the latest value.
      setMarkerDrag(prev => {
        if (!prev) return null;
        const moved =
          moveExceededThreshold && prev.currentTick !== prev.originalTick;
        if (moved) {
          const tickDelta = prev.currentTick - prev.originalTick;
          const originalId = markerEntityId(
            prev.kind,
            prev.originalTick,
            activePartName,
          );
          const currentId = markerEntityId(
            prev.kind,
            prev.currentTick,
            activePartName,
          );
          executeCommand(
            new MoveEntitiesCommand(
              prev.kind,
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
            kind: prev.kind,
            ids: new Set([currentId]),
          });
        }
        return null;
      });
    },
    [activeScope, activePartName, executeCommand, dispatch],
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
