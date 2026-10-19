/**
 * Tempo marker command tests (plan 0061 §3 class (a); §5 op-classification).
 *
 * The glue mode picks the note-handling op at dispatch:
 *  - `'grid'`  → KEEP-TICKS: notes keep their ticks, ride the moving grid.
 *  - `'audio'` → KEEP-MS: notes keep their wall-clock time, re-tick.
 *
 * Add-on-line is mapping-neutral (no note moves under either mode). Undo is
 * snapshot replay (`undoEntries`), not command inversion — a remap isn't
 * closed-form invertible, so each `execute()` must leave its input doc
 * untouched to remain a valid snapshot.
 */

import {
  AddBPMCommand,
  MoveTempoMarkerCommand,
  AddTempoMarkerCommand,
  DeleteTempoMarkerCommand,
  DeleteTempoMarkersCommand,
  BatchCommand,
} from '../commands';
import {makeEmptyDrumDoc, makeFixtureDoc} from './fixtures';
import type {ChartDocument} from '@/lib/chart-edit';
import {noteTypes} from '@eliwhite/scan-chart';
import {
  addDrumNote,
  refreshAnchorKeepMs,
  remapKeepMs,
  retimeChart,
  synctrackFromChart,
} from '@/lib/chart-edit';

/** makeFixtureDoc, fully retimed so every note carries a correct audio time.
 *  Tempos: 120bpm @ tick 0, 140bpm @ tick 1920. Notes @ 0/480/960/1440/1920. */
function fixture(): ChartDocument {
  const doc = makeFixtureDoc();
  retimeChart(doc.parsedChart);
  return doc;
}

function drumNotes(doc: ChartDocument) {
  return doc.parsedChart.trackData[0].noteEventGroups
    .flat()
    .map(n => ({tick: n.tick, type: n.type, msTime: n.msTime}))
    .sort((a, b) => a.tick - b.tick || a.type - b.type);
}

describe('AddBPMCommand (glue-aware class-(a) hand-edit, plan 0061 §3a)', () => {
  it('grid glue (KEEP-TICKS): notes keep their ticks, audio time shifts', () => {
    const before = fixture();
    const beforeTicks = drumNotes(before).map(n => n.tick);
    const beforeMs = drumNotes(before).map(n => n.msTime);

    // Retype the song's opening tempo from 120 to 90 (a whole-song slowdown).
    const after = new AddBPMCommand(0, 90, 'grid').execute(before);
    const afterNotes = drumNotes(after);

    expect(afterNotes.map(n => n.tick)).toEqual(beforeTicks);
    expect(afterNotes.map(n => n.msTime)).not.toEqual(beforeMs);
  });

  it('audio glue (KEEP-MS, the default op): notes keep audio time, re-tick', () => {
    const before = fixture();
    const beforeMs = drumNotes(before);
    const beforeTicks = drumNotes(before).map(n => n.tick);

    const after = new AddBPMCommand(0, 90, 'audio').execute(before);
    const afterNotes = drumNotes(after);

    // Every note's audio time is preserved (within the abstain band) — the
    // audio-anchored default never second-guesses a hand-placed note.
    for (const b of beforeMs) {
      const a = afterNotes.find(n => n.type === b.type)!;
      expect(Math.abs(a.msTime - b.msTime)).toBeLessThan(45);
    }
    // The grid changed, so the notes re-ticked off their original ticks.
    expect(afterNotes.map(n => n.tick)).not.toEqual(beforeTicks);
  });

  it('format-quantizes the retyped BPM (no serialization drift)', () => {
    const before = fixture();
    // An arbitrary BPM that isn't milli-BPM representable.
    const after = new AddBPMCommand(0, 128.7654321, 'grid').execute(before);
    const bpm = after.parsedChart.tempos.find(
      t => t.tick === 0,
    )!.beatsPerMinute;
    expect(bpm).toBe(Math.round(128.7654321 * 1e3) / 1e3);
  });

  it('retypes an existing marker rather than stacking a second one', () => {
    const before = fixture();
    const at = before.parsedChart.tempos[1].tick;
    const after = new AddBPMCommand(at, 155, 'audio').execute(before);

    const atTick = after.parsedChart.tempos.filter(t => t.tick === at);
    expect(atTick).toHaveLength(1);
    expect(atTick[0].beatsPerMinute).toBeCloseTo(155, 3);
  });

  it('execute leaves the input doc untouched (valid undo snapshot)', () => {
    for (const glue of ['grid', 'audio'] as const) {
      const before = fixture();
      const beforeNotes = drumNotes(before);
      const cmd = new AddBPMCommand(0, 90, glue);
      const after = cmd.execute(before);
      expect(after).not.toBe(before);
      expect(drumNotes(before)).toEqual(beforeNotes);
    }
  });
});

