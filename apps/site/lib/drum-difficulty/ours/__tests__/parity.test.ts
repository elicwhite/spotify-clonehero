/**
 * End-to-end "Ours" v5 ("591ab4a" packed) parity, through the REAL production
 * path (plan §5): for each anonymized fixture, `readChart` its `notes.mid` ->
 * `parsedChartToRawDrums` -> `buildOursInput` -> `reduceOurs` (against the
 * shipped v5 packed-binary model set loaded from
 * `public/models/drum-difficulty/v5/`), then compare against the Python
 * `export_model_591ab4a`/`consistency_metric` pipeline's `expected-ours.json`
 * (generated from the pre-packing v4 JSON model — v5 is a verified-lossless
 * re-encoding of the SAME trees, see `model.ts`'s doc comment, so the same
 * fixture is valid ground truth for the packed TS port too).
 *
 * Per the fixture `_meta`, assertion is on `(tick, lane)` (originalLane/family/
 * relaned are diagnostic). The comparison is a multiset over `(tick, lane)`
 * tuples, both sides canonically sorted — note-for-note tick-exact, order
 * independent.
 */

import {readFileSync} from 'fs';
import {join} from 'path';
import type {File as ChartFile} from '@eliwhite/scan-chart';
import {readChart} from '@/lib/chart-edit';
import {parsedChartToRawDrums} from '../../adapter';
import {buildOursInput} from '../featurize';
import {reduceOurs} from '../reduce';
import {parseSurviveBin, parseRelaneBin} from '../model';
import type {OursModels, RelaneModel, SurviveModel, Tier} from '../model';

const FIXTURES_DIR = join(__dirname, '..', '..', '__fixtures__');
const MODELS_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'public',
  'models',
  'drum-difficulty',
  'v5',
);
const IDS = Array.from(
  {length: 20},
  (_, i) => `reduction-${String(i + 1).padStart(2, '0')}`,
);
const TIERS: Tier[] = ['hard', 'medium', 'easy'];

interface ManifestJson {
  family_nms_gaps_ms: Record<Tier, number | null>;
  survive_threshold: number;
  families: {cymbal: string[]; tom: string[]};
}

/** Load the shipped v5 packed-binary model set from disk (the browser
 * fetches these as raw bytes; here we read the same files off the
 * filesystem and parse them with the same `model.ts` binary parser). */
function loadModels(): OursModels {
  const manifest = JSON.parse(
    readFileSync(join(MODELS_DIR, 'manifest.json'), 'utf8'),
  ) as ManifestJson;
  const readBin = (name: string): ArrayBuffer => {
    const buf = readFileSync(join(MODELS_DIR, name));
    // Copy into a fresh ArrayBuffer: Buffer.buffer is ArrayBufferLike (may be
    // a SharedArrayBuffer), not assignable to model.ts's ArrayBuffer param.
    const out = new ArrayBuffer(buf.byteLength);
    new Uint8Array(out).set(buf);
    return out;
  };
  const survive = {} as Record<Tier, SurviveModel>;
  const relane = {} as Record<Tier, {cymbal: RelaneModel; tom: RelaneModel}>;
  for (const tier of TIERS) {
    const s = parseSurviveBin(readBin(`survive_${tier}.bin`));
    s.threshold = manifest.survive_threshold;
    survive[tier] = s;
    relane[tier] = {
      cymbal: parseRelaneBin(
        readBin(`relane_cymbal_${tier}.bin`),
        manifest.families.cymbal,
      ),
      tom: parseRelaneBin(
        readBin(`relane_tom_${tier}.bin`),
        manifest.families.tom,
      ),
    };
  }
  return {survive, relane, familyNmsGapsMs: manifest.family_nms_gaps_ms};
}

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
}

const canon = (n: {tick: number; lane: string}) => `${n.tick}|${n.lane}`;
const sortCanon = (ns: {tick: number; lane: string}[]) => ns.map(canon).sort();

describe('Ours v5 TS port — end-to-end parity vs Python', () => {
  const models = loadModels();

  for (const id of IDS) {
    test(id, () => {
      const doc = readChart(loadFixtureFiles(id), {pro_drums: true});
      const adapted = parsedChartToRawDrums(doc.parsedChart);
      expect(adapted.ok).toBe(true);
      if (!adapted.ok) return;

      const input = buildOursInput(adapted.chart, doc.parsedChart);
      const tiers = reduceOurs(input, models);

      const expected: Record<Tier, ExpectedNote[]> = JSON.parse(
        readFileSync(join(FIXTURES_DIR, id, 'expected-ours.json'), 'utf8'),
      );

      for (const tier of TIERS) {
        expect(sortCanon(tiers[tier])).toEqual(sortCanon(expected[tier]));
      }
    });
  }
});
