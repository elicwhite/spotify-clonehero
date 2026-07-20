'use client';

/**
 * Push the active chart's elements (notes + markers) to the SceneReconciler.
 *
 * Three responsibilities, three effects:
 *
 *   1. **Element set push** — derive `ChartElement[]` from the chart and
 *      capabilities. Element data is intrinsic-only (text, lane, length,
 *      msTime); transient state lives elsewhere. Marker drag injects a
 *      live `msTime` so the dragged marker tracks the cursor; the
 *      reconciler treats this as reposition-only because `dataEqual`
 *      ignores msTime.
 *
 *   2. **Hover push** — translate `state.hovered` (`{kind, id} | null`) to
 *      a reconciler key via `reconcilerKeyFor` and call
 *      `reconciler.setHoveredKey`. One push site so mouse and drag don't
 *      race each other through the renderer.
 *
 *   3. **Selection push** — translate per-kind selection sets to a single
 *      `Set<reconciler-key>` and call `reconciler.setSelectedKeys`. Notes
 *      ride the same dispatch path as marker entities.
 */

import {useEffect, type RefObject} from 'react';
import type {parseChartFile} from '@eliwhite/scan-chart';
import type {
  ChartElement,
  SceneReconciler,
} from '@/lib/preview/highway/SceneReconciler';

/**
 * Parser-shape ParsedChart. Differs from scan-chart's wrapper type in
 * that it lacks `chartBytes` / `format` / `iniChartModifiers` — those
 * come from the consumer's `ChartDocument`. The editor's reducer state
 * stores this narrower shape.
 */
type ParsedChart = ReturnType<typeof parseChartFile>;
import type {EntityKind} from '@/lib/chart-edit';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import {tickToMs} from '@/lib/drum-transcription/timing';
import {noteTypes} from '@eliwhite/scan-chart';
import type {ChartDocument} from '@/lib/chart-edit';
import {buildProjectionFor} from '@/lib/preview/highway/projection';
import type {NoteElementData} from '@/lib/preview/highway/NoteRenderer';
import {calculateNoteXOffset} from '@/lib/preview/highway/types';
import {
  markerDragReconcilerKey,
  reconcilerKeyFor,
} from '@/lib/preview/highway/reconcilerKey';
import type {EditorCapabilities} from '../capabilities';
import type {EditorScope} from '../scope';
import type {MarkerKind} from './useMarkerDrag';

export interface MarkerDragHint {
  kind: MarkerKind;
  originalTick: number;
  currentTick: number;
}

/**
 * Live multi-note drag preview. `ids` are the selected notes' entity ids
 * (`tick:type`); their elements are repositioned by `tickDelta` (and shifted
 * across pad lanes by `laneDelta`) so the notes visibly follow the cursor,
 * snapping with it, before the move commits on release.
 */
export interface NoteDragHint {
  tickDelta: number;
  laneDelta: number;
  ids: ReadonlySet<string>;
}

/** Highway pad lane index (0-3) → scan-chart note type, for lane preview. */
const HIGHWAY_LANE_TO_NOTE_TYPE = [
  noteTypes.redDrum,
  noteTypes.yellowDrum,
  noteTypes.blueDrum,
  noteTypes.greenDrum,
];

export interface UseChartElementsInputs {
  reconcilerRef: RefObject<SceneReconciler | null>;
  /**
   * Bumped when the renderer handle is swapped out (re-mount). Drives
   * the "first reconciler push after mount" path.
   */
  rendererVersion: number;
  chart: ParsedChart | null;
  activeScope: EditorScope;
  /** Active vocal part. `vocals` for non-vocals scopes. */
  partName: string;
  capabilities: EditorCapabilities;
  /** Per-entity-kind selection from the editor reducer. */
  selection: ReadonlyMap<EntityKind, ReadonlySet<string>>;
  /** Single hovered entity from the editor reducer (or null). */
  hovered: {kind: EntityKind; id: string} | null;
  markerDrag: MarkerDragHint | null;
  noteDrag: NoteDragHint | null;
  timedTempos: TimedTempo[];
  resolution: number;
}

/**
 * Pure inputs for `computeChartElements`. The element-set computation is
 * factored out as a side-effect-free function so it can be unit-tested
 * directly without renderHook + a mocked reconciler.
 */
export interface ComputeChartElementsInputs {
  chart: ParsedChart;
  activeScope: EditorScope;
  partName: string;
  capabilities: EditorCapabilities;
  markerDrag: MarkerDragHint | null;
  noteDrag: NoteDragHint | null;
  timedTempos: TimedTempo[];
  resolution: number;
}