describe('MoveTempoMarkerCommand', () => {
  it('grid glue (KEEP-TICKS): notes keep their ticks, audio time shifts', () => {
    const before = fixture();
    const beforeTicks = drumNotes(before).map(n => n.tick);
    const beforeMs = drumNotes(before).map(n => n.msTime);

    // Drag the tick-1920 marker (orig 2000ms) later to 2300ms.
    const cmd = new MoveTempoMarkerCommand(1920, 2300, 'grid');
    const after = cmd.execute(before);
    const afterNotes = drumNotes(after);

    expect(afterNotes.map(n => n.tick)).toEqual(beforeTicks);
    // At least one note's audio time changed (the grid moved under it).
    expect(afterNotes.map(n => n.msTime)).not.toEqual(beforeMs);
  });

  it('audio glue (KEEP-MS): notes keep their audio time, ticks re-tick', () => {
    const before = fixture();
    const beforeMs = drumNotes(before);
    const beforeTicks = drumNotes(before).map(n => n.tick);

    const cmd = new MoveTempoMarkerCommand(1920, 2300, 'audio');
    const after = cmd.execute(before);
    const afterNotes = drumNotes(after);

    // Every note's audio time is preserved (within the abstain band).
    for (const b of beforeMs) {
      const a = afterNotes.find(n => n.type === b.type)!;
      expect(Math.abs(a.msTime - b.msTime)).toBeLessThan(45);
    }
    // The note at the dragged marker re-ticked off tick 1920.
    expect(afterNotes.map(n => n.tick)).not.toEqual(beforeTicks);
  });

  it('is a no-op on the song-start anchor (tick 0)', () => {
    const before = fixture();
    const cmd = new MoveTempoMarkerCommand(0, 500, 'audio');
    expect(cmd.execute(before)).toBe(before);
  });

  it('is a no-op when no marker exists at the tick', () => {
    const before = fixture();
    const cmd = new MoveTempoMarkerCommand(240, 500, 'audio');
    expect(cmd.execute(before)).toBe(before);
  });

  it('execute leaves the input doc untouched (valid undo snapshot)', () => {
    for (const glue of ['grid', 'audio'] as const) {
      const before = fixture();
      const beforeNotes = drumNotes(before);
      const cmd = new MoveTempoMarkerCommand(1920, 2300, glue);
      const after = cmd.execute(before);
      expect(after).not.toBe(before);
      expect(drumNotes(before)).toEqual(beforeNotes);
    }
  });
});

describe('AddTempoMarkerCommand', () => {
  // The authoring loop the tempo lane prescribes: drop mapping-neutral
  // markers, then retype one. Every marker added this way is same-BPM as its
  // predecessor by construction, so a KEEP-MS remap that collapses same-BPM
  // runs would delete the rest of the user's grid on the first retype.
  it('survives a later retype of another marker (audio glue)', () => {
    const withMarkers = new AddTempoMarkerCommand(2880).execute(
      new AddTempoMarkerCommand(960).execute(fixture()),
    );
    expect(withMarkers.parsedChart.tempos.map(t => t.tick)).toEqual([
      0, 960, 1920, 2880,
    ]);

    const after = new AddBPMCommand(960, 100, 'audio').execute(withMarkers);
    expect(after.parsedChart.tempos.map(t => t.tick)).toEqual([
      0, 960, 1920, 2880,
    ]);
    expect(
      after.parsedChart.tempos.find(t => t.tick === 960)?.beatsPerMinute,
    ).toBeCloseTo(100, 3);
  });

  it('adds a marker on the current tempo line without moving notes', () => {
    const before = fixture();
    const beforeNotes = drumNotes(before);

    // Add a marker at tick 960 (governed by the 120bpm segment).
    const cmd = new AddTempoMarkerCommand(960);
    const after = cmd.execute(before);

    // A new tempo event exists at 960 carrying the governing 120bpm.
    const added = after.parsedChart.tempos.find(t => t.tick === 960)!;
    expect(added.beatsPerMinute).toBe(120);
    // Mapping unchanged: notes keep both tick AND audio time.
    expect(drumNotes(after)).toEqual(beforeNotes);
  });

  it('is a no-op when a marker already exists at the tick', () => {
    const before = fixture();
    const cmd = new AddTempoMarkerCommand(1920); // already a marker here
    expect(cmd.execute(before)).toBe(before);
  });

  it('execute leaves the input doc untouched (valid undo snapshot)', () => {
    const before = fixture();
    const beforeNotes = drumNotes(before);
    const cmd = new AddTempoMarkerCommand(960);
    const after = cmd.execute(before);
    expect(after).not.toBe(before);
    expect(drumNotes(before)).toEqual(beforeNotes);
  });
});

