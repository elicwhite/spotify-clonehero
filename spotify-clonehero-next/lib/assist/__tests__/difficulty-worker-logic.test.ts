/**
 * Worker-logic sanity check for the drums path `difficulty-worker.ts` calls
 * (`reduceOurs` against the shipped v5 model set). Runs the exact function
 * the worker invokes directly in node (no Worker, no postMessage) against a
 * real anonymized fixture, mirroring
 * `lib/drum-difficulty/ours/__tests__/parity.test.ts`'s model-loading
 * pattern. Full tick-exact parity against the Python port is that suite's
 * job (20 fixtures, already green); this test only guards the shape the
 * worker's message protocol promises: three tiers, non-empty for a
 * non-trivial input, monotonically non-increasing note counts
 * Hard->Medium->Easy (Ours only ever drops or relanes notes, never adds).
 *
 * The guitar path (`reduceGuitarDifficulties`) fetches its ONNX models from a
 * remote host (`assets.musiccharts.tools`) at call time — there is no local
 * model path to read from disk in node the way the drums models can be (see
 * `model.ts`'s `MODEL_BASE`), so a from-disk equivalent isn't feasible here
 * without a real network fetch. That path's feature/decode logic is covered
 * by `lib/guitar-difficulty/__tests__`; its wire shape through the client is
 * covered in `difficulty-client.test.ts`, and the conversion of its tiers
 * (notes plus star power / solo / flex-lane ranges) into the command's tier
 * payload in `difficulty-task.test.ts`.
 */

import {readFileSync} from 'fs';
import {join} from 'path';
import type {File as ChartFile} from '@eliwhite/scan-chart';
import {readChart} from '@/lib/chart-edit';
import {parsedChartToRawDrums} from '@/lib/drum-difficulty/adapter';
import {buildOursInput} from '@/lib/drum-difficulty/ours/featurize';
import {reduceOurs} from '@/lib/drum-difficulty/ours/reduce';
import {
  parseSurviveBin,
  parseRelaneBin,
  type OursModels,
  type RelaneModel,
  type SurviveModel,
  type Tier,
} from '@/lib/drum-difficulty/ours/model';

const FIXTURES_DIR = join(
  __dirname,
  '..',
  '..',
  'drum-difficulty',
  '__fixtures__',
);
const MODELS_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  'public',
  'models',
  'drum-difficulty',
  'v5',
);
const TIERS: Tier[] = ['hard', 'medium', 'easy'];

interface ManifestJson {
  family_nms_gaps_ms: Record<Tier, number | null>;
  survive_threshold: number;
  families: {cymbal: string[]; tom: string[]};
}

/** Same fs-based loader as `parity.test.ts`: reads the shipped v5
 * packed-binary model set off disk (the browser fetches these bytes; here
 * we read the same files and parse them with the same binary parser). */
function loadModels(): OursModels {
  const manifest = JSON.parse(
    readFileSync(join(MODELS_DIR, 'manifest.json'), 'utf8'),
  ) as ManifestJson;
  const readBin = (name: string): ArrayBuffer => {
    const buf = readFileSync(join(MODELS_DIR, name));
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
  ];
}

describe('difficulty-worker drums path (reduceOurs, run directly in node)', () => {
  const models = loadModels();

  it.each(['reduction-01', 'reduction-05', 'reduction-12'])(
    '%s: three non-empty tiers, monotonically non-increasing note counts',
    id => {
      const doc = readChart(loadFixtureFiles(id), {pro_drums: true});
      const adapted = parsedChartToRawDrums(doc.parsedChart);
      if (!adapted.ok)
        throw new Error(`${id}: adapter rejected: ${adapted.reason}`);

      const input = buildOursInput(adapted.chart, doc.parsedChart);
      const tiers = reduceOurs(input, models);

      expect(input.notes.length).toBeGreaterThan(0);
      expect(tiers.hard.length).toBeGreaterThan(0);
      expect(tiers.medium.length).toBeGreaterThan(0);
      expect(tiers.easy.length).toBeGreaterThan(0);

      // Ours only ever drops (survive threshold) or relanes (family heads)
      // an Expert note — it never invents one, so each tier's kept-note
      // count is bounded by the Expert note count and non-increasing down
      // the Hard->Medium->Easy ladder.
      expect(tiers.hard.length).toBeLessThanOrEqual(input.notes.length);
      expect(tiers.medium.length).toBeLessThanOrEqual(tiers.hard.length);
      expect(tiers.easy.length).toBeLessThanOrEqual(tiers.medium.length);
    },
  );
});
