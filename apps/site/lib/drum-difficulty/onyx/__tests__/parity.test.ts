/**
 * End-to-end Onyx parity, through the REAL production path (plan §5): for each
 * anonymized fixture, `readChart` its `notes.mid` -> `parsedChartToRawDrums()`
 * -> `toOnyxInput()` -> `reduceOnyx()`, then compare against the Python Onyx
 * port's `expected-onyx.json` at **exact tick equality, no tolerance**.
 *
 * The comparison is a multiset over `(tick, lane, kind, color, protype)`
 * tuples (both sides canonically sorted), which is note-for-note tick-exact —
 * it does not depend on the within-tick ordering of coincident gems or on
 * `ensureODNotes`' append position, neither of which is semantically
 * meaningful (Onyx's own AMBIGUITY #3). A single differing tick or lane fails.
 */

import {readFileSync} from 'fs';
import {join} from 'path';
import type {File as ChartFile} from '@eliwhite/scan-chart';
import {readChart} from '@/lib/chart-edit';
import {parsedChartToRawDrums, toOnyxInput} from '../../adapter';
import {reduceOnyx, type OnyxOutNote} from '../reduce';

const FIXTURES_DIR = join(__dirname, '..', '..', '__fixtures__');
const IDS = Array.from(
  {length: 20},
  (_, i) => `reduction-${String(i + 1).padStart(2, '0')}`,
);

function loadFixtureFiles(id: string): ChartFile[] {
  const dir = join(FIXTURES_DIR, id);
  return [
    {
      fileName: 'notes.mid',
      data: new Uint8Array(readFileSync(join(dir, 'notes.mid'))),
    },
    {
      fileName: 'song.ini',
      data: new Uint8Array(readFileSync(join(dir, 'song.ini'))),
    },
  ];
}

interface ExpectedNote {
  tick: number;
  lane: string;
  kind: string;
  color: string;
  protype: string;
}

const canon = (n: ExpectedNote | OnyxOutNote) =>
  `${n.tick}|${n.lane}|${n.kind}|${n.color}|${n.protype}`;

const sortCanon = (ns: (ExpectedNote | OnyxOutNote)[]) => ns.map(canon).sort();

describe('Onyx TS port — end-to-end parity vs Python', () => {
  for (const id of IDS) {
    test(id, () => {
      const doc = readChart(loadFixtureFiles(id), {pro_drums: true});
      const adapted = parsedChartToRawDrums(doc.parsedChart);
      expect(adapted.ok).toBe(true);
      if (!adapted.ok) return;

      const tiers = reduceOnyx(toOnyxInput(adapted.chart));

      const expected: {
        hard: ExpectedNote[];
        medium: ExpectedNote[];
        easy: ExpectedNote[];
      } = JSON.parse(
        readFileSync(join(FIXTURES_DIR, id, 'expected-onyx.json'), 'utf8'),
      );

      expect(sortCanon(tiers.hard)).toEqual(sortCanon(expected.hard));
      expect(sortCanon(tiers.medium)).toEqual(sortCanon(expected.medium));
      expect(sortCanon(tiers.easy)).toEqual(sortCanon(expected.easy));
    });
  }
});
