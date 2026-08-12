/**
 * Main-thread client for `pad-tracks-worker.ts`, under the shared worker
 * cancellation contract (`lib/workers/abortable-worker.ts`): one job, one
 * worker, terminated when the run settles or is aborted.
 *
 * The request's PCM is structured-CLONED into the worker rather than
 * transferred: the caller (`usePaddedAudio`) keeps the ORIGINAL unpadded
 * buffers by reference and re-pads from them on every later anchor change,
 * so detaching them here would destroy the source of every future rebuild.
 * The results come back transferred, so only the copy in is paid for.
 *
 * A zero pad is not sent here at all — `padPcmStart` would hand back the same
 * samples, so the caller uses its own buffers and skips the round trip.
 *
 * Environments with no `Worker` (jsdom under Jest) fall back to running the
 * same `padTracks` inline. That is a compatibility path, not a product path:
 * in the browser this always runs off the main thread.
 */

import {
  makeAbortError,
  runAbortableWorker,
} from '@/lib/workers/abortable-worker';
import {
  padTracks,
  type PadParams,
  type PadProgress,
  type PadRequest,
  type PadTrack,
  type PaddedTrack,
  type PadWorkerMessage,
} from './pad-tracks';

export function defaultCreateWorker(): Worker {
  return new Worker(new URL('./pad-tracks-worker.ts', import.meta.url), {
    type: 'module',
  });
}

export interface PadTracksOptions extends PadParams {
  onProgress?: ((progress: PadProgress) => void) | undefined;
  signal?: AbortSignal | undefined;
  /** Injectable worker factory, for tests without a module-URL environment.
   *  Null forces the inline path. */
  createWorker?: (() => Worker) | null | undefined;
}

/**
 * Pads `tracks` off the main thread. Resolves with one result per input
 * track, in the same order.
 */
export function padTracksInWorker(
  tracks: ReadonlyArray<PadTrack>,
  {padSamples, channels, onProgress, signal, createWorker}: PadTracksOptions,
): Promise<PaddedTrack[]> {
  if (signal?.aborted) return Promise.reject(makeAbortError());

  const spawn =
    createWorker === undefined
      ? typeof Worker === 'undefined'
        ? null
        : defaultCreateWorker
      : createWorker;

  if (!spawn) {
    return Promise.resolve(
      padTracks(tracks, {padSamples, channels}, onProgress),
    );
  }

  return runAbortableWorker<PaddedTrack[]>(spawn, signal, (worker, settle) => {
    worker.onmessage = (e: MessageEvent) => {
      const message = e.data as PadWorkerMessage;
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

    const request: PadRequest = {
      type: 'pad',
      padSamples,
      channels,
      tracks: tracks.map(track => ({name: track.name, pcm: track.pcm})),
    };
    worker.postMessage(request);
  });
}