/**
 * Pure: derive the `ChartElement[]` to push to the reconciler from the
 * current chart + capabilities + marker-drag hint. No React, no refs.
 *
 * Notes + markers come from `buildProjectionFor(activeScope, doc, null)`
 * (`lib/preview/highway/projection.ts`) — the same `EditorProjection`
 * builder the piano-roll uses. `schema` is passed `null` because neither
 * `trackToElements` nor `buildMarkerElements` reads lane geometry today;
 * this call site only needs `projection.elements` + `projection.markers`.
 *
 * Drag handling: when a marker is being dragged, its element is rewritten
 * with a live `msTime` derived from `markerDrag.currentTick`. The
 * reconciler's `dataEqual` ignores `msTime`, so this becomes a
 * reposition-only update — no recycle, no key churn.
 *
 * Note drags work the same way for the tick axis: each selected note's
 * element gets an `msTime` recomputed from its tick plus the drag's
 * `tickDelta`. A non-zero `laneDelta` additionally rewrites the element's
 * lane / xPosition / note type (a data change, so the reconciler recycles
 * the sprite into the previewed lane's visual).
 */
export function computeChartElements(
  inputs: ComputeChartElementsInputs,
): ChartElement[] {
  const {
    chart,
    activeScope,
    partName,
    capabilities,
    markerDrag,
    noteDrag,
    timedTempos,
    resolution,
  } = inputs;
  // `computeChartElements` still takes the narrower `ParsedChart` shape
  // (see the type comment above); `buildProjectionFor` only reads
  // `doc.parsedChart`, so a minimal wrapper is enough to reuse it here.
  const doc = {parsedChart: chart} as unknown as ChartDocument;
  const projection = buildProjectionFor(activeScope, doc, null);
  const elements = [...projection.elements, ...projection.markers];

  const dragKey = markerDrag
    ? markerDragReconcilerKey(
        markerDrag.kind,
        markerDrag.originalTick,
        partName,
      )
    : null;
  const dragMs =
    markerDrag && timedTempos.length > 0
      ? tickToMs(markerDrag.currentTick, timedTempos, resolution)
      : null;

  const noteDragKeys =
    noteDrag && timedTempos.length > 0
      ? new Set(Array.from(noteDrag.ids, id => reconcilerKeyFor('note', id)))
      : null;

  return elements
    .filter(e => capabilities.showDrumLanes || e.kind !== 'note')
    .map(e => {
      if (dragKey === e.key && dragMs !== null) {
        return {...e, msTime: dragMs};
      }
      if (noteDragKeys && e.kind === 'note' && noteDragKeys.has(e.key)) {
        const data = e.data as NoteElementData;
        const tick = data.note.tick ?? 0;
        const msTime = tickToMs(
          Math.max(0, tick + noteDrag!.tickDelta),
          timedTempos,
          resolution,
        );
        // Kick stays on its own axis; pads shift lanes with the preview.
        if (noteDrag!.laneDelta === 0 || data.isKick || data.lane < 0) {
          return {...e, msTime};
        }
        const newLane = Math.max(
          0,
          Math.min(
            HIGHWAY_LANE_TO_NOTE_TYPE.length - 1,
            data.lane + noteDrag!.laneDelta,
          ),
        );
        return {
          ...e,
          msTime,
          data: {
            ...data,
            lane: newLane,
            xPosition: calculateNoteXOffset('drums', newLane),
            note: {...data.note, type: HIGHWAY_LANE_TO_NOTE_TYPE[newLane]},
          } satisfies NoteElementData,
        };
      }
      return e;
    });
}

/**
 * Effect-only hook. Pushes a fresh element set to the reconciler on every
 * input change; pushes hover/selection through dedicated dispatch
 * channels (no longer baked into element data).
 */
export function useChartElements(inputs: UseChartElementsInputs): void {
  const {
    reconcilerRef,
    rendererVersion,
    chart,
    activeScope,
    partName,
    capabilities,
    selection,
    hovered,
    markerDrag,
    noteDrag,
    timedTempos,
    resolution,
  } = inputs;

  // ---------------------------------------------------------------------
  // 1. Element-set push.
  //    Intrinsic-only data; drag injects msTime which the reconciler
  //    treats as reposition-only.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const reconciler = reconcilerRef.current;
    if (!reconciler || !chart) return;
    reconciler.setElements(
      computeChartElements({
        chart,
        activeScope,
        partName,
        capabilities,
        markerDrag,
        noteDrag,
        timedTempos,
        resolution,
      }),
    );
  }, [
    reconcilerRef,
    rendererVersion,
    chart,
    activeScope,
    partName,
    capabilities,
    markerDrag,
    noteDrag,
    timedTempos,
    resolution,
  ]);

  // ---------------------------------------------------------------------
  // 2. Hover push. Single source of truth: state.hovered → reconciler.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const reconciler = reconcilerRef.current;
    if (!reconciler) return;
    const key = hovered
      ? reconcilerKeyFor(hovered.kind, hovered.id, partName)
      : null;
    reconciler.setHoveredKey(key);
  }, [reconcilerRef, rendererVersion, hovered, partName]);

  // ---------------------------------------------------------------------
  // 3. Selection push. Translate per-kind selection ids to reconciler
  //    keys and replace the reconciler's set.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const reconciler = reconcilerRef.current;
    if (!reconciler) return;
    const keys = new Set<string>();
    for (const [kind, ids] of selection) {
      for (const id of ids) {
        keys.add(reconcilerKeyFor(kind, id, partName));
      }
    }
    reconciler.setSelectedKeys(keys);
  }, [reconcilerRef, rendererVersion, selection, partName]);
}
