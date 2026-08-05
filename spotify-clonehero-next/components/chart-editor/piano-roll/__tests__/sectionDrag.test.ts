/**
 * Sections and tempo markers are draggable along the timeline. The panel
 * invents no bespoke section-move operation — dragging a section flag along
 * the ruler issues the shared `MoveEntitiesCommand('section', ...)`, the same
 * command every other surface uses to move an entity. This test drives that
 * seam directly (grid-snapped tick delta -> command -> execute/undo) without
 * rendering the canvas, matching the "one store, one command per gesture"
 * invariant.
 */

import {snapTickToGrid} from '@/lib/chart-edit';
import {MoveEntitiesCommand} from '../../commands';
import {entityContextFromScope} from '../../scope';
import {makeFixtureDoc, normalizeDoc} from '../../__tests__/fixtures';

describe('section drag', () => {
  it('issues MoveEntitiesCommand("section", [id], tickDelta, 0)', () => {
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

    // execute() must leave its input doc untouched — that's what makes it a
    // valid snapshot for the reducer's `undoEntries` to restore.
    expect(normalizeDoc(doc)).toEqual(normalizeDoc(makeFixtureDoc()));
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
