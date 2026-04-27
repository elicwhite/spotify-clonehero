'use client';

/**
 * Push the active chart's elements (notes + markers) to the SceneReconciler.
 *
 * Encapsulates the part of the editor that knows:
 *   - How to derive `ChartElement[]` from `parsedChart + scope + part`
 *   - How to drop drum-note elements when capabilities hide drum lanes
 *   - How to apply transient hover/drag overlays to side markers
 *
 * Pure-effect hook: it only writes to the reconciler ref. Callers don't
 * read its return value — they pass the reconciler ref in.
 */

import {useEffect, type RefObject} from 'react';
import type {parseChartFile} from '@eliwhite/scan-chart';
import type {SceneReconciler} from '@/lib/preview/highway/SceneReconciler';

/**
 * Parser-shape ParsedChart. Differs from scan-chart's wrapper type in
 * that it lacks `chartBytes` / `format` / `iniChartModifiers` — those
 * come from the consumer's `ChartDocument`. The editor's reducer state
 * stores this narrower shape.
 */
type ParsedChart = ReturnType<typeof parseChartFile>;
import type {MarkerElementData} from '@/lib/preview/highway/MarkerRenderer';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import {tickToMs} from '@/lib/drum-transcription/timing';
import {findTrackInParsedChart} from '@/lib/chart-edit';
import {chartToElements} from '@/lib/preview/highway/chartToElements';
import type {EditorCapabilities} from '../capabilities';
import type {EditorScope} from '../scope';
import {trackKeyFromScope} from '../scope';

export interface MarkerDragHint {
  kind: string;
  originalTick: number;
  currentTick: number;
}

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
  hoveredMarkerKey: string | null;
  markerDrag: MarkerDragHint | null;
  timedTempos: TimedTempo[];
  resolution: number;
}

/**
 * Effect-only hook. Pushes a fresh element set to the reconciler on every
 * input change, with hover + drag overlays baked in.
 *
 * The hover/drag overlay is intentionally folded into the same push so we
 * don't need a separate "update one element" code path on the reconciler.
 * The reconciler diffs internally and only patches the changed elements.
 */
export function useChartElements(inputs: UseChartElementsInputs): void {
  const {
    reconcilerRef,
    rendererVersion,
    chart,
    activeScope,
    partName,
    capabilities,
    hoveredMarkerKey,
    markerDrag,
    timedTempos,
    resolution,
  } = inputs;

  useEffect(() => {
    const reconciler = reconcilerRef.current;
    if (!reconciler || !chart) return;
    const trackKey = trackKeyFromScope(activeScope);
    const track = trackKey
      ? (findTrackInParsedChart(chart, trackKey)?.track ?? null)
      : null;
    const elements = chartToElements(chart, track, partName);

    const dragKey = markerDrag
      ? `${markerDrag.kind}:${markerDrag.originalTick}`
      : null;
    const dragMs =
      markerDrag && timedTempos.length > 0
        ? tickToMs(markerDrag.currentTick, timedTempos, resolution)
        : null;

    const visible = elements
      .filter(e => capabilities.showDrumLanes || e.kind !== 'note')
      .map(e => {
        if (e.kind === 'note') return e;
        const isHover = hoveredMarkerKey === e.key;
        const isDrag = dragKey === e.key;
        if (!isHover && !isDrag) return e;
        return {
          ...e,
          msTime: isDrag && dragMs !== null ? dragMs : e.msTime,
          data: {
            ...(e.data as MarkerElementData),
            isHovered: isHover || isDrag,
          },
        };
      });

    reconciler.setElements(visible);
  }, [
    reconcilerRef,
    rendererVersion,
    chart,
    activeScope,
    partName,
    capabilities,
    hoveredMarkerKey,
    markerDrag,
    timedTempos,
    resolution,
  ]);
}
