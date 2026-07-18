/**
 * Tests for `computeChartElements` — the pure element-set computation
 * that `useChartElements` hands to the SceneReconciler.
 *
 * These pin two invariants the rest of the editor relies on:
 *
 *  1. Element data is intrinsic-only. No `isHovered`/`isSelected`/`isDrag`
 *     fields leak in. Hover and selection ride dedicated reconciler hooks
 *     (`setHoveredKey` / `setSelectedKeys`); selection state in element
 *     data would force a recycle on every toggle.
 *
 *  2. Marker drag is a reposition-only update. Two computations that
 *     differ only in `markerDrag.currentTick` produce the same set of
 *     reconciler keys. The reconciler's `dataEqual` ignores `msTime`, so
 *     the dragged marker stays in the same Three.js group and just
 *     repositions.
 */

import {makeFixtureDoc} from '../../__tests__/fixtures';
import {DRUM_EDIT_CAPABILITIES, PREVIEW_CAPABILITIES} from '../../capabilities';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../../scope';
import {computeChartElements} from '../useChartElements';
import {markerDragReconcilerKey} from '@/lib/preview/highway/reconcilerKey';

describe('computeChartElements', () => {
  // Resolution=480, 120 BPM in the fixture: 480 ticks = 500ms. Matches
  // the timing layout `makeFixtureDoc` builds.
  const timedTempos = [{tick: 0, msTime: 0, beatsPerMinute: 120}];
  const resolution = 480;

  it('produces no isHovered / isSelected / isDrag fields on element data', () => {
    const doc = makeFixtureDoc();
    const elements = computeChartElements({
      chart: doc.parsedChart,
      activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
      partName: 'vocals',
      capabilities: DRUM_EDIT_CAPABILITIES,
      markerDrag: null,
      timedTempos,
      resolution,
    });

    expect(elements.length).toBeGreaterThan(0);
    for (const el of elements) {
      const data = el.data as Record<string, unknown>;
      expect(data).not.toHaveProperty('isHovered');
      expect(data).not.toHaveProperty('isSelected');
      expect(data).not.toHaveProperty('isDrag');
    }
  });

  it('drag-only msTime change does not change reconciler keys', () => {
    const doc = makeFixtureDoc();

    const baseInputs = {
      chart: doc.parsedChart,
      activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
      partName: 'vocals',
      capabilities: DRUM_EDIT_CAPABILITIES,
      timedTempos,
      resolution,
    };

    // First push: section drag at the original tick.
    const elementsAtT0 = computeChartElements({
      ...baseInputs,
      markerDrag: {
        kind: 'section',
        originalTick: 1920,
        currentTick: 1920,
      },
    });

    // Second push: same drag, cursor moved 240 ticks downstream.
    const elementsAtT1 = computeChartElements({
      ...baseInputs,
      markerDrag: {
        kind: 'section',
        originalTick: 1920,
        currentTick: 2160,
      },
    });

    const keysAt0 = elementsAtT0.map(e => e.key);
    const keysAt1 = elementsAtT1.map(e => e.key);
    expect(keysAt1).toEqual(keysAt0);
  });

  it('drag rewrites msTime on the dragged marker only', () => {
    const doc = makeFixtureDoc();
    const draggedKey = markerDragReconcilerKey('section', 1920, 'vocals');

    const baseInputs = {
      chart: doc.parsedChart,
      activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
      partName: 'vocals',
      capabilities: DRUM_EDIT_CAPABILITIES,
      timedTempos,
      resolution,
    };

    const before = computeChartElements({...baseInputs, markerDrag: null});
    const during = computeChartElements({
      ...baseInputs,
      markerDrag: {
        kind: 'section',
        originalTick: 1920,
        currentTick: 2400, // 480 ticks downstream → +500ms
      },
    });

    // Every non-dragged element keeps its msTime exactly. The dragged
    // marker's msTime advances to the new cursor tick.
    for (const el of before) {
      const after = during.find(d => d.key === el.key);
      expect(after).toBeDefined();
      if (el.key === draggedKey) {
        expect(after!.msTime).not.toBe(el.msTime);
      } else {
        expect(after!.msTime).toBe(el.msTime);
      }
    }
  });

  it('showDrumLanes=false filters out notes', () => {
    const doc = makeFixtureDoc();

    const noLanesCaps = {
      ...DRUM_EDIT_CAPABILITIES,
      showDrumLanes: false,
    };

    const elements = computeChartElements({
      chart: doc.parsedChart,
      activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
      partName: 'vocals',
      capabilities: noLanesCaps,
      markerDrag: null,
      timedTempos,
      resolution,
    });

    expect(elements.some(e => e.kind === 'note')).toBe(false);
    // Markers still render.
    expect(elements.some(e => e.kind === 'section')).toBe(true);
    expect(elements.some(e => e.kind === 'lyric')).toBe(true);
  });

  it('vocals scope produces no notes track elements (track is null)', () => {
    const doc = makeFixtureDoc();
    const elements = computeChartElements({
      chart: doc.parsedChart,
      activeScope: {kind: 'vocals', part: 'vocals'},
      partName: 'vocals',
      capabilities: DRUM_EDIT_CAPABILITIES,
      markerDrag: null,
      timedTempos,
      resolution,
    });

    expect(elements.some(e => e.kind === 'note')).toBe(false);
    expect(elements.some(e => e.kind === 'lyric')).toBe(true);
  });

  it('drums scope on a chart with no drums track yields markers only', () => {
    // /preview loads arbitrary charts under the drums/expert scope; a
    // chart with no drums track must still produce the non-note
    // elements (sections, lyrics) without throwing.
    const doc = makeFixtureDoc();
    doc.parsedChart.trackData = doc.parsedChart.trackData.filter(
      t => t.instrument !== 'drums',
    );

    const elements = computeChartElements({
      chart: doc.parsedChart,
      activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
      partName: 'vocals',
      capabilities: PREVIEW_CAPABILITIES,
      markerDrag: null,
      timedTempos,
      resolution,
    });

    expect(elements.some(e => e.kind === 'note')).toBe(false);
    expect(elements.some(e => e.kind === 'section')).toBe(true);
  });

  it('omits dragged-msTime rewrite when timedTempos is empty', () => {
    const doc = makeFixtureDoc();
    const draggedKey = markerDragReconcilerKey('section', 1920, 'vocals');

    // Baseline: no drag, no rewrite. Captures whatever msTime the chart
    // happens to carry for this section in the fixture (parser-dependent).
    const baseline = computeChartElements({
      chart: doc.parsedChart,
      activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
      partName: 'vocals',
      capabilities: DRUM_EDIT_CAPABILITIES,
      markerDrag: null,
      timedTempos,
      resolution,
    });
    const baselineMs = baseline.find(e => e.key === draggedKey)!.msTime;

    // Drag with empty tempos: msTime should match baseline (no rewrite),
    // not advance to the cursor and not produce NaN.
    const dragged = computeChartElements({
      chart: doc.parsedChart,
      activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
      partName: 'vocals',
      capabilities: DRUM_EDIT_CAPABILITIES,
      markerDrag: {
        kind: 'section',
        originalTick: 1920,
        currentTick: 2400,
      },
      timedTempos: [],
      resolution,
    }).find(e => e.key === draggedKey);

    expect(dragged).toBeDefined();
    expect(dragged!.msTime).toBe(baselineMs);
    expect(Number.isFinite(dragged!.msTime)).toBe(true);
  });
});
