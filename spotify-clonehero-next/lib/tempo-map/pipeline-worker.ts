/**
 * Web worker running the full tempo-mapping pipeline:
 *
 *   stereo PCM (any rate)
 *     ├─ S1  bs-roformer fp16 (WebGPU) → drum stem 44.1k mono
 *     │       ├─ S3  Beat This! (WASM fp32) on drum stem
 *     │       └─ S2b spectral-flux drum-onset offset
 *     ├─ S2  Beat This! (WASM fp32) on full mix
 *     └─ S4  beatsToSynctrack
 *
 * Fidelity decisions inherited from the proven POC:
 *   - libsoxr WASM for all resampling (Web Audio's resampler is too lossy).
 *   - Beat This! runs on the wasm EP — the WebGPU EP silently computes this
 *     transformer in fp16 and drifts logits ~1 unit vs Python.
 *   - bs-roformer stays on WebGPU (fp16 stem drift is accepted).
 */

import * as ort from 'onnxruntime-web';
import {getCachedModel} from '@/lib/lyrics-align/model-cache';
import {resampleSoxr, initSoxr} from './resampler-soxr';
import {separateDrumStem} from './stem-separation';
import {
  computeLogMel,
  resampleToBeatThis,
  BEAT_THIS_SAMPLE_RATE,
} from './beat-this-mel';
import {runBeatThisOnnx} from './beat-this-onnx';
import {runPostprocessor} from './beat-this-pp';
import {computeDrumOnsetOffsetMs} from './drum-onset';
import {beatsToSynctrack, PL_LSQ_TOL_MS_DEFAULT} from './converter';
import type {
  PipelineProgress,
  PipelineRunRequest,
  PipelineWorkerMessage,
} from './types';

const ORT_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

const ROFORMER_MODEL_URL =
  'https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx/resolve/main/bs_roformer_sw_6stem_fp16.onnx';
const ROFORMER_CACHE_KEY = 'bs_roformer_sw_6stem_fp16.onnx';
const ROFORMER_MIN_BYTES = 300_000_000; // real size ~336 MB

const BEAT_THIS_MODEL_URL = '/models/beat_this.onnx';
const BEAT_THIS_CACHE_KEY = 'beat_this_v1.onnx';
const BEAT_THIS_MIN_BYTES = 70_000_000; // real size ~83 MB

const SEPARATION_SAMPLE_RATE = 44100;

// Bump when the separation pipeline changes in ways that affect output
// (model swap, overlap, mixing, channel reduction).
const STEM_CACHE_VERSION = 'v1_drums_mono_44k1_overlap0.25_fp16_libsoxr';
const STEM_CACHE_DIR = 'tempo-map-stem-cache';

function post(msg: PipelineWorkerMessage, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, {transfer: transfer ?? []});
}

function progress(p: PipelineProgress) {
  post({type: 'progress', ...p});
}

/** Parse "Downloading <label> 123/336 MB (37%)" log lines from
 * getCachedModel into structured progress. */
function downloadProgressAdapter(stage: PipelineProgress['stage']) {
  return (msg: string) => {
    const m = msg.match(/(\d+)\/(\d+) MB \((\d+)%\)/);
    if (m) {
      progress({
        stage,
        percent: parseInt(m[3], 10) / 100,
        detail: `${m[1]} / ${m[2]} MB`,
      });
    } else {
      progress({stage, detail: msg});
    }
  };
}

// --- OPFS drum-stem cache ------------------------------------------------

async function getStemCacheDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(STEM_CACHE_DIR, {create: true});
}

function stemCacheKey(sourceHash: string, sampleCount: number) {
  return `${sourceHash.slice(0, 32)}__${STEM_CACHE_VERSION}__N${sampleCount}.f32`;
}

