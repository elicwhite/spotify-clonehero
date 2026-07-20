/**
 * Project-agnostic BS-Roformer stem separation, backed by the unified
 * fingerprint-keyed cache (`lib/audio-pipeline/stem-cache.ts`). Raw audio
 * bytes in, requested stems out — no OPFS project coupling, so any page
 * (`/drum-transcription`, `/tempo`, `/add-lyrics`) can call it directly and
 * share cache hits with the others.
 *
 * The actual ONNX inference runs off the main thread in
 * `lib/drum-transcription/ml/separation-worker.ts` (mirrors
 * `lib/tempo-map/pipeline-worker.ts` / `pipeline-client.ts`).
 */

import {encodePcmToOpus} from '@/lib/audio/opus-encoder';
import {decodeAudio} from '@/lib/drum-transcription/audio/decoder';
import {decodeAndResampleTo44k} from '@/lib/audio-pipeline/decode-audio';
import type {SeparationWorkerMessage} from '@/lib/drum-transcription/ml/separation-worker';
import {
  computeStemFingerprint,
  ROFORMER_SEPARATOR_ID,
  storeStem,
  loadStem,
  storeStemOpus,
  loadStemOpus,
  type StereoStem,
} from '@/lib/audio-pipeline/stem-cache';

const NUM_CHANNELS = 2;
const DRUMS_STEM = 'drums';
const VOCALS_STEM = 'vocals';

export interface DrumSeparationProgress {
  step: 'loading-model' | 'processing' | 'storing' | 'done';
  percent: number; // 0-1
  etaSeconds?: number | undefined;
}

export type DrumSeparationProgressCallback = (
  p: DrumSeparationProgress,
) => void;

// ---------------------------------------------------------------------------
// Separation worker client
// ---------------------------------------------------------------------------

export interface SeparationWorkerResult {
  drumsLeft: Float32Array;
  drumsRight: Float32Array;
  vocalsLeft: Float32Array;
  vocalsRight: Float32Array;
}

export function defaultCreateSeparationWorker(): Worker {
  return new Worker(
    new URL('../drum-transcription/ml/separation-worker.ts', import.meta.url),
    {type: 'module'},
  );
}

/**
 * Spawns separation-worker.ts, runs one separation, and terminates it
 * (one-shot) to reclaim WASM/GPU memory. `left`/`right` are transferred to
 * the worker (detached for the caller).
 *
 * `createWorker` is an injectable factory (defaults to the real
 * separation-worker.ts) so tests can substitute a fake Worker without a real
 * Worker/module-URL environment — exported for that reason; not part of the
 * public API surface used outside this module and its tests.
 */
export function runSeparationInWorker(
  left: Float32Array,
  right: Float32Array,
  onProgress?: DrumSeparationProgressCallback,
  createWorker: () => Worker = defaultCreateSeparationWorker,
): Promise<SeparationWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = createWorker();

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as SeparationWorkerMessage;
      if (msg.type === 'progress') {
        onProgress?.({
          step: msg.step,
          percent: msg.percent,
          etaSeconds: msg.etaSeconds,
        });
      } else if (msg.type === 'result') {
        worker.terminate();
        const {drumsLeft, drumsRight, vocalsLeft, vocalsRight} = msg;
        resolve({drumsLeft, drumsRight, vocalsLeft, vocalsRight});
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = e => {
      worker.terminate();
      reject(new Error(e.message || 'Separation worker error'));
    };

    worker.postMessage({type: 'run', left, right}, [left.buffer, right.buffer]);
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Separates the requested stems from raw audio bytes, through the unified
 * fingerprint-keyed cache. Cache-hit stems are returned without spawning a
 * worker; any miss triggers one separation pass that produces (and caches)
 * BOTH drums and vocals, since the worker always computes both.
 */
export async function separateStems(
  audioBytes: Uint8Array,
  opts: {drums?: boolean; vocals?: boolean},
  onProgress?: DrumSeparationProgressCallback,
): Promise<{drums?: StereoStem; vocals?: StereoStem}> {
  const fingerprint = await computeStemFingerprint(
    audioBytes,
    ROFORMER_SEPARATOR_ID,
  );

  const result: {drums?: StereoStem; vocals?: StereoStem} = {};

  if (opts.drums) {
    const cached = await loadStem(fingerprint, DRUMS_STEM);
    if (cached) result.drums = cached;
  }
  if (opts.vocals) {
    const cachedOpus = await loadStemOpus(fingerprint, VOCALS_STEM);
    if (cachedOpus) {
      const decoded = await decodeAudio(cachedOpus.buffer as ArrayBuffer);
      result.vocals = {
        left: decoded.getChannelData(0),
        right:
          decoded.numberOfChannels > 1
            ? decoded.getChannelData(1)
            : decoded.getChannelData(0),
      };
    }
  }

  const needsDrums = opts.drums && result.drums == null;
  const needsVocals = opts.vocals && result.vocals == null;
  if (!needsDrums && !needsVocals) {
    return result;
  }

  // ---- Decode + separate ----
  const decoded = await decodeAndResampleTo44k(audioBytes);
  const numSamples = decoded.length;
  const left = decoded.getChannelData(0);
  const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left;

  const {drumsLeft, drumsRight, vocalsLeft, vocalsRight} =
    await runSeparationInWorker(left.slice(), right.slice(), onProgress);

  // Store BOTH freshly-separated stems — the worker always produces both,
  // so seed the whole cache rather than only what was requested.
  onProgress?.({step: 'storing', percent: 0});
  await storeStem(fingerprint, DRUMS_STEM, {
    left: drumsLeft,
    right: drumsRight,
  });
  const interleavedVocals = new Float32Array(numSamples * NUM_CHANNELS);
  for (let i = 0; i < numSamples; i++) {
    interleavedVocals[i * 2] = vocalsLeft[i];
    interleavedVocals[i * 2 + 1] = vocalsRight[i];
  }
  const vocalsOpus = await encodePcmToOpus(
    interleavedVocals,
    44100,
    NUM_CHANNELS,
  );
  await storeStemOpus(fingerprint, VOCALS_STEM, vocalsOpus);
  onProgress?.({step: 'done', percent: 1});

  if (needsDrums) result.drums = {left: drumsLeft, right: drumsRight};
  if (needsVocals) result.vocals = {left: vocalsLeft, right: vocalsRight};
  return result;
}
