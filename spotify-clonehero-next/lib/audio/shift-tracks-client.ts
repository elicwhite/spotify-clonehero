/**
 * Main-thread client for `shift-tracks-worker.ts`, under the shared worker
 * cancellation contract (`lib/workers/abortable-worker.ts`): one job, one
 * worker, terminated when the run settles or is aborted.
 *
 * The request's PCM is structured-CLONED into the worker rather than
 * transferred: the caller (`useShiftedAudio`) keeps the ORIGINAL unpadded
 * buffers by reference and re-pads from them on every later anchor change,
 * so detaching them here would destroy the source of every future rebuild.
 * The results come back transferred, so only the copy in is paid for.
 *
 * A zero shift is not sent here at all — `shiftPcmStart` would hand back the same
 * samples, so the caller uses its own buffers and skips the round trip.
 *
 * Environments with no `Worker` (jsdom under Jest) fall back to running the
 * same `shiftTracks` inline. That is a compatibility path, not a product path:
 * in the browser this always runs off the main thread.
 */

import {
  makeAbortError,
  runAbortableWorker,
} from '@/lib/workers/abortable-worker';
import {
  shiftTracks,
  type ShiftParams,
  type ShiftProgress,
  type ShiftRequest,
  type ShiftTrack,
  type ShiftedTrack,
  type ShiftWorkerMessage,
} from './shift-tracks';

export function defaultCreateWorker(): Worker {
  return new Worker(new URL('./shift-tracks-worker.ts', import.meta.url), {
    type: 'module',
  });
}

export interface ShiftTracksOptions extends ShiftParams {
  onProgress?: ((progress: ShiftProgress) => void) | undefined;
  signal?: AbortSignal | undefined;
  /** Injectable worker factory, for tests without a module-URL environment.
   *  Null forces the inline path. */
  createWorker?: (() => Worker) | null | undefined;
}

/**
 * Shifts `tracks` off the main thread. Resolves with one result per input
 * track, in the same order.
 */
export function shiftTracksInWorker(
  tracks: ReadonlyArray<ShiftTrack>,
  {
    shiftSamples,
    channels,
    onProgress,
    signal,
    createWorker,
  }: ShiftTracksOptions,
): Promise<ShiftedTrack[]> {
  if (signal?.aborted) return Promise.reject(makeAbortError());

  const spawn =
    createWorker === undefined
      ? typeof Worker === 'undefined'
        ? null
        : defaultCreateWorker
      : createWorker;

  if (!spawn) {
    return Promise.resolve(
      shiftTracks(tracks, {shiftSamples, channels}, onProgress),
    );
  }

  return runAbortableWorker<ShiftedTrack[]>(spawn, signal, (worker, settle) => {
    worker.onmessage = (e: MessageEvent) => {
      const message = e.data as ShiftWorkerMessage;
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
      settle.reject(new Error(e.message || 'Audio shift worker error'));
    };

    const request: ShiftRequest = {
      type: 'shift',
      shiftSamples,
      channels,
      tracks: tracks.map(track => ({name: track.name, pcm: track.pcm})),
    };
    worker.postMessage(request);
  });
}
