/**
 * Downbeat-flag store operation tests (plan 0061 §3b/§6; 0062 §8).
 *
 * Pure tick-domain ops: mark/unmark a single beat, snap a tap to the nearest
 * beat, and the whole-song phase-rotation tap gesture. None move a note — they
 * only re-flag downbeats — so these tests work entirely in the flag/tick
 * domain; the command-level tests assert the no-note-retiming invariant.
 */

import {
  chartEndTick,
  markDownbeat,
  rephaseDownbeats,
  snapTickToNearestBeat,
  unmarkDownbeat,
} from '../downbeat-ops';
import {
  deriveDownbeatFlags,
  deriveTimeSignatures,
  type DownbeatFlags,
  type ParsedChart,
  type TimeSignatureInput,
} from '../index';

const RES = 192;

/** Downbeat flags for a uniform meter over `bars` bars from tick 0. */
function uniformFlags(
  numerator: number,
  denominator: number,
  bars: number,
): DownbeatFlags {
  const unit = (RES * 4) / denominator;
  const barTicks = numerator * unit;
  const downbeats = [];
  for (let i = 0; i < bars; i++) {
    downbeats.push({tick: i * barTicks, denominator});
  }
  return {downbeats};
}

describe('markDownbeat', () => {
  test('inserts a mid-bar downbeat sorted, inheriting the region denominator', () => {
    const flags = uniformFlags(4, 4, 3); // downbeats at 0, 768, 1536
    const marked = markDownbeat(flags, 1152); // mid-bar (beat 6 of 4/4)
    expect(marked).not.toBeNull();
    expect(marked!.downbeats).toEqual([
      {tick: 0, denominator: 4},
      {tick: 768, denominator: 4},
      {tick: 1152, denominator: 4},
      {tick: 1536, denominator: 4},
    ]);
  });

  test('inherits the denominator of the nearest preceding downbeat (6/8)', () => {
    const flags: DownbeatFlags = {
      downbeats: [
        {tick: 0, denominator: 4},
        {tick: 768, denominator: 8}, // 6/8 region starts here
      ],
    };
    const marked = markDownbeat(flags, 864); // one eighth into the 6/8 region
    expect(marked!.downbeats).toContainEqual({tick: 864, denominator: 8});
  });

  test('is a no-op on an existing downbeat', () => {
    const flags = uniformFlags(4, 4, 3);
    expect(markDownbeat(flags, 768)).toBeNull();
  });

  test('is a no-op at tick 0 and below (beat 0 is always a downbeat)', () => {
    const flags = uniformFlags(4, 4, 3);
    expect(markDownbeat(flags, 0)).toBeNull();
    expect(markDownbeat(flags, -10)).toBeNull();
  });

  test('does not mutate the input', () => {
    const flags = uniformFlags(4, 4, 3);
    const snapshot = JSON.stringify(flags);
    markDownbeat(flags, 1152);
    expect(JSON.stringify(flags)).toBe(snapshot);
  });
});

describe('unmarkDownbeat', () => {
  test('removes an existing downbeat', () => {
    const flags = uniformFlags(4, 4, 3);
    const unmarked = unmarkDownbeat(flags, 768);
    expect(unmarked!.downbeats.map(d => d.tick)).toEqual([0, 1536]);
  });

  test('is a no-op at tick 0 (never removable)', () => {
    const flags = uniformFlags(4, 4, 3);
    expect(unmarkDownbeat(flags, 0)).toBeNull();
  });

  test('is a no-op when no downbeat exists there', () => {
    const flags = uniformFlags(4, 4, 3);
    expect(unmarkDownbeat(flags, 1000)).toBeNull();
  });
});

describe('snapTickToNearestBeat', () => {
  const ts: TimeSignatureInput[] = [{tick: 0, numerator: 4, denominator: 4}];

  test('snaps to the nearest beat', () => {
    expect(snapTickToNearestBeat(ts, RES, 8 * RES, 200)).toBe(192);
    expect(snapTickToNearestBeat(ts, RES, 8 * RES, 380)).toBe(384);
    expect(snapTickToNearestBeat(ts, RES, 8 * RES, 96)).toBe(0); // ties → first
  });

  test('returns 0 when the only beat is tick 0', () => {
    expect(snapTickToNearestBeat(ts, RES, 0, 500)).toBe(0);
  });
});

describe('chartEndTick', () => {
  test('is the max tick across events, including note sustain length', () => {
    const chart = {
      timeSignatures: [{tick: 0}],
      tempos: [{tick: 0}],
      sections: [{tick: 500}],
      endEvents: [{tick: 100}],
      trackData: [
        {noteEventGroups: [[{tick: 900, length: 300}], [{tick: 400}]]},
      ],
    } as unknown as ParsedChart;
    expect(chartEndTick(chart)).toBe(1200); // 900 + 300 sustain
  });
});

describe('rephaseDownbeats', () => {
  const ts: TimeSignatureInput[] = [{tick: 0, numerator: 4, denominator: 4}];
  const endTick = 16 * RES; // 16 beats / 4 bars

  test('phase 0 (tap on an existing downbeat) is a no-op', () => {
    // tick 768 is beat 4 → a downbeat already.
    expect(rephaseDownbeats(ts, RES, endTick, 768)).toBeNull();
  });

  test('phase != 0 rotates the whole lattice and pins tick 0', () => {
    // Tap beat index 5 (tick 960), phase = 5 mod 4 = 1. New downbeats fall at
    // every beat index ≡ 1 (mod 4): 192, 960, 1728, ... plus the pinned 0.
    const rephased = rephaseDownbeats(ts, RES, endTick, 960);
    expect(rephased).not.toBeNull();
    const ticks = rephased!.downbeats.map(d => d.tick);
    expect(ticks).toContain(0);
    expect(ticks).toContain(192);
    expect(ticks).toContain(960);
    expect(ticks).toContain(1728);
    // The originally-labeled downbeats (0-aside) are no longer flagged.
    expect(ticks).not.toContain(768);
    expect(ticks).not.toContain(1536);
  });

  test('rephased flags round-trip through the save/load derivation', () => {
    const rephased = rephaseDownbeats(ts, RES, endTick, 960)!;
    const derivedTS = deriveTimeSignatures(rephased, RES, 4);
    const reloaded = deriveDownbeatFlags(derivedTS, RES, endTick);
    expect(reloaded.downbeats).toEqual(rephased.downbeats);
  });

  test('emits no meter change at a mid-song tapped beat', () => {
    // Tap beat index 9 (tick 1728), phase 1 — a regular 4/4 downbeat under the
    // rotated lattice, so the save derivation must NOT place a TS event there.
    const rephased = rephaseDownbeats(ts, RES, endTick, 1728)!;
    const derivedTS = deriveTimeSignatures(rephased, RES, 4);
    expect(derivedTS.some(t => t.tick === 1728)).toBe(false);
  });

  test('preserves the denominator on a 6/8 chart', () => {
    const sixEight: TimeSignatureInput[] = [
      {tick: 0, numerator: 6, denominator: 8},
    ];
    // 6/8 beat unit = 96 ticks; bar = 576. Tap beat index 2 (tick 192),
    // phase = 2 mod 6 = 2 ≠ 0.
    const rephased = rephaseDownbeats(sixEight, RES, 4 * 576, 192)!;
    expect(rephased.downbeats.every(d => d.denominator === 8)).toBe(true);
    const derivedTS = deriveTimeSignatures(rephased, RES, 6);
    const reloaded = deriveDownbeatFlags(derivedTS, RES, 4 * 576);
    expect(reloaded.downbeats).toEqual(rephased.downbeats);
  });
});
