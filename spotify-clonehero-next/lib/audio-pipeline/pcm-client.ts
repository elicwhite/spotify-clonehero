/**
 * Main-thread client for `pcm-worker.ts`. One job per worker, then terminate
 * it - the shared one-shot contract in `lib/workers/abortable-worker.ts`.
 *
 * `createWorker` is an injectable factory (defaults to the real
 * `pcm-worker.ts`) so tests can substitute a fake Worker without a real
 * Worker/module-URL environment, matching
 * `separate-stems.ts`'s `defaultCreateSeparationWorker` seam.
 */

import {
  runAbortableWorker,
  type WorkerSettle,
} from '@/lib/workers/abortable-worker';
import {uniqueBuffers} from '@/lib/workers/transfer';
import type {StereoStem} from './stem-cache';
import type {PcmWorkerMessage, PcmWorkerRequest} from './pcm-worker';

export function defaultCreatePcmWorker(): Worker {
  return new Worker(new URL('./pcm-worker.ts', import.meta.url), {
    type: 'module',
  });
}

export interface PcmWorkerOptions {
  createWorker?: (() => Worker) | undefined;
  signal?: AbortSignal | undefined;
}

function runJob<T>(
  request: PcmWorkerRequest,
  transfer: Transferable[],
  options: PcmWorkerOptions,
  onMessage: (msg: PcmWorkerMessage, settle: WorkerSettle<T>) => void,
): Promise<T> {
  const createWorker = options.createWorker ?? defaultCreatePcmWorker;
  return runAbortableWorker<T>(
    createWorker,
    options.signal,
    (worker, settle) => {
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as PcmWorkerMessage;
        if (msg.type === 'error') {
          settle.reject(new Error(msg.message));
          return;
        }
        onMessage(msg, settle);
      };
      worker.onerror = e => {
        settle.reject(new Error(e.message || 'PCM worker error'));
      };
      worker.postMessage(request, transfer);
    },
  );
}

/**
 * Resamples a planar stereo signal off the main thread. `left`/`right` are
 * transferred to the worker (detached for the caller), so pass copies if you
 * still need them.
 */
export function resampleStereoInWorker(
  left: Float32Array,
  right: Float32Array,
  inRate: number,
  outRate: number,
  options: PcmWorkerOptions = {},
): Promise<StereoStem> {
  return runJob<StereoStem>(
    {type: 'resample', left, right, inRate, outRate},
    uniqueBuffers(left, right),
    options,
    (msg, settle) => {
      if (msg.type === 'resampled') {
        settle.resolve({left: msg.left, right: msg.right});
      } else {
        // Anything else is a contract violation, not something to wait
        // through: settling here is what keeps the promise from hanging.
        settle.reject(new Error(`Unexpected PCM worker message: ${msg.type}`));
      }
    },
  );
}

/** What `encodeStemCacheBytesInWorker` hands back: the gzipped cache payload
 *  plus the stem channels, which were transferred INTO the worker and are
 *  echoed back so the caller can keep using them. */
export interface EncodedStem {
  bytes: Uint8Array;
  stem: StereoStem;
}

/**
 * Packs and gzips a stereo stem into its cache payload off the main thread.
 * `stem`'s channels are transferred to the worker and echoed back in
 * `EncodedStem.stem` - use those, not the originals, which are detached.
 */
export function encodeStemCacheBytesInWorker(
  stem: StereoStem,
  options: PcmWorkerOptions = {},
): Promise<EncodedStem> {
  return runJob<EncodedStem>(
    {type: 'gzip-stem', left: stem.left, right: stem.right},
    uniqueBuffers(stem.left, stem.right),
    options,
    (msg, settle) => {
      if (msg.type === 'gzipped') {
        settle.resolve({
          bytes: msg.bytes,
          stem: {left: msg.left, right: msg.right},
        });
      } else {
        settle.reject(new Error(`Unexpected PCM worker message: ${msg.type}`));
      }
    },
  );
}
