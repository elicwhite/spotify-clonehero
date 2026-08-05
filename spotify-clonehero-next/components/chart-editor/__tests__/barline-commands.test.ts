/**
 * Bar-line placement commands (plan 0082): placing a downbeat at an arbitrary
 * tick, moving a time-signature marker, and removing one.
 *
 * Like the other bar-relabel edits these change only `timeSignatures` — no
 * note moves, and every event's `msTime` survives untouched. The arithmetic
 * itself is covered in `lib/chart-edit/__tests__/downbeat.test.ts`; these
 * tests pin the command seam: what lands on the doc, what is left alone, and
 * that `execute` leaves its input intact so the reducer's snapshot undo works.
 */

import {
  PlaceDownbeatCommand,
  MoveTimeSignatureCommand,
  RemoveTimeSignatureCommand,
} from '../commands';
import {expectDocsEqual} from './fixtures';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {
  addDrumNote,
  addTimeSignature,
  createEmptyChart,
  deriveBeatGrid,
  retimeChart,
  type ChartDocument,
} from '@/lib/chart-edit';
import {noteTypes} from '@eliwhite/scan-chart';

const RES = 480;
const BAR = RES * 4;

/** A 4/4, 120 BPM doc with a note on every quarter for `beats` beats. */
function barsDoc(beats: number): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: RES});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  const drums = doc.parsedChart.trackData[0];
  for (let i = 0; i <= beats; i++) {
    addDrumNote(drums, {tick: i * RES, type: noteTypes.redDrum});
  }
  retimeChart(doc.parsedChart);
  return doc;
}

function noteMsTimes(doc: ChartDocument): number[] {
  return doc.parsedChart.trackData[0].noteEventGroups
    .flat()
    .sort((a, b) => a.tick - b.tick)
    .map(n => n.msTime);
}

function barLineTicks(doc: ChartDocument, endTick: number): number[] {
  return deriveBeatGrid(doc.parsedChart.timeSignatures, RES, endTick)
    .filter(beat => beat.isDownbeat)
    .map(beat => beat.tick);
}

describe('PlaceDownbeatCommand', () => {
  it('shortens the measure before the new bar line and resumes the meter', () => {
    const before = barsDoc(24);
    const target = BAR * 3 - RES / 4; // a sixteenth early
    const after = new PlaceDownbeatCommand(target).execute(before);

    expect(
      after.parsedChart.timeSignatures.map(ts => [
        ts.tick,
        ts.numerator,
        ts.denominator,
      ]),
    ).toEqual([
      [0, 4, 4],
      [BAR * 2, 15, 16],
      [target, 4, 4],
    ]);
  });

  it('makes every later bar line follow from the new downbeat', () => {
    const before = barsDoc(24);
    const target = BAR * 3 - RES / 4;
    const after = new PlaceDownbeatCommand(target).execute(before);
    const bars = barLineTicks(after, target + BAR * 2);
    expect(bars).toContain(target);
    expect(bars).toContain(target + BAR);
    expect(bars).not.toContain(BAR * 3);
  });

  it('retimes no note', () => {
    const before = barsDoc(24);
    const beforeMs = noteMsTimes(before);
    const after = new PlaceDownbeatCommand(BAR * 3 - RES / 4).execute(before);
    expect(noteMsTimes(after)).toEqual(beforeMs);
  });

  it('is a no-op at tick 0 and when the placement changes nothing', () => {
    const before = barsDoc(8);
    expect(new PlaceDownbeatCommand(0).execute(before)).toBe(before);
    const once = new PlaceDownbeatCommand(BAR + RES).execute(before);
    expect(new PlaceDownbeatCommand(BAR + RES).execute(once)).toBe(once);
  });

  it('refuses a target no time signature can measure', () => {
    const before = barsDoc(8);
    // 5 ticks past a bar line is not a whole number of 64th notes.
    expect(new PlaceDownbeatCommand(BAR + 5).execute(before)).toBe(before);
  });

  it('execute leaves the input doc untouched (valid undo snapshot)', () => {
    const before = barsDoc(8);
    const pristine = barsDoc(8);
    const after = new PlaceDownbeatCommand(BAR + RES).execute(before);
    expect(after).not.toBe(before);
    expectDocsEqual(before, pristine);
  });
});

describe('MoveTimeSignatureCommand', () => {
  function docWithMarker(): ChartDocument {
    const doc = barsDoc(24);
    addTimeSignature(doc, BAR * 3, 7, 8);
    return doc;
  }

  it('carries the marker to the new tick with its own meter', () => {
    const before = docWithMarker();
    const target = BAR * 3 + RES;
    const after = new MoveTimeSignatureCommand(BAR * 3, target).execute(before);
    const moved = after.parsedChart.timeSignatures.find(
      ts => ts.tick === target,
    );
    expect(moved).toMatchObject({numerator: 7, denominator: 8});
  });

  it('rewrites the measure the drop shortened', () => {
    const before = docWithMarker();
    const target = BAR * 3 + RES;
    const after = new MoveTimeSignatureCommand(BAR * 3, target).execute(before);
    expect(
      after.parsedChart.timeSignatures.find(ts => ts.tick === BAR * 3),
    ).toMatchObject({numerator: 1, denominator: 4});
  });

  it('never moves the chart’s initial signature', () => {
    const before = docWithMarker();
    expect(new MoveTimeSignatureCommand(0, BAR).execute(before)).toBe(before);
  });

  it('is a no-op when the drop lands back on the marker’s own tick', () => {
    const before = docWithMarker();
    expect(new MoveTimeSignatureCommand(BAR * 3, BAR * 3).execute(before)).toBe(
      before,
    );
  });

  it('retimes no note', () => {
    const before = docWithMarker();
    const beforeMs = noteMsTimes(before);
    const after = new MoveTimeSignatureCommand(BAR * 3, BAR * 3 + RES).execute(
      before,
    );
    expect(noteMsTimes(after)).toEqual(beforeMs);
  });
});

describe('RemoveTimeSignatureCommand', () => {
  it('removes the authored event and nothing else', () => {
    const before = barsDoc(24);
    addTimeSignature(before, BAR * 3, 7, 8);
    const after = new RemoveTimeSignatureCommand(BAR * 3).execute(before);
    expect(after.parsedChart.timeSignatures.map(ts => ts.tick)).toEqual([0]);
  });

  it('is a no-op at tick 0 and where no event exists', () => {
    const before = barsDoc(8);
    expect(new RemoveTimeSignatureCommand(0).execute(before)).toBe(before);
    expect(new RemoveTimeSignatureCommand(BAR).execute(before)).toBe(before);
  });

  it('execute leaves the input doc untouched (valid undo snapshot)', () => {
    const before = barsDoc(8);
    addTimeSignature(before, BAR * 2, 3, 4);
    const pristine = barsDoc(8);
    addTimeSignature(pristine, BAR * 2, 3, 4);
    const after = new RemoveTimeSignatureCommand(BAR * 2).execute(before);
    expect(after).not.toBe(before);
    expectDocsEqual(before, pristine);
  });
});
