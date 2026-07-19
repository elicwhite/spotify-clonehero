/**
 * Tempo marker command tests (plan 0061 §3 class (a); §5 op-classification).
 *
 * The glue mode picks the note-handling op at dispatch:
 *  - `'grid'`  → KEEP-TICKS: notes keep their ticks, ride the moving grid.
 *  - `'audio'` → KEEP-MS: notes keep their wall-clock time, re-tick.
 *
 * Add-on-line is mapping-neutral (no note moves under either mode). Undo of a
 * remap is a whole-doc snapshot restore (remaps aren't closed-form invertible).
 */

import {
  AddBPMCommand,
  MoveTempoMarkerCommand,
  AddTempoMarkerCommand,
  DeleteTempoMarkerCommand,
} from '../commands';
import {expectDocsEqual, makeFixtureDoc} from './fixtures';
import type {ChartDocument} from '@/lib/chart-edit';
import {retimeChart} from '@/lib/chart-edit';

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

  it('undo restores the pre-edit doc (both glue modes)', () => {
    for (const glue of ['grid', 'audio'] as const) {
      const before = fixture();
      const cmd = new AddBPMCommand(0, 90, glue);
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
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

  it('undo restores the pre-edit doc (both glue modes)', () => {
    for (const glue of ['grid', 'audio'] as const) {
      const before = fixture();
      const cmd = new MoveTempoMarkerCommand(1920, 2300, glue);
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
    }
  });
});

describe('AddTempoMarkerCommand', () => {
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

  it('undo restores the pre-edit doc', () => {
    const before = fixture();
    const cmd = new AddTempoMarkerCommand(960);
    const after = cmd.execute(before);
    expectDocsEqual(cmd.undo(after), before);
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

  it('undo restores the pre-edit doc (both glue modes)', () => {
    for (const glue of ['grid', 'audio'] as const) {
      const before = fixture();
      const cmd = new DeleteTempoMarkerCommand(1920, glue);
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
    }
  });
});
