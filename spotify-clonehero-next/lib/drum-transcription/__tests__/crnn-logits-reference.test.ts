/**
 * @jest-environment node
 *
 * CRNN *inference* web-vs-python parity — the stage the other reference tests
 * do NOT cover. mel-reference.test.ts diffs the mel port; postprocess-
 * reference.test.ts feeds python's raw activations into the JS post-block. But
 * neither ran the CRNN model in onnxruntime-web and diffed it against python
 * onnxruntime. This test does: it loads the SAME t4/diagJ .onnx the app
 * ships (public/models/crnn_stereo_256mel_t4.onnx) via onnxruntime-web, runs
 * the identical windowing crnn-worker.ts runs (WINDOW_SIZE=500,
 * WINDOW_STRIDE=375, zero-pad final window, sigmoid + overlap-average) over
 * the python-computed fixture mel, and diffs against the python-onnxruntime
 * reference produced by drum-to-chart/scripts/dump_crnn_logits_reference.py.
 *
 * Feeding the shared python mel to both sides isolates the model (mel parity is
 * covered by mel-reference.test.ts).
 *
 * The 90 MB t4 .onnx is gitignored (never committed); this is the ONE
 * checkpoint-specific parity gate, so a missing model FAILS LOUDLY here
 * (F36, PIPELINE_AUDIT.md — a silent skip let `pnpm test:onnx-parity` go
 * green without ever touching the shipped model). Set ALLOW_MISSING_MODEL=1
 * to explicitly skip with a loud warning (e.g. a CI lane that intentionally
 * doesn't have the model). Regenerate the fixture after any model change:
 *   drum-to-chart/.venv/bin/python3 scripts/dump_crnn_logits_reference.py \
 *     --onnx scripts/crnn_stereo_256mel_t4.onnx \
 *     --model-name crnn_stereo_256mel_t4.onnx \
 *     --out scripts/frontend_ref_fixtures/crnn-logits-reference-t4.json
 * then copy scripts/frontend_ref_fixtures/crnn-logits-reference-t4.json here.
 *
 * The onnxruntime-web wasm backend needs Node's --experimental-vm-modules to
 * load under jest's VM sandbox, so this suite only runs its assertions when
 * RUN_ONNX_PARITY=1 (set by the `test:onnx-parity` npm script, which also sets
 * the flag). A bare `jest` run SKIPS it, keeping the default suite green.
 *   pnpm test:onnx-parity
 */

import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ort = require('onnxruntime-web');

import {
  NUM_DRUM_CLASSES,
  SONG_CONTEXT_DIM,
  WINDOW_SIZE,
  WINDOW_STRIDE,
} from '../ml/types';

const FIXTURE_PATH = path.join(
  __dirname,
  'fixtures',
  'crnn-logits-reference-t4.json',
);
const MODEL_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'public',
  'models',
  'crnn_stereo_256mel_t4.onnx',
);

interface CrnnFixture {
  T: number;
  nMels: number;
  nInst: number;
  windowSize: number;
  windowStride: number;
  model: string;
  melStereoB64: string; // [ch*256*T + m*T + t]
  contextB64: string; // (5120,)
  window0LogitsB64: string; // [f*9 + c] raw logits, first window
  avgActB64: string; // [t*9 + c] sigmoid, overlap-averaged
}

