/**
 * Main-thread client for `pad-encode-worker.ts`, under the shared worker
 * cancellation contract (`lib/workers/abortable-worker.ts`): one job, one
 * worker, terminated when the run settles or is aborted.
 *
 * The request's PCM is structured-CLONED into the worker rather than
 * transferred: the caller (`usePaddedAudio`) keeps the ORIGINAL unpadded
 * buffers by reference and re-pads from them on every later anchor change,
 * so detaching them here would destroy the source of every future rebuild.
 * The results come back transferred, so only the copy in is paid for.
 *
 * Environments with no `Worker` (jsdom under Jest) fall back to running the
 * same `padAndEncode` inline. That is a compatibility path, not a product
 * path: in the browser this always runs off the main thread.
 */

import {
  makeAbortError,
  runAbortableWorker,
} from '@/lib/workers/abortable-worker';
import {
  padAndEncode,
  type PadEncodeParams,
  type PadEncodeProgress,
  type PadEncodeRequest,
  type PadEncodeTrack,
  type PadEncodedTrack,
  type PadEncodeWorkerMessage,
} from './pad-encode';

export function defaultCreateWorker(): Worker {
  return new Worker(new URL('./pad-encode-worker.ts', import.meta.url), {
    type: 'module',
  });
}

export interface PadEncodeOptions extends PadEncodeParams {
  onProgress?: ((progress: PadEncodeProgress) => void) | undefined;
  signal?: AbortSignal | undefined;
  /** Injectable worker factory, for tests without a module-URL environment.
   *  Null forces the inline path. */
  createWorker?: (() => Worker) | null | undefined;
}

/**
 * Pads and WAV-encodes `tracks` off the main thread. Resolves with one
 * result per input track, in the same order.
 */
export function padAndEncodeTracks(
  tracks: ReadonlyArray<PadEncodeTrack>,
  {
    padSamples,
    sampleRate,
    channels,
    onProgress,
    signal,
    createWorker,
  }: PadEncodeOptions,
): Promise<PadEncodedTrack[]> {
  if (signal?.aborted) return Promise.reject(makeAbortError());

  const spawn =
    createWorker === undefined
      ? typeof Worker === 'undefined'
        ? null
        : defaultCreateWorker
      : createWorker;

  if (!spawn) {
    return Promise.resolve(
      padAndEncode(tracks, {padSamples, sampleRate, channels}, onProgress),
    );
  }

  return runAbortableWorker<PadEncodedTrack[]>(
    spawn,
    signal,
    (worker, settle) => {
      worker.onmessage = (e: MessageEvent) => {
        const message = e.data as PadEncodeWorkerMessage;
        if (message.type === 'progress') {
          const {type: _type, ...progress} = message;
          onProgress?.(progress);
        } else if (message.type === 'result') {
          settle.resolve(message.tracks);
        } else {
          settle.reject(new Error(message.message));
        }
      };
      worker.onerror = e => {
        settle.reject(new Error(e.message || 'Audio padding worker error'));
      };

      const request: PadEncodeRequest = {
        type: 'pad-encode',
        padSamples,
        sampleRate,
        channels,
        tracks: tracks.map(track => ({name: track.name, pcm: track.pcm})),
      };
      worker.postMessage(request);
    },
  );
}
