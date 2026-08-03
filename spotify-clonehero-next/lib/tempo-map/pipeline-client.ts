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
import type {
  PipelineProgress,
  PipelineResult,
  PipelineWorkerMessage,
} from './types';

export interface TempoPipelineOptions {
  /** Raw source bytes; hashed for the OPFS drum-stem cache. */
  sourceBytes?: ArrayBuffer | null;
  /**
   * Pre-separated drum stem, planar stereo at 44.1 kHz. When provided,
   * the worker skips BS-Roformer separation and echoes the stem back in
   * the result. The buffers are transferred to the worker (detached for
   * the caller) — consume `PipelineResult.drumStemStereo` afterwards.
   */
  drumStemStereo?: {left: Float32Array; right: Float32Array} | null;
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

export async function runTempoPipeline(
  audioBuffer: AudioBuffer,
  options: TempoPipelineOptions = {},
): Promise<PipelineResult> {
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
export async function runTempoPipelineFromPcm(
  input: {left: Float32Array; right: Float32Array; sampleRate: number},
  options: TempoPipelineOptions = {},
): Promise<PipelineResult> {
  if (options.signal?.aborted) {
    throw makeAbortError();
  }

  const fingerprint = options.sourceBytes
    ? await computeStemFingerprint(options.sourceBytes, ROFORMER_SEPARATOR_ID)
    : null;

  const {left, right, sampleRate} = input;
  const drumStemStereo = options.drumStemStereo ?? null;
  const createWorker = options.createWorker ?? defaultCreateWorker;

  return runAbortableWorker<PipelineResult>(
    createWorker,
    options.signal,
    (worker, settle) => {
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as PipelineWorkerMessage;
        if (msg.type === 'progress') {
          const {type: _type, ...p} = msg;
          options.onProgress?.(p);
        } else if (msg.type === 'result') {
          settle.resolve(msg.result);
        } else if (msg.type === 'error') {
          settle.reject(new Error(msg.message));
        }
      };
      worker.onerror = e => {
        settle.reject(new Error(e.message || 'Tempo pipeline worker error'));
      };

      const transfer: Transferable[] = [left.buffer, right.buffer];
      if (drumStemStereo) {
        // Dedupe: the two channels may be views over one shared buffer.
        for (const buf of new Set([
          drumStemStereo.left.buffer,
          drumStemStereo.right.buffer,
        ])) {
          transfer.push(buf);
        }
      }
      worker.postMessage(
        {
          type: 'run',
          left,
          right,
          sampleRate,
          fingerprint,
          drumStemStereo,
        },
        transfer,
      );
    },
  );
}
