/**
 * Main-thread client for the tempo-mapping pipeline worker. Spawns a worker,
 * runs the pipeline on an AudioBuffer, then terminates the worker to reclaim
 * WASM/GPU memory.
 */

import {encodePcmToOpus, isOpusEncodeSupported} from '@/lib/audio/opus-encoder';
import {VOCALS_STEM} from '@/lib/audio-pipeline/separate-stems';
import {
  computeStemFingerprint,
  ROFORMER_SEPARATOR_ID,
  STEM_CACHE_SAMPLE_RATE,
  storeStemOpus,
} from '@/lib/audio-pipeline/stem-cache';
import {
  makeAbortError,
  runAbortableWorker,
} from '@/lib/workers/abortable-worker';
import {uniqueBuffers} from '@/lib/workers/transfer';
import type {
  PipelineProgress,
  PipelineResultFor,
  PipelineRunKind,
  PipelineRunRequest,
  PipelineWorkerMessage,
} from './types';

export interface TempoPipelineOptions<
  K extends PipelineRunKind = PipelineRunKind,
> {
  /** Raw source bytes; hashed for the OPFS drum-stem cache. */
  sourceBytes?: ArrayBuffer | null;
  /**
   * Pre-separated drum stem, planar stereo at 44.1 kHz. When provided,
   * the worker skips BS-Roformer separation and echoes the stem back in
   * the result. The buffers are transferred to the worker (detached for
   * the caller) — consume `TempoMapPipelineResult.drumStemStereo` afterwards.
   */
  drumStemStereo?: {left: Float32Array; right: Float32Array} | null;
  /**
   * What this run is for (see {@link PipelineRunKind}). Determines the
   * result shape: only a tempo-map kind comes back with a grid. Defaults to
   * `'tempo-map+sections'`, the full pipeline.
   */
  kind?: K | undefined;
  /**
   * Beat times in seconds for a `'sections'` run whose caller already has a
   * grid (the chart's own tempo map). Supplied, the run skips the Beat This!
   * download and pass and labels sections straight off these beats.
   */
  beatTimes?: number[] | null;
  onProgress?: (p: PipelineProgress) => void;
  /**
   * Injectable worker factory (defaults to the real pipeline-worker.ts) so
   * tests can substitute a fake Worker without a real Worker/module-URL
   * environment.
   */
  createWorker?: () => Worker;
  /**
   * Aborts the run, per the shared worker-cancellation contract
   * (`lib/workers/abortable-worker.ts`).
   */
  signal?: AbortSignal | undefined;
}

/**
 * Seeds the stem cache with the vocals a fresh separation produced, Opus
 * encoded like every other cached vocals stem. This is the only reason the
 * tempo pipeline inverts vocals at all: it is what lets `/chart-editor` put a
 * Vocals track on its mixer for a song whose separation ran here.
 *
 * Never throws. A tempo map that worked must not fail over a cache seed.
 */
async function storeVocalsStem(
  fingerprint: string,
  vocals: {left: Float32Array; right: Float32Array},
): Promise<void> {
  // Nothing to report on a browser without WebCodecs: the run keeps its
  // tempo map, and the editor simply has no vocals track to offer.
  if (!isOpusEncodeSupported()) return;
  try {
    const frames = Math.min(vocals.left.length, vocals.right.length);
    const interleaved = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      interleaved[i * 2] = vocals.left[i];
      interleaved[i * 2 + 1] = vocals.right[i];
    }
    const opus = await encodePcmToOpus(interleaved, STEM_CACHE_SAMPLE_RATE, 2);
    await storeStemOpus(fingerprint, VOCALS_STEM, opus);
  } catch (err) {
    console.warn('Could not cache the separated vocals stem:', err);
  }
}

export function defaultCreateWorker(): Worker {
  return new Worker(new URL('./pipeline-worker.ts', import.meta.url), {
    type: 'module',
  });
}

export async function runTempoPipeline<
  K extends PipelineRunKind = 'tempo-map+sections',
>(
  audioBuffer: AudioBuffer,
  options: TempoPipelineOptions<K> = {},
): Promise<PipelineResultFor<K>> {
  const left = audioBuffer.getChannelData(0).slice();
  const right =
    audioBuffer.numberOfChannels > 1
      ? audioBuffer.getChannelData(1).slice()
      : left.slice();
  return runTempoPipelineFromPcm(
    {left, right, sampleRate: audioBuffer.sampleRate},
    options,
  );
}

/**
 * Planar-PCM entry point for callers that don't hold an AudioBuffer (e.g.
 * the drum-transcription pipeline resuming from OPFS-stored PCM).
 * `left`/`right` buffers are transferred to the worker (detached for the
 * caller), so pass copies if you still need them.
 */
export async function runTempoPipelineFromPcm<
  K extends PipelineRunKind = 'tempo-map+sections',
>(
  input: {left: Float32Array; right: Float32Array; sampleRate: number},
  options: TempoPipelineOptions<K> = {},
): Promise<PipelineResultFor<K>> {
  if (options.signal?.aborted) {
    throw makeAbortError();
  }

  const fingerprint = options.sourceBytes
    ? await computeStemFingerprint(options.sourceBytes, ROFORMER_SEPARATOR_ID)
    : null;

  const {left, right, sampleRate} = input;
  const drumStemStereo = options.drumStemStereo ?? null;
  const createWorker = options.createWorker ?? defaultCreateWorker;

  // The vocals arrive mid-run, so the encode and store overlap the beat
  // passes; the result waits on them anyway. `useSeparatedStems` re-probes the
  // cache the moment a separating run reports success, and a store still in
  // flight then is a stem the mixer would miss until the next reload.
  let vocalsStored: Promise<void> | null = null;

  return runAbortableWorker<PipelineResultFor<K>>(
    createWorker,
    options.signal,
    (worker, settle) => {
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as PipelineWorkerMessage;
        if (msg.type === 'progress') {
          const {type: _type, ...p} = msg;
          options.onProgress?.(p);
        } else if (msg.type === 'vocals') {
          if (fingerprint)
            vocalsStored = storeVocalsStem(fingerprint, msg.vocals);
        } else if (msg.type === 'result') {
          const result = msg.result as PipelineResultFor<K>;
          if (!vocalsStored) settle.resolve(result);
          else void vocalsStored.then(() => settle.resolve(result));
        } else if (msg.type === 'error') {
          settle.reject(new Error(msg.message));
        }
      };
      worker.onerror = e => {
        settle.reject(new Error(e.message || 'Tempo pipeline worker error'));
      };

      const transfer = uniqueBuffers(
        left,
        right,
        ...(drumStemStereo ? [drumStemStereo.left, drumStemStereo.right] : []),
      );
      const request: PipelineRunRequest = {
        type: 'run',
        kind: options.kind ?? 'tempo-map+sections',
        left,
        right,
        sampleRate,
        fingerprint,
        drumStemStereo,
        beatTimes: options.beatTimes ?? null,
      };
      worker.postMessage(request, transfer);
    },
  );
}