describe('DeleteTempoMarkerCommand', () => {
  it('grid glue (KEEP-TICKS): removes the marker, notes keep ticks', () => {
    const before = fixture();
    const beforeTicks = drumNotes(before).map(n => n.tick);

    const cmd = new DeleteTempoMarkerCommand(1920, 'grid');
    const after = cmd.execute(before);

    expect(after.parsedChart.tempos.some(t => t.tick === 1920)).toBe(false);
    expect(drumNotes(after).map(n => n.tick)).toEqual(beforeTicks);
  });

  it('audio glue (KEEP-MS): removes the marker, notes keep audio time', () => {
    const before = fixture();
    const beforeMs = drumNotes(before);

    const cmd = new DeleteTempoMarkerCommand(1920, 'audio');
    const after = cmd.execute(before);

    expect(after.parsedChart.tempos.some(t => t.tick === 1920)).toBe(false);
    for (const b of beforeMs) {
      const a = drumNotes(after).find(n => n.type === b.type)!;
      expect(Math.abs(a.msTime - b.msTime)).toBeLessThan(45);
    }
  });

  it('cannot delete the song-start anchor', () => {
    const before = fixture();
    const cmd = new DeleteTempoMarkerCommand(0, 'audio');
    expect(cmd.execute(before)).toBe(before);
  });

  it('execute leaves the input doc untouched (valid undo snapshot)', () => {
    for (const glue of ['grid', 'audio'] as const) {
      const before = fixture();
      const beforeNotes = drumNotes(before);
      const cmd = new DeleteTempoMarkerCommand(1920, glue);
      const after = cmd.execute(before);
      expect(after).not.toBe(before);
      expect(drumNotes(before)).toEqual(beforeNotes);
    }
  });
});

/**
 * Multi-marker delete. `BatchCommand` folds its members over the evolving
 * doc, so N single deletes are N sequential KEEP-MS remaps, each re-deriving
 * every note's tick from ms and rounding on top of the last one's result.
 * `DeleteTempoMarkersCommand` filters all N ticks first and remaps ONCE.
 */
