/**
 * Downbeat command tests (plan 0061 §6 / §3b; 0062 §8).
 *
 * These are class-(c) bar-relabel edits: they change only `timeSignatures`
 * (re-derived from the mutated `DownbeatFlags` store), never a note. The
 * property tests assert exactly that — every note's `msTime` is bit-identical
 * across a rephase, phase-0 taps are byte-identical no-ops, undo restores the
 * pre-edit doc, no meter-change TS event lands on a mid-song tapped beat, and
 * the store the reducer recomputes matches the persisted chart.
 */

import {
  MarkDownbeatCommand,
  UnmarkDownbeatCommand,
  RephaseDownbeatsCommand,
} from '../commands';
import {chartEditorReducer, initialState} from '@/lib/chart-editor-core';
import {expectDocsEqual} from './fixtures';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {
  addDrumNote,
  createEmptyChart,
  deriveDownbeatFlags,
  retimeChart,
  type ChartDocument,
} from '@/lib/chart-edit';

const RES = 480;

/** A 4/4, 120 BPM doc with a downbeat per bar for `beats` quarter-note beats,
 *  a note on every beat, fully retimed. Downbeats fall at ticks 0, 1920, ... */
function barsDoc(beats: number): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: RES});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  const drums = doc.parsedChart.trackData[0];
  for (let i = 0; i <= beats; i++) {
    addDrumNote(drums, {tick: i * RES, type: 'redDrum'});
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

function noteTicks(doc: ChartDocument): number[] {
  return doc.parsedChart.trackData[0].noteEventGroups
    .flat()
    .map(n => n.tick)
    .sort((a, b) => a - b);
}

describe('RephaseDownbeatsCommand', () => {
  it('is a byte-identical no-op when the tapped beat is already a downbeat', () => {
    const before = barsDoc(16);
    // tick 1920 = beat 4 = an existing 4/4 downbeat (phase 0).
    const cmd = new RephaseDownbeatsCommand(1920);
    expect(cmd.execute(before)).toBe(before);
  });

  it('leaves every note msTime and tick bit-identical (no note retiming)', () => {
    const before = barsDoc(16);
    const beforeMs = noteMsTimes(before);
    const beforeTicks = noteTicks(before);

    // Tap beat 5 (tick 2400), phase 1 — a mid-song beat under the new lattice.
    const after = new RephaseDownbeatsCommand(2400).execute(before);

    expect(noteMsTimes(after)).toEqual(beforeMs); // bit-identical
    expect(noteTicks(after)).toEqual(beforeTicks);
    // timeSignatures actually changed (a pickup bar appeared at the start).
    expect(after.parsedChart.timeSignatures).not.toEqual(
      before.parsedChart.timeSignatures,
    );
  });

  it('emits no meter-change TS event at the tapped beat', () => {
    const before = barsDoc(16);
    const after = new RephaseDownbeatsCommand(2400).execute(before);
    expect(after.parsedChart.timeSignatures.some(ts => ts.tick === 2400)).toBe(
      false,
    );
  });

  it('rotates the lattice so the tapped beat becomes a downbeat', () => {
    const before = barsDoc(16);
    const after = new RephaseDownbeatsCommand(2400).execute(before);
    const flags = deriveDownbeatFlags(
      after.parsedChart.timeSignatures,
      RES,
      16 * RES,
    );
    const ticks = flags.downbeats.map(d => d.tick);
    expect(ticks).toContain(0); // tick 0 always pinned
    expect(ticks).toContain(2400); // the tapped beat
    expect(ticks).not.toContain(1920); // old downbeat re-flagged away
  });

  it('undo restores the pre-edit doc exactly', () => {
    const before = barsDoc(16);
    const cmd = new RephaseDownbeatsCommand(2400);
    const after = cmd.execute(before);
    expectDocsEqual(cmd.undo(after), before);
  });
});

describe('MarkDownbeatCommand', () => {
  it('marks a mid-bar beat, producing a derived meter change', () => {
    const before = barsDoc(8); // one 4/4 event at tick 0
    // Mark beat 6 (tick 2880), mid-bar of the second 4/4 bar.
    const after = new MarkDownbeatCommand(2880).execute(before);
    const ts = after.parsedChart.timeSignatures;
    // A 2/4 pickup appears at the previous downbeat (1920) before the new one.
    expect(ts.some(t => t.tick === 1920)).toBe(true);
    // The store recomputed from the chart carries the new downbeat.
    const flags = deriveDownbeatFlags(ts, RES, 8 * RES);
    expect(flags.downbeats.map(d => d.tick)).toContain(2880);
  });

  it('leaves every note msTime bit-identical', () => {
    const before = barsDoc(8);
    const beforeMs = noteMsTimes(before);
    const after = new MarkDownbeatCommand(2880).execute(before);
    expect(noteMsTimes(after)).toEqual(beforeMs);
  });

  it('is a no-op on an existing downbeat', () => {
    const before = barsDoc(8);
    expect(new MarkDownbeatCommand(1920).execute(before)).toBe(before);
  });

  it('marks a tail beat past the last charted event with the audio-extended span (Finding 7)', () => {
    const before = barsDoc(8); // notes 0..3840; chartEndTick = 3840
    const tailBeat = 5280; // 11 quarter-beats in — past the last note, off-downbeat
    const span = 7680; // the panel's audio-extended beat span

    // Without the span, the command derives its grid over chartEndTick (3840):
    // the tap snaps to the nearest in-span beat (an existing downbeat) and the
    // mark silently no-ops — the tail-beat disagreement between the menu and
    // the command.
    const withoutSpan = new MarkDownbeatCommand(tailBeat).execute(before);
    expect(
      deriveDownbeatFlags(
        withoutSpan.parsedChart.timeSignatures,
        RES,
        span,
      ).downbeats.map(d => d.tick),
    ).not.toContain(tailBeat);

    // With the shared audio-extended span, the tail beat itself is marked.
    const withSpan = new MarkDownbeatCommand(tailBeat, span).execute(before);
    expect(
      deriveDownbeatFlags(
        withSpan.parsedChart.timeSignatures,
        RES,
        span,
      ).downbeats.map(d => d.tick),
    ).toContain(tailBeat);
  });

  it('undo restores the pre-edit doc exactly', () => {
    const before = barsDoc(8);
    const cmd = new MarkDownbeatCommand(2880);
    const after = cmd.execute(before);
    expectDocsEqual(cmd.undo(after), before);
  });
});

describe('UnmarkDownbeatCommand', () => {
  it('removes a previously-marked downbeat (round-trips a mark)', () => {
    const before = barsDoc(8);
    const marked = new MarkDownbeatCommand(2880).execute(before);
    const unmarked = new UnmarkDownbeatCommand(2880).execute(marked);
    // Back to the single 4/4 event at tick 0.
    expectDocsEqual(unmarked, before);
  });

  it('cannot remove the tick-0 downbeat', () => {
    const before = barsDoc(8);
    expect(new UnmarkDownbeatCommand(0).execute(before)).toBe(before);
  });

  it('is a no-op when no downbeat exists at the tick', () => {
    const before = barsDoc(8);
    expect(new UnmarkDownbeatCommand(2880).execute(before)).toBe(before);
  });
});

describe('downbeat store recompute (reducer)', () => {
  it('SET_CHART_DOC derives the flag store from the chart', () => {
    const doc = barsDoc(8);
    const state = chartEditorReducer(initialState, {
      type: 'SET_CHART_DOC',
      chartDoc: doc,
    });
    expect(state.downbeatFlags.downbeats.map(d => d.tick)).toEqual([
      0, 1920, 3840,
    ]);
  });

  it('EXECUTE_COMMAND recomputes the store to match the mutated chart', () => {
    const doc = barsDoc(8);
    const loaded = chartEditorReducer(initialState, {
      type: 'SET_CHART_DOC',
      chartDoc: doc,
    });
    const cmd = new MarkDownbeatCommand(2880);
    const newDoc = cmd.execute(doc);
    const next = chartEditorReducer(loaded, {
      type: 'EXECUTE_COMMAND',
      command: cmd,
      chartDoc: newDoc,
    });
    // The recomputed store equals a fresh derivation of the persisted chart —
    // store and chart can't diverge.
    expect(next.downbeatFlags).toEqual(
      deriveDownbeatFlags(newDoc.parsedChart.timeSignatures, RES, 8 * RES),
    );
    expect(next.downbeatFlags.downbeats.map(d => d.tick)).toContain(2880);
  });
});
