/**
 * Web Worker running BS-Roformer drum/vocals separation off the main thread.
 *
 * Mirrors lib/tempo-map/pipeline-worker.ts: ONNX session creation, the
 * OPFS-cached model download, and separateDrumStem's per-segment inference
 * loop all run here so the UI stays responsive during separation. Only Opus
 * encoding of the vocals stem stays on the main thread (OfflineAudioContext,
 * used by encodePcmToOpus, is unavailable in workers) — this worker returns
 * raw planar PCM for both stems and lets the client encode/store them.
 *
 * Nested workers: separateDrumStem spawns its own STFT/iSTFT sub-workers
 * (lib/tempo-map/stem-separation.ts, via `new Worker(new URL(...))`), which
 * is supported running inside this worker in Chrome.
 *
 * Communication protocol:
 *   Main → Worker:  {type: 'run', left, right}  (planar Float32, transferred)
 *   Worker → Main:  {type: 'progress', step, percent, etaSeconds?}
 *   Worker → Main:  {type: 'result', drumsLeft, drumsRight, vocalsLeft, vocalsRight}
 *   Worker → Main:  {type: 'error', message}
 */

import * as ort from 'onnxruntime-web';
import {getCachedModel} from '@/lib/lyrics-align/model-cache';
import {separateDrumStem} from '@/lib/tempo-map/stem-separation';

// Same model/cache constants as roformer-separation.ts (client) and
// lib/tempo-map/pipeline-worker.ts, so all three features share one
// OPFS-cached download.
const ROFORMER_MODEL_URL =
  'https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx/resolve/main/bs_roformer_sw_6stem_fp16.onnx';
const ROFORMER_CACHE_KEY = 'bs_roformer_sw_6stem_fp16.onnx';
const ROFORMER_MIN_BYTES = 300_000_000; // real size ~336 MB

const ORT_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

export interface SeparationWorkerProgress {
  step: 'loading-model' | 'processing';
  percent: number;
  etaSeconds?: number | undefined;
}

export interface SeparationWorkerRunRequest {
  type: 'run';
  left: Float32Array;
  right: Float32Array;
}

export type SeparationWorkerMessage =
  | ({type: 'progress'} & SeparationWorkerProgress)
  | {
      type: 'result';
      drumsLeft: Float32Array;
      drumsRight: Float32Array;
      vocalsLeft: Float32Array;
      vocalsRight: Float32Array;
    }
  | {type: 'error'; message: string};

function post(msg: SeparationWorkerMessage, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, {transfer: transfer ?? []});
}

async function run(req: SeparationWorkerRunRequest) {
  ort.env.wasm.wasmPaths = ORT_WASM_CDN;
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = 'error';

  post({step: 'loading-model', percent: 0, type: 'progress'});
  const modelBytes = await getCachedModel(
    ROFORMER_MODEL_URL,
    ROFORMER_CACHE_KEY,
    msg => {
      const m = msg.match(/\((\d+)%\)/);
      if (m) {
        post({
          type: 'progress',
          step: 'loading-model',
          percent: parseInt(m[1], 10) / 100,
        });
      }
    },
    ROFORMER_MIN_BYTES,
    'drum separator',
  );
  post({type: 'progress', step: 'loading-model', percent: 1});

  const session = await ort.InferenceSession.create(
    new Uint8Array(modelBytes),
    {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'disabled',
    },
  );

  try {
    post({type: 'progress', step: 'processing', percent: 0});
    const stems = await separateDrumStem({
      ort,
      left: req.left,
      right: req.right,
      session,
      output: 'stereo',
      includeVocals: true,
      onProgress: ({segment, totalSegments, etaSec}) => {
        post({
          type: 'progress',
          step: 'processing',
          percent: segment / totalSegments,
          etaSeconds: etaSec,
        });
      },
    });

    post(
      {
        type: 'result',
        drumsLeft: stems.left,
        drumsRight: stems.right,
        vocalsLeft: stems.vocals.left,
        vocalsRight: stems.vocals.right,
      },
      [
        stems.left.buffer,
        stems.right.buffer,
        stems.vocals.left.buffer,
        stems.vocals.right.buffer,
      ],
    );
  } finally {
    await session.release();
  }
}

self.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as SeparationWorkerRunRequest;
  if (msg.type === 'run') {
    run(msg).catch(err => {
      post({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }
});
