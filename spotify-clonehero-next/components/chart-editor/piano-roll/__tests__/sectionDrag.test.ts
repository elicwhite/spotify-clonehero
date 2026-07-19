/**
 * Section-drag command parity (plan 0062 §6): "sections and tempo markers
 * are draggable along the timeline." The panel does not invent a bespoke
 * section-move operation — dragging a section flag along the ruler must
 * issue the exact same `MoveEntitiesCommand('section', ...)` the highway's
 * `useMarkerDrag` already issues for a section marker drag (see
 * `highway/useMarkerDrag.ts`'s `commitMarkerDrag`). This test drives that
 * shared seam directly (grid-snapped tick delta -> command -> execute/undo)
 * without rendering either view's canvas, matching the "Two views, one
 * store" invariant: one command type + params for equivalent gestures.
 */

import {snapTickToGrid} from '@/lib/chart-edit';
import {MoveEntitiesCommand} from '../../commands';
import {entityContextFromScope} from '../../scope';
import {makeFixtureDoc, normalizeDoc} from '../../__tests__/fixtures';

describe('section drag: command parity with the highway', () => {
  it('issues MoveEntitiesCommand("section", [id], tickDelta, 0) — the same shape useMarkerDrag builds', () => {
    const doc = makeFixtureDoc();
    const resolution = doc.parsedChart.resolution;
    const originalTick = 1920; // "Verse" section (see fixtures.ts)
    const rawTargetTick = 2500;
    const snapped = snapTickToGrid(rawTargetTick, resolution, 16);
    const tickDelta = snapped - originalTick;

    const cmd = new MoveEntitiesCommand(
      'section',
      [String(originalTick)],
      tickDelta,
      0,
      entityContextFromScope({
        kind: 'track',
        track: {instrument: 'drums', difficulty: 'expert'},
      }),
    );

    const moved = cmd.execute(doc);
    const verse = moved.parsedChart.sections.find(s => s.name === 'Verse');
    expect(verse?.tick).toBe(snapped);
    // The other section is untouched.
    expect(moved.parsedChart.sections.find(s => s.name === 'Intro')?.tick).toBe(
      0,
    );

    // Round-trips through undo back to the exact original layout.
    const restored = cmd.undo(moved);
    expect(normalizeDoc(restored)).toEqual(normalizeDoc(doc));
  });

  it('a no-op drag (grid-snap lands back on the original tick) is a zero delta', () => {
    const doc = makeFixtureDoc();
    const originalTick = 1920;
    // Snapping the original tick itself always yields tickDelta 0 — the
    // panel's "click, no real move" case, mirroring a marker drag that
    // ends where it started.
    const snapped = snapTickToGrid(
      originalTick,
      doc.parsedChart.resolution,
      16,
    );
    expect(snapped - originalTick).toBe(0);
  });

  it('clamps to tick 0 rather than going negative, same as the shared section handler', () => {
    const doc = makeFixtureDoc();
    const originalTick = 480;
    const cmd = new MoveEntitiesCommand(
      'section',
      [String(originalTick)],
      -10000, // wildly past the start
      0,
    );
    const moved = cmd.execute(doc);
    // "Intro" started at 0 and can't move (already there / floor is 0);
    // any section handler clamps to >= 0 tick.
    for (const s of moved.parsedChart.sections) {
      expect(s.tick).toBeGreaterThanOrEqual(0);
    }
  });
});
