/**
 * Web worker that shifts the start of the editor's audio tracks (`shift-tracks.ts`), so
 * applying a chart's leading silence never moves tens of millions of samples
 * on the main thread.
 *
 * One job per worker, matching every other worker client in this codebase:
 * the client (`shift-tracks-client.ts`) spawns it, posts one request, and
 * terminates it once the result is back.
 */

import {
  shiftTracks,
  type ShiftRequest,
  type ShiftWorkerMessage,
} from './shift-tracks';
import {uniqueBuffers} from '@/lib/workers/transfer';

const post = (message: ShiftWorkerMessage, transfer?: Transferable[]) => {
  self.postMessage(message, {transfer: transfer ?? []});
};

self.onmessage = (event: MessageEvent<ShiftRequest>) => {
  const request = event.data;
  try {
    const tracks = shiftTracks(
      request.tracks,
      {shiftSamples: request.shiftSamples, channels: request.channels},
      progress => post({type: 'progress', ...progress}),
    );
    // The shifted PCM is transferred, so the result crosses back with no copy.
    // These are the worker's own buffers (a zero shift hands back the request's
    // copy of the PCM, which is equally the worker's to give up), so nothing
    // the client still holds is detached by this.
    post(
      {type: 'result', tracks},
      uniqueBuffers(...tracks.map(t => t.shiftedPcm)),
    );
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