function decodeF32(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

const haveModel = fs.existsSync(MODEL_PATH);
const enabled = process.env['RUN_ONNX_PARITY'] === '1';
const allowMissingModel = process.env['ALLOW_MISSING_MODEL'] === '1';

if (!enabled) {
  // eslint-disable-next-line no-console
  console.warn(
    '[crnn-logits-reference] SKIPPED — set RUN_ONNX_PARITY=1 (via ' +
      '`pnpm test:onnx-parity`) to run the onnxruntime-web parity gate.',
  );
} else if (!haveModel && allowMissingModel) {
  // eslint-disable-next-line no-console
  console.warn(
    `[crnn-logits-reference] SKIPPED (ALLOW_MISSING_MODEL=1) — model not ` +
      `found at ${MODEL_PATH}. This means the checkpoint-specific parity ` +
      'gate did NOT run; do not treat a green test:onnx-parity as having ' +
      'validated the shipped model (F36, PIPELINE_AUDIT.md).',
  );
}

// F36 (PIPELINE_AUDIT.md): when the gate is enabled, a missing model is a
// FAILURE, not a silent skip — `pnpm test:onnx-parity` must not go green
// without ever touching the shipped model. ALLOW_MISSING_MODEL=1 is the
// explicit, loud escape hatch for environments that intentionally lack it.
const failLoud = enabled && !haveModel && !allowMissingModel;
const shouldRun = enabled && haveModel;
const describeIf = shouldRun || failLoud ? describe : describe.skip;

describeIf(
  'CRNN inference: onnxruntime-web(t4) vs python onnxruntime(t4)',
  () => {
    if (failLoud) {
      it('FAILS LOUDLY: model missing and RUN_ONNX_PARITY=1 (F36)', () => {
        throw new Error(
          `[crnn-logits-reference] Model not found at ${MODEL_PATH} while ` +
            'RUN_ONNX_PARITY=1. This is the ONE checkpoint-specific parity ' +
            'gate (F36, PIPELINE_AUDIT.md) — it must fail loudly rather ' +
            'than silently skip. Place the t4 .onnx there, or set ' +
            'ALLOW_MISSING_MODEL=1 to explicitly skip with a warning.',
        );
      });
      return;
    }
    const fixture: CrnnFixture = JSON.parse(
      fs.readFileSync(FIXTURE_PATH, 'utf8'),
    );
    const T = fixture.T;
    const nMels = fixture.nMels;
    const melStereo = decodeF32(fixture.melStereoB64);
    const context = decodeF32(fixture.contextB64);
    const refW0 = decodeF32(fixture.window0LogitsB64); // [f*9+c]
    const refAvg = decodeF32(fixture.avgActB64); // [t*9+c]

    let session: any;
    let webW0: Float32Array | null = null; // first-window raw logits [f*9+c]
    let webAvg: Float32Array | null = null; // averaged sigmoid [t*9+c]

    beforeAll(async () => {
      ort.env.wasm.numThreads = 1;
      ort.env.logLevel = 'error';
      session = await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });

      const nClasses = NUM_DRUM_CLASSES;
      const accum = new Float64Array(T * nClasses);
      const counts = new Float64Array(T);
      const ctxTensor = new ort.Tensor('float32', context, [
        1,
        SONG_CONTEXT_DIM,
      ]);

      for (let start = 0; start < T; start += WINDOW_STRIDE) {
        const end = Math.min(start + WINDOW_SIZE, T);
        const W = end - start;
        const padW = WINDOW_SIZE;

        // Mel window (1,2,nMels,padW), layout [ch*nMels*padW + m*padW + f].
        // Mirrors crnn-worker.ts exactly.
        const melWindow = new Float32Array(2 * nMels * padW);
        for (let ch = 0; ch < 2; ch++) {
          for (let m = 0; m < nMels; m++) {
            const srcBase = (ch * nMels + m) * T + start;
            const dstBase = (ch * nMels + m) * padW;
            for (let f = 0; f < W; f++) {
              melWindow[dstBase + f] = melStereo[srcBase + f];
            }
          }
        }
        const melTensor = new ort.Tensor('float32', melWindow, [
          1,
          2,
          nMels,
          padW,
        ]);
        const results = await session.run({mel: melTensor, context: ctxTensor});
        const logits = (results.logits ?? results[Object.keys(results)[0]])
          .data as Float32Array;

        if (start === 0) webW0 = logits.slice(0, WINDOW_SIZE * nClasses);

        for (let f = 0; f < W; f++) {
          for (let c = 0; c < nClasses; c++) {
            accum[(start + f) * nClasses + c] += sigmoid(
              logits[f * nClasses + c],
            );
          }
          counts[start + f] += 1;
        }
      }

      webAvg = new Float32Array(T * nClasses);
      for (let f = 0; f < T; f++) {
        const c = Math.max(counts[f], 1);
        for (let cls = 0; cls < nClasses; cls++) {
          webAvg[f * nClasses + cls] = accum[f * nClasses + cls] / c;
        }
      }
    }, 120000);

    it('fixture matches this model + window config', () => {
      expect(fixture.model).toBe('crnn_stereo_256mel_t4.onnx');
      expect(fixture.nInst).toBe(NUM_DRUM_CLASSES);
      expect(fixture.windowSize).toBe(WINDOW_SIZE);
      expect(fixture.windowStride).toBe(WINDOW_STRIDE);
      expect(melStereo.length).toBe(2 * nMels * T);
      expect(context.length).toBe(SONG_CONTEXT_DIM);
    });

    it('window-0 raw logits match python within 1e-3', () => {
      expect(webW0).not.toBeNull();
      let maxDiff = 0;
      let at = '';
      for (let i = 0; i < refW0.length; i++) {
        const d = Math.abs(webW0![i] - refW0[i]);
        if (d > maxDiff) {
          maxDiff = d;
          at = `i=${i} (f=${Math.floor(i / 9)} c=${i % 9})`;
        }
      }
      // eslint-disable-next-line no-console
      console.log(`crnn window-0 logits max abs diff = ${maxDiff} at ${at}`);
      expect(maxDiff).toBeLessThan(1e-3);
    });

    it('overlap-averaged sigmoid activations match python within 1e-3', () => {
      expect(webAvg).not.toBeNull();
      let maxDiff = 0;
      let at = '';
      for (let i = 0; i < refAvg.length; i++) {
        const d = Math.abs(webAvg![i] - refAvg[i]);
        if (d > maxDiff) {
          maxDiff = d;
          at = `i=${i} (t=${Math.floor(i / 9)} c=${i % 9})`;
        }
      }
      // eslint-disable-next-line no-console
      console.log(`crnn averaged-acts max abs diff = ${maxDiff} at ${at}`);
      expect(maxDiff).toBeLessThan(1e-3);
    });

    afterAll(async () => {
      if (session) await session.release();
    });
  },
);
