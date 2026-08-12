/**
 * Web worker that pads the editor's audio tracks (`pad-tracks.ts`), so
 * applying a chart's leading silence never moves tens of millions of samples
 * on the main thread.
 *
 * One job per worker, matching every other worker client in this codebase:
 * the client (`pad-tracks-client.ts`) spawns it, posts one request, and
 * terminates it once the result is back.
 */

import {padTracks, type PadRequest, type PadWorkerMessage} from './pad-tracks';
import {uniqueBuffers} from '@/lib/workers/transfer';

const post = (message: PadWorkerMessage, transfer?: Transferable[]) => {
  self.postMessage(message, {transfer: transfer ?? []});
};

self.onmessage = (event: MessageEvent<PadRequest>) => {
  const request = event.data;
  try {
    const tracks = padTracks(
      request.tracks,
      {padSamples: request.padSamples, channels: request.channels},
      progress => post({type: 'progress', ...progress}),
    );
    // The padded PCM is transferred, so the result crosses back with no copy.
    // These are the worker's own buffers (a zero pad hands back the request's
    // copy of the PCM, which is equally the worker's to give up), so nothing
    // the client still holds is detached by this.
    post(
      {type: 'result', tracks},
      uniqueBuffers(...tracks.map(t => t.paddedPcm)),
    );
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
