'use client';

/**
 * Dev-only page: measures the webgpu-vs-wasm numerical residual for the
 * shipped CRNN inference path (PARITY.md stage-2 gate term (b), the
 * ONE-TIME device-side measurement — term (a) is `pnpm test:onnx-parity`,
 * which only exercises wasm since webgpu can't run under jest's node VM).
 *
 * Runs the shipped t4 model, via the same CDN ORT build the app loads
 * (onnxruntime-web@1.24.3), over the SAME mel/context inputs used by that
 * jest gate (lib/drum-transcription/__tests__/fixtures/crnn-logits-reference-t4.json,
 * served dev-only by app/api/dev/crnn-fixture) — once with
 * executionProviders ['webgpu', 'wasm'] (the shipped preference: ORT picks
 * webgpu if the device supports it) and once forced ['wasm'] — then reports
 * the max abs diff between the two runs' logits/activations.
 *
 * Usage: `pnpm dev`, open this page, click the button, copy the two numbers
 * into PARITY.md's `webgpu_band` block (residual_max / reference_environment
 * / measured_date / measured: true). Re-run whenever the model checkpoint,
 * ORT version, or inference code changes (see `manual_retrigger_on` in that
 * block).
 */

import {useState} from 'react';
import Script from 'next/script';

const ORT_CDN_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';
const ORT_CDN_URL = `${ORT_CDN_BASE}ort.min.js`;
const MODEL_URL = '/models/crnn_stereo_256mel_t4.onnx';
const FIXTURE_URL = '/api/dev/crnn-fixture';

const WINDOW_SIZE = 500;
const WINDOW_STRIDE = 375;
const NUM_CLASSES = 9;
const SONG_CONTEXT_DIM = 5120;

interface CrnnFixture {
  T: number;
  nMels: number;
  model: string;
  melStereoB64: string;
  contextB64: string;
}

function decodeF32(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
  }
  return max;
}

/** Mirrors crnn-worker.ts's windowedInference exactly (same windowing,
 * padding, and overlap-average), so this is a faithful stand-in for the
 * shipped inference path — the only thing varied is executionProviders. */
async function runInference(
  ort: any,
  executionProviders: string[],
  melStereo: Float32Array,
  context: Float32Array,
  T: number,
  nMels: number,
): Promise<{window0: Float32Array; avg: Float32Array}> {
  const session = await ort.InferenceSession.create(MODEL_URL, {
    executionProviders,
    graphOptimizationLevel: 'all',
  });

  const accum = new Float64Array(T * NUM_CLASSES);
  const counts = new Float64Array(T);
  const ctxTensor = new ort.Tensor('float32', context, [1, SONG_CONTEXT_DIM]);
  let window0: Float32Array | null = null;

  for (let start = 0; start < T; start += WINDOW_STRIDE) {
    const end = Math.min(start + WINDOW_SIZE, T);
    const W = end - start;
    const padW = WINDOW_SIZE;

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

    const melTensor = new ort.Tensor('float32', melWindow, [1, 2, nMels, padW]);
    const results = await session.run({mel: melTensor, context: ctxTensor});
    const outputTensor = results.logits ?? results[Object.keys(results)[0]];
    const logits = outputTensor.data as Float32Array;

    if (start === 0) window0 = logits.slice(0, WINDOW_SIZE * NUM_CLASSES);

    for (let f = 0; f < W; f++) {
      for (let c = 0; c < NUM_CLASSES; c++) {
        accum[(start + f) * NUM_CLASSES + c] += sigmoid(logits[f * NUM_CLASSES + c]);
      }
      counts[start + f] += 1;
    }
  }

  await session.release();

  const avg = new Float32Array(T * NUM_CLASSES);
  for (let f = 0; f < T; f++) {
    const c = Math.max(counts[f], 1);
    for (let cls = 0; cls < NUM_CLASSES; cls++) {
      avg[f * NUM_CLASSES + cls] = accum[f * NUM_CLASSES + cls] / c;
    }
  }

  return {window0: window0!, avg};
}

export default function WebgpuResidualCheckPage() {
  const [ortReady, setOrtReady] = useState(false);
  const [status, setStatus] = useState('Waiting for ONNX Runtime to load...');
  const [result, setResult] = useState<{w0: number; avg: number} | null>(null);

  async function runCheck() {
    setResult(null);
    try {
      setStatus('Fetching fixture...');
      const res = await fetch(FIXTURE_URL);
      if (!res.ok) {
        setStatus(`Fixture fetch failed (${res.status}): ${await res.text()}`);
        return;
      }
      const fixture: CrnnFixture = await res.json();
      const melStereo = decodeF32(fixture.melStereoB64);
      const context = decodeF32(fixture.contextB64);

      const ort = (window as any).ort;
      if (!ort) {
        setStatus('ort global not found — CDN script has not finished loading.');
        return;
      }
      ort.env.wasm.wasmPaths = ORT_CDN_BASE;
      ort.env.logLevel = 'error';

      setStatus(
        "Running with executionProviders ['webgpu','wasm'] (shipped preference)...",
      );
      const gpuOut = await runInference(
        ort,
        ['webgpu', 'wasm'],
        melStereo,
        context,
        fixture.T,
        fixture.nMels,
      );

      setStatus("Running with executionProviders ['wasm'] (reference)...");
      const wasmOut = await runInference(
        ort,
        ['wasm'],
        melStereo,
        context,
        fixture.T,
        fixture.nMels,
      );

      setResult({
        w0: maxAbsDiff(gpuOut.window0, wasmOut.window0),
        avg: maxAbsDiff(gpuOut.avg, wasmOut.avg),
      });
      setStatus('Done.');
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div style={{padding: 24, fontFamily: 'monospace', maxWidth: 760, lineHeight: 1.5}}>
      <Script
        src={ORT_CDN_URL}
        strategy="afterInteractive"
        onReady={() => setOrtReady(true)}
      />
      <h1>CRNN webgpu-vs-wasm residual check</h1>
      <p>
        Dev-only. PARITY.md stage-2 gate, term (b) — the one-time device-side
        measurement. Runs the shipped t4 model over the committed jest
        parity fixture, once preferring webgpu (the shipped path) and once
        forced to wasm, and reports the max abs diff between the two runs on
        <em> this </em> browser/GPU/driver. Record the results (plus browser +
        GPU + OS) into PARITY.md&apos;s <code>webgpu_band</code> block.
      </p>
      <button onClick={runCheck} disabled={!ortReady}>
        Run residual check
      </button>
      <p>{status}</p>
      {result && (
        <ul>
          <li>window-0 raw logits max abs diff: {result.w0}</li>
          <li>overlap-averaged sigmoid activations max abs diff: {result.avg}</li>
        </ul>
      )}
    </div>
  );
}
