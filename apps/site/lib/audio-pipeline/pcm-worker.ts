/**
 * Web Worker for the two long SYNCHRONOUS jobs the stem pipeline runs
 * between "decode" and "separate":
 *
 *   - libsoxr resampling to 44.1 kHz. `resampleSoxr` calls into WASM with the
 *     whole signal in one `processChunk`, so it blocks its thread for the
 *     entire song (~11.5M samples per channel for a 4-minute 48 kHz source).
 *   - gzip of the packed [L‖R] drum stem. `CompressionStream` returns a
 *     promise, but Blink deflates a single write in one uninterrupted task,
 *     so a ~92 MB stem blocks for as long as zlib needs.
 *
 * Both are pure data transforms with no DOM/Web Audio dependency, so they run
 * here and the main thread stays free to render the editor while separation
 * is in flight.
 *
 * Communication protocol (one job per worker, then the client terminates it):
 *   Main -> Worker: {type: 'resample', left, right, inRate, outRate}
 *   Worker -> Main: {type: 'resampled', left, right}
 *   Main -> Worker: {type: 'gzip-stem', left, right}
 *   Worker -> Main: {type: 'gzipped', bytes, left, right}
 *   Worker -> Main: {type: 'error', message}
 *
 * `gzip-stem` echoes the input channels back because the client transfers
 * them in (no copy) and still needs them afterwards - the same echo
 * convention `lib/tempo-map/pipeline-worker.ts` uses for `drumStemStereo`.
 */

import {resampleSoxr} from '@/lib/tempo-map/resampler-soxr';
import {uniqueBuffers} from '@/lib/workers/transfer';
import {encodeStemCacheBytes} from './stem-cache';

export interface PcmResampleRequest {
  type: 'resample';
  left: Float32Array;
  right: Float32Array;
  inRate: number;
  outRate: number;
}

export interface PcmGzipStemRequest {
  type: 'gzip-stem';
  left: Float32Array;
  right: Float32Array;
}

export type PcmWorkerRequest = PcmResampleRequest | PcmGzipStemRequest;

export type PcmWorkerMessage =
  | {type: 'resampled'; left: Float32Array; right: Float32Array}
  | {
      type: 'gzipped';
      bytes: Uint8Array;
      left: Float32Array;
      right: Float32Array;
    }
  | {type: 'error'; message: string};

function post(msg: PcmWorkerMessage, transfer: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, {transfer});
}

async function run(req: PcmWorkerRequest): Promise<void> {
  if (req.type === 'resample') {
    const [left, right] = await Promise.all([
      resampleSoxr(req.left, req.inRate, req.outRate),
      resampleSoxr(req.right, req.inRate, req.outRate),
    ]);
    post({type: 'resampled', left, right}, uniqueBuffers(left, right));
    return;
  }

  const bytes = await encodeStemCacheBytes({left: req.left, right: req.right});
  post(
    {type: 'gzipped', bytes, left: req.left, right: req.right},
    uniqueBuffers(bytes, req.left, req.right),
  );
}

self.onmessage = (e: MessageEvent) => {
  run(e.data as PcmWorkerRequest).catch((err: unknown) => {
    post(
      {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      },
      [],
    );
  });
};
