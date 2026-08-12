/**
 * Web worker that pads and WAV-encodes the editor's audio tracks
 * (`pad-encode.ts`), so applying a chart's leading silence never converts
 * tens of millions of samples on the main thread.
 *
 * One job per worker, matching every other worker client in this codebase:
 * the client (`pad-encode-client.ts`) spawns it, posts one request, and
 * terminates it once the result is back.
 */

import {
  padAndEncode,
  type PadEncodeRequest,
  type PadEncodeWorkerMessage,
} from './pad-encode';
import {uniqueBuffers} from '@/lib/workers/transfer';

const post = (message: PadEncodeWorkerMessage, transfer?: Transferable[]) => {
  self.postMessage(message, {transfer: transfer ?? []});
};

self.onmessage = (event: MessageEvent<PadEncodeRequest>) => {
  const request = event.data;
  try {
    const tracks = padAndEncode(
      request.tracks,
      {
        padSamples: request.padSamples,
        sampleRate: request.sampleRate,
        channels: request.channels,
      },
      progress => post({type: 'progress', ...progress}),
    );
    // Both views per track are transferred, so the result crosses back with
    // no copy. They are the worker's own buffers (a zero pad hands back the
    // request's copy of the PCM, which is equally the worker's to give up),
    // so nothing the client still holds is detached by this.
    post(
      {type: 'result', tracks},
      uniqueBuffers(...tracks.flatMap(t => [t.paddedPcm, t.wav])),
    );
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
