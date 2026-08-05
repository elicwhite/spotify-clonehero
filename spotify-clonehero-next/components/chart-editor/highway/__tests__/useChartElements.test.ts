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
 *  2. A note drag is a reposition-only update. Two computations that
 *     differ only in `noteDrag.tickDelta` produce the same set of
 *     reconciler keys. The reconciler's `dataEqual` ignores `msTime`, so
 *     the dragged notes stay in the same Three.js groups and just
 *     reposition.
 */

import {makeFixtureDoc} from '../../__tests__/fixtures';
import {DRUM_EDIT_CAPABILITIES, PREVIEW_CAPABILITIES} from '../../capabilities';
import {
  DEFAULT_DRUMS_EXPERT_SCOPE,
  DEFAULT_GUITAR_EXPERT_SCOPE,
} from '../../scope';
import {computeChartElements} from '../useChartElements';
import {AddNoteCommand, toSchemaNote} from '../../commands';
import type {NoteElementData} from '@/lib/preview/highway/NoteRenderer';
import type {TrackKey} from '@/lib/chart-edit';
import {drumTypes, noteTypes} from '@eliwhite/scan-chart';
import {drums4LaneSchema, drums5LaneSchema} from '@/lib/chart-edit/instruments';

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
      capabilities: DRUM_EDIT_CAPABILITIES,
      noteDrag: null,
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

  // Regression: the highway renders from `computeChartElements`, which
  // positions/windows notes by `msTime`. A note added via AddNoteCommand must
  // therefore surface with a tempo-map msTime — not 0 — or it renders at song
  // start (off-window) and is invisible on the highway while the tick-based
  // piano roll shows it correctly.
  it('surfaces a freshly added note with a tempo-map msTime', () => {
    const DRUMS_KEY: TrackKey = {instrument: 'drums', difficulty: 'expert'};
    const doc = new AddNoteCommand(
      toSchemaNote({tick: 720, type: noteTypes.redDrum, length: 0, flags: 0}),
      DRUMS_KEY,
    ).execute(makeFixtureDoc());

    const elements = computeChartElements({
      chart: doc.parsedChart,
      activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
      capabilities: DRUM_EDIT_CAPABILITIES,
      noteDrag: null,
      timedTempos,
      resolution,
    });

    // 720 ticks at 120 BPM / res 480 = 750ms.
    const added = elements.find(e => e.key === 'note:720:redDrum');
    expect(added).toBeDefined();
    expect(added!.msTime).toBeCloseTo(750, 5);
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
      capabilities: noLanesCaps,
      noteDrag: null,
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
      capabilities: DRUM_EDIT_CAPABILITIES,
      noteDrag: null,
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
      capabilities: PREVIEW_CAPABILITIES,
      noteDrag: null,
      timedTempos,
      resolution,
    });

    expect(elements.some(e => e.kind === 'note')).toBe(false);
    expect(elements.some(e => e.kind === 'section')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Producer scope
  // -------------------------------------------------------------------------

  // The producer emits the whole projection, marker kinds included. Narrowing
  // to what a surface draws happens at the consumer: the highway's reconciler
  // accepts `HIGHWAY_ELEMENT_KINDS` only (pinned by
  // `lib/preview/highway/__tests__/highway-element-kinds.test.ts`), while the
  // piano roll consumes the same projection and needs every kind.
  describe('produced element kinds', () => {
    const inputs = () => ({
      chart: makeFixtureDoc().parsedChart,
      activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
      capabilities: DRUM_EDIT_CAPABILITIES,
      noteDrag: null,
      timedTempos,
      resolution,
    });

    it('produces every marker kind the chart projection carries', () => {
      const kinds = new Set(computeChartElements(inputs()).map(e => e.kind));
      expect(kinds.has('note')).toBe(true);
      expect(kinds.has('section')).toBe(true);
      expect(kinds.has('bpm')).toBe(true);
      expect(kinds.has('ts')).toBe(true);
      expect(kinds.has('lyric')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Note drag preview
  // -------------------------------------------------------------------------

  describe('note drag preview', () => {
    const baseInputs = () => ({
      chart: makeFixtureDoc().parsedChart,
      activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
      capabilities: DRUM_EDIT_CAPABILITIES,
      timedTempos,
      resolution,
    });

    it('repositions dragged notes by tickDelta without changing keys', () => {
      const inputs = baseInputs();
      const before = computeChartElements({...inputs, noteDrag: null});
      const during = computeChartElements({
        ...inputs,
        // 480 ticks at 120 BPM / res 480 = +500ms
        noteDrag: {
          tickDelta: 480,
          laneDelta: 0,
          ids: new Set(['drums:expert|480:redDrum']),
        },
      });

      expect(during.map(e => e.key)).toEqual(before.map(e => e.key));
      // Preview time comes from the tempo map: tick 480+480=960 at 120 BPM
      // → 1000ms (absolute, independent of the msTime stored on the note).
      const dragged = during.find(e => e.key === 'note:480:redDrum')!;
      expect(dragged.msTime).toBeCloseTo(1000, 5);

      // Non-dragged notes keep their msTime.
      const other = during.find(e => e.key === 'note:960:yellowDrum')!;
      const otherBefore = before.find(e => e.key === 'note:960:yellowDrum')!;
      expect(other.msTime).toBe(otherBefore.msTime);
    });

    it('shifts a dragged pad across lanes with laneDelta', () => {
      const inputs = baseInputs();
      const before = computeChartElements({...inputs, noteDrag: null});
      const during = computeChartElements({
        ...inputs,
        noteDrag: {
          tickDelta: 0,
          laneDelta: 1,
          ids: new Set(['drums:expert|480:redDrum']),
        },
      });

      const dragged = during.find(e => e.key === 'note:480:redDrum')!;
      const original = before.find(e => e.key === 'note:480:redDrum')!;
      const draggedData = dragged.data as {lane: number; xPosition: number};
      const originalData = original.data as {lane: number; xPosition: number};
      expect(draggedData.lane).toBe(originalData.lane + 1);
      expect(draggedData.xPosition).not.toBe(originalData.xPosition);
    });

    it('shifts five-fret pads by schema lane while preserving pad geometry', () => {
      const doc = makeFixtureDoc();
      const guitar = {
        ...doc.parsedChart.trackData[0],
        instrument: 'guitar' as const,
        noteEventGroups: [
          [
            {
              type: noteTypes.red,
              tick: 480,
              msTime: 500,
              length: 0,
              msLength: 0,
              flags: 0,
            },
          ],
        ],
      };
      const chart = {
        ...doc.parsedChart,
        trackData: [guitar],
      };
      const inputs = {
        chart,
        activeScope: DEFAULT_GUITAR_EXPERT_SCOPE,
        capabilities: DRUM_EDIT_CAPABILITIES,
        timedTempos,
        resolution,
      };

      const before = computeChartElements({...inputs, noteDrag: null});
      const during = computeChartElements({
        ...inputs,
        noteDrag: {
          tickDelta: 0,
          laneDelta: 1,
          ids: new Set(['guitar:expert|480:red']),
        },
      });
      const data = during.find(e => e.key === 'note:480:red')!
        .data as NoteElementData;

      expect(data.note.type).toBe(noteTypes.yellow);
      expect(data.lane).toBe(2);
      expect(data.editorLane).toBe(3);
      expect(data.xPosition).not.toBe(
        (before.find(e => e.key === 'note:480:red')!.data as NoteElementData)
          .xPosition,
      );
    });

    it('keeps an open note on the full-width axis during a lane drag', () => {
      const doc = makeFixtureDoc();
      const guitar = {
        ...doc.parsedChart.trackData[0],
        instrument: 'guitar' as const,
        noteEventGroups: [
          [
            {
              type: noteTypes.open,
              tick: 480,
              msTime: 500,
              length: 240,
              msLength: 240,
              flags: 0,
            },
          ],
        ],
      };
      const chart = {...doc.parsedChart, trackData: [guitar]};
      const elements = computeChartElements({
        chart,
        activeScope: DEFAULT_GUITAR_EXPERT_SCOPE,
        capabilities: DRUM_EDIT_CAPABILITIES,
        noteDrag: {
          tickDelta: 0,
          laneDelta: 2,
          ids: new Set(['guitar:expert|480:open']),
        },
        timedTempos,
        resolution,
      });
      const data = elements.find(e => e.key === 'note:480:open')!
        .data as NoteElementData;

      expect(data.isOpen).toBe(true);
      expect(data.note.type).toBe(noteTypes.open);
      expect(data.lane).toBe(-1);
      expect(data.editorLane).toBe(0);
      expect(data.msLength).toBe(240);
    });

    it('does not lane-shift a dragged kick', () => {
      const inputs = baseInputs();
      const during = computeChartElements({
        ...inputs,
        noteDrag: {
          tickDelta: 480,
          laneDelta: 2,
          ids: new Set(['drums:expert|0:kick']),
        },
      });

      const dragged = during.find(e => e.key === 'note:0:kick')!;
      const data = dragged.data as {isKick: boolean; lane: number};
      expect(data.isKick).toBe(true);
      expect(data.lane).toBe(-1);
      // Tick preview still applies: 480 ticks → 500ms downstream of tick 0.
      expect(dragged.msTime).toBeCloseTo(500, 5);
    });

    it('previews a 5-lane drum drag at the 5-lane pad positions', () => {
      // Regression: the drag resolved its schema with `schemaForInstrument`,
      // which always answers 4-lane for drums. On a 5-lane chart the notes
      // are drawn at the 5-lane Xs, so the preview jumped to a position the
      // renderer never draws a pad at — and a lane index past the 4-lane
      // schema's four pads could not be reached at all.
      const doc = makeFixtureDoc();
      const chart = {
        ...doc.parsedChart,
        drumType: drumTypes.fiveLane,
      };
      const inputs = {
        chart,
        activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
        capabilities: DRUM_EDIT_CAPABILITIES,
        timedTempos,
        resolution,
      };

      const during = computeChartElements({
        ...inputs,
        noteDrag: {
          tickDelta: 0,
          laneDelta: 1,
          ids: new Set(['drums:expert|1440:blueDrum']),
        },
      });
      const data = during.find(e => e.key === 'note:1440:blueDrum')!
        .data as NoteElementData;

      const fiveLanePads = drums5LaneSchema.lanes
        .filter(lane => !lane.fullWidth)
        .sort((a, b) => a.index - b.index);
      expect(fiveLanePads).toHaveLength(5);
      expect(data.lane).toBe(3);
      expect(data.xPosition).toBe(fiveLanePads[3].worldXOffset);
      expect(data.xPosition).not.toBe(
        drums4LaneSchema.lanes.find(lane => lane.label === 'Green')!
          .worldXOffset,
      );
    });

    it('can drag a 5-lane drum note onto the fifth pad', () => {
      // Under the 4-lane schema this clamped at the fourth pad.
      const doc = makeFixtureDoc();
      const chart = {...doc.parsedChart, drumType: drumTypes.fiveLane};
      const during = computeChartElements({
        chart,
        activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
        capabilities: DRUM_EDIT_CAPABILITIES,
        noteDrag: {
          tickDelta: 0,
          laneDelta: 2,
          ids: new Set(['drums:expert|1440:blueDrum']),
        },
        timedTempos,
        resolution,
      });
      const data = during.find(e => e.key === 'note:1440:blueDrum')!
        .data as NoteElementData;

      expect(data.lane).toBe(4);
      expect(data.editorLane).toBe(4);
    });

    it('skips the preview when timedTempos is empty', () => {
      const inputs = {...baseInputs(), timedTempos: []};
      const before = computeChartElements({...inputs, noteDrag: null});
      const during = computeChartElements({
        ...inputs,
        noteDrag: {
          tickDelta: 480,
          laneDelta: 0,
          ids: new Set(['drums:expert|480:redDrum']),
        },
      });

      const dragged = during.find(e => e.key === 'note:480:redDrum')!;
      const original = before.find(e => e.key === 'note:480:redDrum')!;
      expect(dragged.msTime).toBe(original.msTime);
    });
  });
});
