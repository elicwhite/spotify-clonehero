/**
 * End-to-end HOPCAT parity via the *raw-MIDI* input path
 * (`parseRawMidiForHopcat`), which reads each fixture's `notes.mid` bytes
 * directly — the same events `midi_io.py` feeds `reduce_5lane_drums` — with no
 * scan-chart resolution step in between.
 *
 * Because this path reproduces HOPCAT's raw-MIDI input model exactly (real
 * 110-112 tom-marker ticks, real `[mix N drums*]` disco-marker ticks), the two
 * lossy reconstructions the scan-chart-derived adapter cannot avoid
 * (`parity.test.ts`'s ADAPTER_LIMITED set) disappear: every fixture is asserted
 * tick-exact on Hard, Medium AND Easy, matching the 20/20 raw-Python-dump proof
 * but now through a TS parser we own end to end.
 */

import {describe, test, expect} from '@jest/globals';
import {readFileSync, existsSync} from 'fs';
import path from 'path';

import {parseRawMidiForHopcat} from '../../adapter/hopcatRawMidi';
import {reduce5laneDrums} from '../reduce';
import {tierOf, laneOf, type Note} from '../reduceNotes';

const FIXTURES_DIR = path.join(__dirname, '..', '..', '__fixtures__');

type Tier = 'hard' | 'medium' | 'easy';
const TIER_TAG: Record<Tier, string> = {hard: 'h', medium: 'm', easy: 'e'};

interface Row {
  tick: number;
  pitch: number;
  lane: string;
}

function sortRows(rows: Row[]): Row[] {
  return [...rows].sort(
    (a, b) => a.tick - b.tick || a.pitch - b.pitch || a.lane.localeCompare(b.lane),
  );
}

function actualRows(notes: Note[], tier: Tier): Row[] {
  const tag = TIER_TAG[tier];
  return sortRows(
    notes
      .filter(n => tierOf(n.pitch) === tag)
      .map(n => ({tick: n.pos, pitch: n.pitch, lane: laneOf(n.pitch)})),
  );
}

const FIXTURE_IDS = Array.from({length: 20}, (_, i) =>
  `reduction-${String(i + 1).padStart(2, '0')}`,
).filter(id => existsSync(path.join(FIXTURES_DIR, id, 'expected-hopcat.json')));

describe('HOPCAT end-to-end parity (raw-MIDI path)', () => {
  test.each(FIXTURE_IDS)('%s — Hard/Medium/Easy tick-exact', id => {
    const dir = path.join(FIXTURES_DIR, id);
    const bytes = new Uint8Array(readFileSync(path.join(dir, 'notes.mid')));
    const input = parseRawMidiForHopcat(bytes);
    const {notes} = reduce5laneDrums(input.notes, input.events, input.measureMap);

    const expected = JSON.parse(
      readFileSync(path.join(dir, 'expected-hopcat.json'), 'utf8'),
    ) as Record<Tier, Row[]>;

    for (const tier of ['hard', 'medium', 'easy'] as const) {
      expect({tier, rows: actualRows(notes, tier)}).toEqual({
        tier,
        rows: sortRows(expected[tier]),
      });
    }
  });
});
