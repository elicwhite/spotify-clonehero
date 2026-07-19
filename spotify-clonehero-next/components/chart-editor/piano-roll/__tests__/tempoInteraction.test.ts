/**
 * Tempo-lane interaction seam (plan 0062 §7/§8): the piano roll turns a
 * pointer gesture into one of the shared tempo/downbeat commands. These tests
 * drive that seam the way the panel does — hit-test / clamp / nearest-beat via
 * the pure helpers, then dispatch the REAL command with the glue mode read
 * from context — so the wiring (which command, which op) is covered without
 * rendering the canvas. The remap math itself lives in (and is tested by)
 * `tempo-marker-commands` / `downbeat-commands`; this asserts the panel feeds
 * it correctly.
 */

import {buildTimedTempos, tickToMs} from '@/lib/drum-transcription/timing';
import {retimeChart} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {
  AddTempoMarkerCommand,
  MarkDownbeatCommand,
  MoveTempoMarkerCommand,
  type TempoGlueMode,
} from '../../commands';
import {makeFixtureDoc} from '../../__tests__/fixtures';
import {buildBeatGrid} from '../scene';
import {clampMarkerMs, hitTempoMarker, nearestBeatTick} from '../tempoHitTest';
import {msToX, type PianoRollView} from '../viewMath';

const VIEW: PianoRollView = {leftMs: 0, pxPerMs: 0.05};

/** makeFixtureDoc, fully retimed so every raw note event carries msTime. */
function fixture(): ChartDocument {
  const doc = makeFixtureDoc();
  retimeChart(doc.parsedChart);
  return doc;
}

interface Marker {
  tick: number;
  ms: number;
}

function markersOf(doc: ChartDocument): Marker[] {
  const parsed = doc.parsedChart;
  const timed = buildTimedTempos(parsed.tempos, parsed.resolution);
  return parsed.tempos.map(t => ({
    tick: t.tick,
    ms: tickToMs(t.tick, timed, parsed.resolution),
  }));
}

/** Raw note events (which carry msTime), sorted by tick then type. */
function rawNotes(doc: ChartDocument) {
  return doc.parsedChart.trackData[0].noteEventGroups
    .flat()
    .map(n => ({tick: n.tick, type: n.type, msTime: n.msTime}))
    .sort((a, b) => a.tick - b.tick || a.type - b.type);
}

function noteMsTimes(doc: ChartDocument): number[] {
  return rawNotes(doc).map(n => n.msTime);
}

function noteTicks(doc: ChartDocument): number[] {
  return rawNotes(doc).map(n => n.tick);
}

/** Reproduce the panel's marker-drag pipeline: pick the marker under x, clamp
 *  the target ms, then run MoveTempoMarkerCommand with the glue mode. */
function dragMarkerTo(
  doc: ChartDocument,
  markerIndex: number,
  desiredMs: number,
  glue: TempoGlueMode,
): {index: number; doc: ChartDocument} {
  const markers = markersOf(doc);
  const grabX = msToX(markers[markerIndex].ms, VIEW);
  const index = hitTempoMarker(markers, VIEW, grabX);
  const totalMs = markers[markers.length - 1].ms + 10000;
  const clamped = clampMarkerMs(markers, index, desiredMs, totalMs);
  return {
    index,
    doc: new MoveTempoMarkerCommand(markers[index].tick, clamped, glue).execute(
      doc,
    ),
  };
}

describe('marker drag → MoveTempoMarkerCommand', () => {
  it('hit-tests the grabbed marker (fixture marker 1 at tick 1920)', () => {
    const {index} = dragMarkerTo(fixture(), 1, 5000, 'audio');
    expect(index).toBe(1);
  });

  it('audio glue keeps note wall-clock time (KEEP-MS)', () => {
    const doc = fixture();
    const before = noteMsTimes(doc);
    const {doc: after} = dragMarkerTo(
      doc,
      1,
      markersOf(doc)[1].ms + 300,
      'audio',
    );
    const now = noteMsTimes(after);
    expect(now).toHaveLength(before.length);
    // KEEP-MS preserves wall-clock time within the quantizer's abstain band.
    now.forEach((ms, i) => expect(Math.abs(ms - before[i])).toBeLessThan(45));
  });

  it('grid glue keeps note ticks (KEEP-TICKS)', () => {
    const doc = fixture();
    const before = noteTicks(doc);
    const {doc: after} = dragMarkerTo(
      doc,
      1,
      markersOf(doc)[1].ms + 300,
      'grid',
    );
    expect(noteTicks(after)).toEqual(before);
  });

  it('the min-segment clamp keeps a marker off its lower neighbour', () => {
    const doc = fixture();
    const markers = markersOf(doc);
    // Try to drag marker 1 far left, past marker 0 (tick 0, ms 0).
    const clamped = clampMarkerMs(markers, 1, -9999, markers[1].ms + 10000);
    expect(clamped).toBeGreaterThan(markers[0].ms);
  });
});

describe('context menu → AddTempoMarkerCommand (mapping-neutral)', () => {
  it('adds a marker at the nearest beat without moving notes', () => {
    const doc = fixture();
    const parsed = doc.parsedChart;
    const timed = buildTimedTempos(parsed.tempos, parsed.resolution);
    const beats = buildBeatGrid(
      parsed.timeSignatures,
      parsed.resolution,
      parsed.resolution * 4 * 4,
      timed,
    );
    // Point at beat tick 480 (500ms @120BPM → 25px under pxPerMs 0.05).
    const targetX = msToX(tickToMs(480, timed, parsed.resolution), VIEW);
    const beatTick = nearestBeatTick(beats, VIEW, targetX);
    expect(beatTick).toBe(480);

    const before = noteMsTimes(doc);
    const after = new AddTempoMarkerCommand(beatTick!).execute(doc);
    expect(after.parsedChart.tempos.some(t => t.tick === 480)).toBe(true);
    // Inserted on the current tempo line: notes don't move.
    noteMsTimes(after).forEach((ms, i) => expect(ms).toBeCloseTo(before[i], 3));
  });
});

describe('context menu → MarkDownbeatCommand', () => {
  it('marking a mid-bar beat emits a derived meter change (real denominator)', () => {
    const doc = fixture();
    const before = noteMsTimes(doc);
    // Mark the beat at tick 480 (beat 2 of a 4/4 bar) as a downbeat.
    const after = new MarkDownbeatCommand(480).execute(doc);
    // A new TS event appears at the marked beat, carrying a real denominator.
    const ts = after.parsedChart.timeSignatures.find(t => t.tick === 480);
    expect(ts).toBeDefined();
    expect(ts!.denominator).toBe(4);
    // Bar relabel is class (c): no note is retimed.
    noteMsTimes(after).forEach((ms, i) => expect(ms).toBeCloseTo(before[i], 3));
  });
});
