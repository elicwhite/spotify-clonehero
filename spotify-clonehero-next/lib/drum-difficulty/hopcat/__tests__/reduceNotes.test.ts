/**
 * Unit tests ported tuple-for-tuple from
 * `drum-to-chart/analysis/hopcat_reduction_eval/tests/test_reduce_port.py`.
 * Same inputs, same expected outputs — this is a faithful reproduction of the
 * Python suite, not a new set of cases.
 *
 * The two midi_io-dependent Python tests (`test_mbt_ignores_tempo_track_...`
 * and the raw-MIDI half of the round trip) are I/O tests for the Python
 * `midi_io` module, which has no analogue here (the adapter is the TS input
 * path). The end-to-end synthetic song is reproduced below by building the
 * note/event arrays directly and running the orchestrator.
 */

import {describe, test, expect} from '@jest/globals';

import {buildMeasures} from '../../measureMap';
import {
  TIER_BASE,
  ROLL_MARKER,
  lanePitch,
  tierOf,
  removeNotes,
  type Note,
} from '../reduceNotes';
import {reduce5laneDrums, cascadeCopy} from '../reduce';

const TPQN = 480;

function note(pos: number, pitch: number, vel = 100, dur = 10): Note {
  return {pos, pitch, vel, dur};
}

// ---------------------------------------------------------------------------
// mbt() / MeasureMap
// ---------------------------------------------------------------------------

describe('mbt / MeasureMap', () => {
  test('constant 4/4', () => {
    const mm = buildMeasures([], TPQN, 1920 * 8);
    expect(mm.mbt(0)).toMatchObject({measure: 1, beat: 1, tickInBeat: 0, ticksSinceMeasureStart: 0});
    expect(mm.mbt(479)).toMatchObject({measure: 1, beat: 1, tickInBeat: 479, ticksSinceMeasureStart: 479});
    expect(mm.mbt(480)).toMatchObject({measure: 1, beat: 2, tickInBeat: 0, ticksSinceMeasureStart: 480});
    expect(mm.mbt(1920)).toMatchObject({measure: 2, beat: 1, tickInBeat: 0, ticksSinceMeasureStart: 0});
    expect(mm.mbt(1920 + 960)).toMatchObject({measure: 2, beat: 3, tickInBeat: 0, ticksSinceMeasureStart: 960});
  });

  test('mid-song time-signature change', () => {
    const mm = buildMeasures([[0, 4, 4], [7680, 7, 8]], TPQN, 7680 + 1680 * 4);
    expect(mm.mbt(5760)).toMatchObject({measure: 4, beat: 1, tickInBeat: 0, ticksSinceMeasureStart: 0});
    expect(mm.mbt(7679)).toMatchObject({measure: 4, beat: 4, tickInBeat: 479, ticksSinceMeasureStart: 1919});
    expect(mm.mbt(7680)).toMatchObject({measure: 5, beat: 1, tickInBeat: 0, ticksSinceMeasureStart: 0});
    expect(mm.mbt(7680 + 240)).toMatchObject({measure: 5, beat: 2, tickInBeat: 0, ticksSinceMeasureStart: 240});
    expect(mm.mbt(7680 + 240 * 6)).toMatchObject({measure: 5, beat: 7, tickInBeat: 0, ticksSinceMeasureStart: 1440});
    expect(mm.mbt(7680 + 1680)).toMatchObject({measure: 6, beat: 1, tickInBeat: 0, ticksSinceMeasureStart: 0});
  });
});

// ---------------------------------------------------------------------------
// remove_notes
// ---------------------------------------------------------------------------