async function loadStemFromCache(key: string): Promise<Float32Array | null> {
  try {
    const dir = await getStemCacheDir();
    const fh = await dir.getFileHandle(key);
    const file = await fh.getFile();
    return new Float32Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

async function saveStemToCache(key: string, pcm: Float32Array) {
  try {
    const dir = await getStemCacheDir();
    const fh = await dir.getFileHandle(key, {create: true});
    const w = await fh.createWritable();
    await w.write(pcm as Float32Array<ArrayBuffer>);
    await w.close();
  } catch {
    // Cache write failures are non-fatal.
  }
}

// --- pipeline ------------------------------------------------------------

async function run(req: PipelineRunRequest) {
  ort.env.wasm.wasmPaths = ORT_WASM_CDN;
  // Multi-threading would require nested pthread workers, which fails inside
  // a bundled web worker; same constraint as the Demucs worker.
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = 'error';

  void initSoxr();

  // ---- resample input to 44.1k for the separator ----
  let left = req.left;
  let right = req.right;
  if (req.sampleRate !== SEPARATION_SAMPLE_RATE) {
    [left, right] = await Promise.all([
      resampleSoxr(left, req.sampleRate, SEPARATION_SAMPLE_RATE),
      resampleSoxr(right, req.sampleRate, SEPARATION_SAMPLE_RATE),
    ]);
  }
  const N = left.length;

  // ---- S1: drum stem (OPFS-cached per source hash) ----
  let drumStem: Float32Array | null = null;
  const cacheKey = req.sourceHash ? stemCacheKey(req.sourceHash, N) : null;
  if (cacheKey) {
    const cached = await loadStemFromCache(cacheKey);
    if (cached && cached.length === N) {
      drumStem = cached;
      progress({
        stage: 'separate',
        percent: 1,
        detail: 'Reused drums from a previous run',
      });
    }
  }

  if (!drumStem) {
    progress({stage: 'download-separation-model'});
    const roformerBytes = await getCachedModel(
      ROFORMER_MODEL_URL,
      ROFORMER_CACHE_KEY,
      downloadProgressAdapter('download-separation-model'),
      ROFORMER_MIN_BYTES,
      'drum separator',
    );
    progress({stage: 'download-separation-model', percent: 1});

    const roformerSession = await ort.InferenceSession.create(
      new Uint8Array(roformerBytes),
      {
        executionProviders: ['webgpu', 'wasm'],
        graphOptimizationLevel: 'disabled',
      },
    );

    progress({stage: 'separate', percent: 0});
    drumStem = await separateDrumStem({
      ort,
      left,
      right,
      session: roformerSession,
      onProgress: ({segment, totalSegments, etaSec}) => {
        progress({
          stage: 'separate',
          percent: segment / totalSegments,
          etaSeconds: etaSec,
        });
      },
    });
    await roformerSession.release();
    if (cacheKey) await saveStemToCache(cacheKey, drumStem);
  }

  // ---- Beat This! model ----
  progress({stage: 'download-beat-model'});
  const beatThisBytes = await getCachedModel(
    BEAT_THIS_MODEL_URL,
    BEAT_THIS_CACHE_KEY,
    downloadProgressAdapter('download-beat-model'),
    BEAT_THIS_MIN_BYTES,
    'beat tracker',
  );
  progress({stage: 'download-beat-model', percent: 1});
  const beatThisSession = await ort.InferenceSession.create(
    new Uint8Array(beatThisBytes),
    {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    },
  );

  // One session, two sequential calls: full mix, then drum stem.
  const runBeatThisOn = async (
    monoPcm: Float32Array,
    sr: number,
    stage: 'beats-fullmix' | 'beats-drums',
  ) => {
    const mono22k = await resampleToBeatThis(monoPcm, sr);
    const {mel, T} = computeLogMel(mono22k);
    const {beatLogits, downbeatLogits} = await runBeatThisOnnx({
      ort,
      session: beatThisSession,
      mel,
      T,
      onChunk: (done, total) => progress({stage, percent: done / total}),
    });
    const audioSeconds = mono22k.length / BEAT_THIS_SAMPLE_RATE;
    const fps = T / audioSeconds;
    const pp = runPostprocessor({beatLogits, downbeatLogits, fps});
    return {pp, beatLogits, fps};
  };

  // ---- S2: Beat This! on the full mix ----
  progress({stage: 'beats-fullmix', percent: 0});
  const fullMixMono = new Float32Array(N);
  for (let i = 0; i < N; i++) fullMixMono[i] = (left[i] + right[i]) * 0.5;
  const fm = await runBeatThisOn(
    fullMixMono,
    SEPARATION_SAMPLE_RATE,
    'beats-fullmix',
  );

  // ---- S3: Beat This! on the drum stem ----
  progress({stage: 'beats-drums', percent: 0});
  const ds = await runBeatThisOn(
    drumStem,
    SEPARATION_SAMPLE_RATE,
    'beats-drums',
  );
  await beatThisSession.release();

  // ---- S2b: drum-onset offset ----
  progress({stage: 'convert'});
  const offsetMs = computeDrumOnsetOffsetMs({
    drumStemPcm: drumStem,
    sr: SEPARATION_SAMPLE_RATE,
    ppFmBeatsSec: fm.pp.beats,
  });

  // ds median IOI (consumed by OCTAVE_FIX)
  let dsIoiMs: number | null = null;
  if (ds.pp.beats.length >= 4) {
    const iois: number[] = [];
    for (let i = 1; i < ds.pp.beats.length; i++) {
      iois.push((ds.pp.beats[i] - ds.pp.beats[i - 1]) * 1000);
    }
    iois.sort((a, b) => a - b);
    dsIoiMs = iois[Math.floor(iois.length / 2)];
  }

  // ---- S4: heuristic converter ----
  const sync = beatsToSynctrack({
    beats: fm.pp.beats,
    downbeats: fm.pp.downbeats,
    beatLogits: fm.beatLogits,
    fps: fm.fps,
    drumStemPpIoiMs: dsIoiMs,
    drumOnsetOffsetMs: offsetMs,
    drumPpBeatsSec: ds.pp.beats,
    // PL_LSQ (banked drum-to-chart keep 83d432d, 2026-07-02): sparse
    // jitter-averaged tempo maps — ~6x fewer tempo events AND better
    // alignment than the per-beat map. Golden fixtures pin the per-beat
    // behavior, so this is opt-in here rather than a converter default.
    plLsqTolMs: PL_LSQ_TOL_MS_DEFAULT,
  });
  if (!sync) {
    throw new Error(
      "Couldn't detect enough beats in this audio to build a tempo map.",
    );
  }

  post({
    type: 'result',
    result: {
      synctrack: sync,
      drumOnsetOffsetMs: offsetMs,
      fullMixBeatCount: fm.pp.beats.length,
      drumStemBeatCount: ds.pp.beats.length,
    },
  });
}

self.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as PipelineRunRequest;
  if (msg.type === 'run') {
    run(msg).catch(err => {
      post({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }
});