describe('DeleteTempoMarkersCommand', () => {
  /**
   * A dense, deliberately off-grid fixture: 40 notes at 137-tick spacing
   * (so none sits on a beat) under seven non-integer BPM segments. KEEP-MS
   * quantizes + collision-nudges on every remap, so this is where repeated
   * remapping visibly accumulates error; a fixture whose notes all sit on
   * beat boundaries would round to the same ticks either way and prove
   * nothing.
   */
  function denseFixture(): ChartDocument {
    const doc = makeEmptyDrumDoc();
    const drums = doc.parsedChart.trackData[0];
    const types = [
      noteTypes.kick,
      noteTypes.redDrum,
      noteTypes.yellowDrum,
      noteTypes.blueDrum,
      noteTypes.greenDrum,
    ];
    for (let i = 0; i < 40; i++) {
      addDrumNote(drums, {tick: 137 * i + 23, type: types[i % 5]});
    }
    doc.parsedChart.tempos = [
      {tick: 0, beatsPerMinute: 120, msTime: 0},
      {tick: 300, beatsPerMinute: 153.7, msTime: 0},
      {tick: 700, beatsPerMinute: 96.3, msTime: 0},
      {tick: 1100, beatsPerMinute: 171.1, msTime: 0},
      {tick: 1600, beatsPerMinute: 88.4, msTime: 0},
      {tick: 2200, beatsPerMinute: 143.9, msTime: 0},
      {tick: 3000, beatsPerMinute: 111.2, msTime: 0},
    ];
    retimeChart(doc.parsedChart);
    return doc;
  }

  const INNER_TICKS = [300, 700, 1100, 1600, 2200];

  /** One filter-and-remap, done by hand — the definition of "once". */
  function oneShotReference(
    doc: ChartDocument,
    ticks: number[],
  ): ChartDocument {
    const cloned: ChartDocument = {
      ...doc,
      parsedChart: {
        ...doc.parsedChart,
        tempos: doc.parsedChart.tempos.map(t => ({...t})),
        sections: doc.parsedChart.sections.map(s => ({...s})),
        trackData: doc.parsedChart.trackData.map(t => ({
          ...t,
          noteEventGroups: t.noteEventGroups.map(g => g.map(n => ({...n}))),
        })),
      },
    };
    cloned.parsedChart.tempos = cloned.parsedChart.tempos.filter(
      t => !ticks.includes(t.tick),
    );
    return refreshAnchorKeepMs(
      remapKeepMs(cloned, synctrackFromChart(cloned.parsedChart)),
    );
  }

  it('removes every listed marker in one command', () => {
    const after = new DeleteTempoMarkersCommand(INNER_TICKS, 'grid').execute(
      denseFixture(),
    );
    expect(after.parsedChart.tempos.map(t => t.tick)).toEqual([0, 3000]);
  });

  it('applies the KEEP-MS remap ONCE for N markers, not N times', () => {
    const before = denseFixture();
    const ticks = INNER_TICKS;

    const batched = new DeleteTempoMarkersCommand(ticks, 'audio').execute(
      before,
    );
    const reference = oneShotReference(before, ticks);

    // Identical to a single filter-and-remap: no intermediate re-tick ever
    // happened, so no intermediate rounding could accumulate.
    expect(drumNotes(batched)).toEqual(drumNotes(reference));

    // The sequential form is a different (lossier) computation: each delete
    // re-ticks off the previous delete's already-rounded ticks.
    const sequential = new BatchCommand(
      ticks.map(tick => new DeleteTempoMarkerCommand(tick, 'audio')),
    ).execute(before);
    expect(drumNotes(sequential)).not.toEqual(drumNotes(batched));

    // And it drifts further from the notes' original audio times.
    const originalMs = drumNotes(before);
    const worstError = (doc: ChartDocument) =>
      Math.max(
        ...drumNotes(doc).map((n, i) =>
          Math.abs(n.msTime - originalMs[i].msTime),
        ),
      );
    expect(worstError(batched)).toBeLessThan(worstError(sequential));
  });

  it('drops tick 0 and ticks with no marker, and no-ops when nothing is left', () => {
    const before = denseFixture();
    expect(new DeleteTempoMarkersCommand([], 'audio').execute(before)).toBe(
      before,
    );
    expect(new DeleteTempoMarkersCommand([0], 'audio').execute(before)).toBe(
      before,
    );
    expect(
      new DeleteTempoMarkersCommand([7, 99], 'audio').execute(before),
    ).toBe(before);

    const after = new DeleteTempoMarkersCommand([0, 700, 99], 'grid').execute(
      before,
    );
    expect(after.parsedChart.tempos.map(t => t.tick)).toEqual([
      0, 300, 1100, 1600, 2200, 3000,
    ]);
  });

  it('execute leaves the input doc untouched (valid undo snapshot)', () => {
    for (const glue of ['grid', 'audio'] as const) {
      const before = denseFixture();
      const beforeNotes = drumNotes(before);
      const after = new DeleteTempoMarkersCommand([300, 700], glue).execute(
        before,
      );
      expect(after).not.toBe(before);
      expect(drumNotes(before)).toEqual(beforeNotes);
    }
  });
});