describe('removeNotes', () => {
  test('keeps on-grid, drops off-grid', () => {
    const mm = buildMeasures([], TPQN, 1920 * 4);
    const base = TIER_BASE['h'];
    const notes = [note(0, base), note(100, base), note(240, base)];
    const out = removeNotes(notes, [], mm, 'e', 'h', 20, false, false);
    expect(out.map(n => n.pos).sort((a, b) => a - b)).toEqual([0, 240]);
  });

  test('sparse keeps at least one per division', () => {
    const mm = buildMeasures([], TPQN, 1920 * 4);
    const base = TIER_BASE['h'];
    const notes = [note(2500, base)];
    const outSparse = removeNotes(notes, [], mm, 'w', 'h', 0, false, true);
    const outNoSparse = removeNotes(notes, [], mm, 'w', 'h', 0, false, false);
    expect(outSparse.length).toBe(1);
    expect(outNoSparse.length).toBe(0);
  });

  test('second pass uses absolute tick, not measure-relative', () => {
    const mm = buildMeasures([[0, 3, 4]], TPQN, 1440 * 4);
    const pitch = lanePitch('e', 'green');
    const notes = [note(2385, pitch), note(2410, pitch), note(2880, pitch)];
    const out = removeNotes(notes, [], mm, 'h', 'e', 20, false, true);
    expect(out.map(n => n.pos).sort((a, b) => a - b)).toEqual([2880]);
  });

  test('roll marker exempts covered notes', () => {
    const mm = buildMeasures([], TPQN, 1920 * 4);
    const base = TIER_BASE['h'];
    const roll = note(0, ROLL_MARKER, 100, 480); // covers [0, 480]
    const offGridInRoll = note(37, base);
    const out = removeNotes([roll, offGridInRoll], [], mm, 'e', 'h', 0, false, false);
    const tierPositions = out
      .filter(n => tierOf(n.pitch) === 'h')
      .map(n => n.pos)
      .sort((a, b) => a - b);
    expect(tierPositions).toEqual([37]);
  });
});

// ---------------------------------------------------------------------------
// tier cascade + mix-marker renumbering
// ---------------------------------------------------------------------------

describe('cascadeCopy', () => {
  test('shifts pitch and deletes existing tier', () => {
    const xBase = TIER_BASE['x'];
    const hBase = TIER_BASE['h'];
    const notes = [note(0, xBase + 1), note(480, hBase + 4)];
    const events = [
      {pos: 0, text: '[mix 3 drums0d]'},
      {pos: 480, text: '[mix 2 drums0]'},
    ];
    const {notes: newNotes, events: newEvents} = cascadeCopy(notes, events, 'x', 'h');
    const hardNotes = newNotes.filter(n => tierOf(n.pitch) === 'h');
    expect(hardNotes.length).toBe(1);
    expect(hardNotes[0].pitch).toBe(hBase + 1);
    expect(newNotes.some(n => tierOf(n.pitch) === 'h' && n.pitch === hBase + 4)).toBe(false);
    expect(newEvents.map(e => e.text).sort()).toEqual(['[mix 2 drums0d]', '[mix 3 drums0d]']);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: synthetic song -> reduce_5lane_drums (built directly, no MIDI)
// ---------------------------------------------------------------------------

describe('reduce5laneDrums end-to-end', () => {
  test('synthetic steady kick+snare song', () => {
    const xBase = TIER_BASE['x'];
    const notes: Note[] = [];
    for (let measure = 0; measure < 4; measure++) {
      for (let beat = 0; beat < 4; beat++) {
        const t = measure * 1920 + beat * 480;
        notes.push(note(t, xBase + 0)); // kick
        notes.push(note(t, xBase + 1)); // snare
      }
    }
    notes.sort((a, b) => a.pos - b.pos);
    const mm = buildMeasures([], TPQN, 1920 * 4);

    const expertBefore = notes.filter(n => tierOf(n.pitch) === 'x');
    expect(expertBefore.length).toBe(32);

    const {notes: out} = reduce5laneDrums(notes, [], mm);
    const expertAfter = out.filter(n => tierOf(n.pitch) === 'x');
    const hardAfter = out.filter(n => tierOf(n.pitch) === 'h');
    const mediumAfter = out.filter(n => tierOf(n.pitch) === 'm');
    const easyAfter = out.filter(n => tierOf(n.pitch) === 'e');

    // Expert survives unchanged.
    expect(
      expertAfter.map(n => [n.pos, n.pitch]).sort(),
    ).toEqual(expertBefore.map(n => [n.pos, n.pitch]).sort());
    // Hard: straight copy at 1/8 grid — same count.
    expect(hardAfter.length).toBe(32);
    // Medium: remove_kick('p') strips the kick from every kick+snare chord.
    expect(mediumAfter.some(n => n.pitch === lanePitch('m', 'kick'))).toBe(false);
    expect(mediumAfter.length).toBe(16);
    // Easy: 1/2-note grid thins the per-quarter snare to per-half-note.
    expect(easyAfter.length).toBe(8);
  });
});
