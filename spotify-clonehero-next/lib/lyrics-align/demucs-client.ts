/**
 * Client for the Demucs web worker.
 * Spawns a worker, runs separation, then terminates it to fully reclaim WASM memory.
 *
 * The message protocol and its types live in `demucs-worker.ts`, the one
 * authority on what a run can produce; they are imported as types only, so no
 * worker module reaches the page bundle.
 *
 * Ported from ~/projects/vocal-alignment/browser-aligner/src/demucs-client.ts
 */

import {runAbortableWorker} from '@/lib/workers/abortable-worker';
import type {
  DemucsSeparationRequest,
  DemucsSeparationResult,
  DemucsWorkerMessage,
} from './demucs-worker';

export interface DemucsProgress {
  /**
   * Which half of the run this tick came from. The worker reports the model
   * download and the separation itself on one channel, and only the client
   * sees the `loaded` handshake that divides them — so a caller wanting two
   * steps out of one run cannot work it out from the message text.
   */
  phase: 'loading-model' | 'separating';
  /** Human-readable status line. */
  message: string;
  /** 0..1 progress within the separation step. Omitted for setup messages. */
  percent?: number | undefined;
  /** Estimated seconds remaining in the separation step. */
  etaSeconds?: number | undefined;
}

export function defaultCreateDemucsWorker(): Worker {
  return new Worker(new URL('./demucs-worker.ts', import.meta.url), {
    type: 'module',
  });
}

/**
 * Runs one Demucs separation and resolves with the stems `want` asked for.
 *
 * `want` is explicit rather than defaulted: extracting a source costs an
 * iSTFT pass per segment and a song-length buffer, and the 44.1 kHz stems are
 * tens of megabytes each, so every call site names what it is paying for.
 * The worker downmixes and resamples the 16 kHz vocals internally, so that
 * product never crosses the boundary at 44.1 kHz stereo.
 *
 * `createWorker` is an injectable factory (defaults to the real
 * demucs-worker.ts) so tests can substitute a fake Worker without a real
 * Worker/module-URL environment — same seam as `runSeparationInWorker`.
 *
 * `signal` follows the shared worker-cancellation contract
 * (`lib/workers/abortable-worker.ts`).
 */
export async function runDemucsInWorker(
  audioBuffer: AudioBuffer,
  want: DemucsSeparationRequest,
  onProgress?: (progress: DemucsProgress) => void,
  createWorker: () => Worker = defaultCreateDemucsWorker,
  signal?: AbortSignal,
): Promise<DemucsSeparationResult> {
  let phase: DemucsProgress['phase'] = 'loading-model';
  const log = (progress: Omit<DemucsProgress, 'phase'>) => {
    const event = {...progress, phase};
    if (onProgress) onProgress(event);
    else console.log(event.message);
  };

  return runAbortableWorker<DemucsSeparationResult>(
    createWorker,
    signal,
    (worker, settle) => {
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as DemucsWorkerMessage;

        if (msg.type === 'progress') {
          log({
            message: msg.message,
            percent: msg.percent,
            etaSeconds: msg.etaSeconds,
          });
        } else if (msg.type === 'loaded') {
          // Model loaded — now send audio
          phase = 'separating';
          log({message: 'Preparing audio for separation...'});

          const numSamples = audioBuffer.length;
          const left = audioBuffer.getChannelData(0);
          const right =
            audioBuffer.numberOfChannels > 1
              ? audioBuffer.getChannelData(1)
              : left;

          // Interleave stereo
          const interleaved = new Float32Array(numSamples * 2);
          for (let i = 0; i < numSamples; i++) {
            interleaved[i * 2] = left[i];
            interleaved[i * 2 + 1] = right[i];
          }

          worker.postMessage(
            {type: 'separate', audioData: interleaved, numSamples, want},
            [interleaved.buffer],
          );
        } else if (msg.type === 'result') {
          // Settling terminates the worker, reclaiming all WASM memory.
          settle.resolve({
            drums: msg.drums,
            vocals: msg.vocals,
            vocals16k: msg.vocals16k,
          });
          log({message: 'Worker terminated — WASM memory reclaimed'});
        } else if (msg.type === 'error') {
          settle.reject(new Error(msg.message));
        }
      };

      worker.onerror = e => {
        settle.reject(new Error(e.message || 'Worker error'));
      };

      // Start by loading the model
      log({message: 'Starting Demucs worker...'});
      worker.postMessage({type: 'load'});
    },
  );
}
