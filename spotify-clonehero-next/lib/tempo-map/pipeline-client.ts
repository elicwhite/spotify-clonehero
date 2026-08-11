/**
 * Main-thread client for the tempo-mapping pipeline worker. Spawns a worker,
 * runs the pipeline on an AudioBuffer, then terminates the worker to reclaim
 * WASM/GPU memory.
 */

import {
  computeStemFingerprint,
  ROFORMER_SEPARATOR_ID,
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

  return runAbortableWorker<PipelineResultFor<K>>(
    createWorker,
    options.signal,
    (worker, settle) => {
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as PipelineWorkerMessage;
        if (msg.type === 'progress') {
          const {type: _type, ...p} = msg;
          options.onProgress?.(p);
        } else if (msg.type === 'result') {
          settle.resolve(msg.result as PipelineResultFor<K>);
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
