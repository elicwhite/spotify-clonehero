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
  storeStemBytes,
  loadStem,
  storeStemOpus,
  loadStemOpus,
  type StereoStem,
} from '@/lib/audio-pipeline/stem-cache';
import {encodeStemCacheBytesInWorker} from '@/lib/audio-pipeline/pcm-client';
import {
  makeAbortError,
  runAbortableWorker,
} from '@/lib/workers/abortable-worker';

const NUM_CHANNELS = 2;
/** Stem-cache entry names this module writes. Exported so probe-side callers
 *  (`lib/assist/tasks/`'s cached-step prediction) name the same entries
 *  this module stores, instead of re-declaring the strings. */
export const DRUMS_STEM = 'drums';
export const VOCALS_STEM = 'vocals';

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
 *
 * `signal` follows the shared worker-cancellation contract
 * (`lib/workers/abortable-worker.ts`).
 */
export function runSeparationInWorker(
  left: Float32Array,
  right: Float32Array,
  onProgress?: DrumSeparationProgressCallback,
  createWorker: () => Worker = defaultCreateSeparationWorker,
  signal?: AbortSignal,
): Promise<SeparationWorkerResult> {
  return runAbortableWorker<SeparationWorkerResult>(
    createWorker,
    signal,
    (worker, settle) => {
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as SeparationWorkerMessage;
        if (msg.type === 'progress') {
          onProgress?.({
            step: msg.step,
            percent: msg.percent,
            etaSeconds: msg.etaSeconds,
          });
        } else if (msg.type === 'result') {
          const {drumsLeft, drumsRight, vocalsLeft, vocalsRight} = msg;
          settle.resolve({drumsLeft, drumsRight, vocalsLeft, vocalsRight});
        } else if (msg.type === 'error') {
          settle.reject(new Error(msg.message));
        }
      };
      worker.onerror = e => {
        settle.reject(new Error(e.message || 'Separation worker error'));
      };

      worker.postMessage({type: 'run', left, right}, [
        left.buffer,
        right.buffer,
      ]);
    },
  );
}

// ---------------------------------------------------------------------------
// Separation sanity check
// ---------------------------------------------------------------------------

/**
 * Walks every channel once and reports the two facts the guard below needs.
 * A full song is ~10 M samples per channel, so one pass rather than two.
 */
function inspectChannels(channels: Float32Array[]): {
  anySignal: boolean;
  anyNonFinite: boolean;
} {
  let anySignal = false;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i];
      if (!Number.isFinite(sample)) return {anySignal, anyNonFinite: true};
      if (sample !== 0) anySignal = true;
    }
  }
  return {anySignal, anyNonFinite: false};
}

/**
 * Throws unless the separation produced usable audio.
 *
 * The stem cache is keyed by the fingerprint of the mix, and every page
 * reads it, so a bad stem written once is a bad stem forever — until the
 * user finds and clears the cache. A graphics card that cannot compile the
 * model's shaders is the known way to get one: ONNX Runtime reports that
 * failure only to the console, and the run reads back buffers that nothing
 * wrote, which gives silence rather than an error.
 * `lib/onnx/webgpu-capability.ts` stops that case before the run starts;
 * this is the last guard before the write, for any cause.
 *
 * Silence is a fault only when the mix itself was not silent, so a silent
 * upload still separates and caches normally.
 *
 * Exported for its unit test; only {@link separateStems} calls it.
 */
export function assertSeparationUsable(
  mix: {left: Float32Array; right: Float32Array},
  stems: {
    drumsLeft: Float32Array;
    drumsRight: Float32Array;
    vocalsLeft: Float32Array;
    vocalsRight: Float32Array;
  },
): void {
  const separated = inspectChannels([
    stems.drumsLeft,
    stems.drumsRight,
    stems.vocalsLeft,
    stems.vocalsRight,
  ]);
  if (separated.anyNonFinite) {
    throw new Error(
      'Stem separation produced unusable audio, so nothing was saved. This usually means the graphics card couldn’t run the model.',
    );
  }
  if (
    !separated.anySignal &&
    inspectChannels([mix.left, mix.right]).anySignal
  ) {
    throw new Error(
      'Stem separation produced silence, so nothing was saved. This usually means the graphics card couldn’t run the model.',
    );
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Separates the requested stems from raw audio bytes, through the unified
 * fingerprint-keyed cache. Cache-hit stems are returned without spawning a
 * worker; any miss triggers one separation pass that produces (and caches)
 * BOTH drums and vocals, since the worker always computes both.
 *
 * `opts.signal`, when provided, aborts the run: an already-aborted signal
 * rejects immediately (before any cache probe or worker spawn); aborting
 * mid-separation terminates the worker and rejects with an `AbortError`
 * DOMException; aborting after separation completes but before the result
 * is cached also rejects with `AbortError` and skips the store step
 * entirely (no partial cache write).
 *
 * `opts.createPcmWorker` overrides the factory for the resample + gzip
 * worker (`pcm-worker.ts`), which is what keeps the long synchronous PCM
 * jobs on either side of separation off the main thread; tests inject a fake
 * through it.
 */
export async function separateStems(
  audioBytes: Uint8Array,
  opts: {
    drums?: boolean;
    vocals?: boolean;
    signal?: AbortSignal | undefined;
    createPcmWorker?: (() => Worker) | undefined;
  },
  onProgress?: DrumSeparationProgressCallback,
): Promise<{drums?: StereoStem; vocals?: StereoStem}> {
  if (opts.signal?.aborted) {
    throw makeAbortError();
  }

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
  const pcmWorkerOpts = {
    createWorker: opts.createPcmWorker,
    signal: opts.signal,
  };
  const decoded = await decodeAndResampleTo44k(audioBytes, pcmWorkerOpts);
  const numSamples = decoded.length;
  const left = decoded.getChannelData(0);
  const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left;

  const {drumsLeft, drumsRight, vocalsLeft, vocalsRight} =
    await runSeparationInWorker(
      left.slice(),
      right.slice(),
      onProgress,
      undefined,
      opts.signal,
    );

  if (opts.signal?.aborted) {
    throw makeAbortError();
  }

  // Before the cache write, never after: a bad stem stored under this
  // fingerprint is what every later run on this mix reads.
  assertSeparationUsable(
    {left, right},
    {drumsLeft, drumsRight, vocalsLeft, vocalsRight},
  );

  // Store BOTH freshly-separated stems — the worker always produces both,
  // so seed the whole cache rather than only what was requested.
  onProgress?.({step: 'storing', percent: 0});
  // Pack + gzip in the PCM worker: a full-song stem is ~90 MB and Blink
  // deflates one write in a single uninterrupted task. The channels are
  // transferred in and echoed back, so `stem` below - not the detached
  // `drumsLeft`/`drumsRight` - is what the caller gets.
  const {bytes: drumsBytes, stem: drumsStem} =
    await encodeStemCacheBytesInWorker(
      {left: drumsLeft, right: drumsRight},
      pcmWorkerOpts,
    );
  await storeStemBytes(fingerprint, DRUMS_STEM, drumsBytes);
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

  if (needsDrums) result.drums = drumsStem;
  if (needsVocals) result.vocals = {left: vocalsLeft, right: vocalsRight};
  return result;
}
