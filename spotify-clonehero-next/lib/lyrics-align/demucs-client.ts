/**
 * Client for the Demucs web worker.
 * Spawns a worker, runs separation, then terminates it to fully reclaim WASM memory.
 *
 * Ported from ~/projects/vocal-alignment/browser-aligner/src/demucs-client.ts
 */

export interface DemucsProgress {
  /** Human-readable status line. */
  message: string;
  /** 0..1 progress within the separation step. Omitted for setup messages. */
  percent?: number;
  /** Estimated seconds remaining in the separation step. */
  etaSeconds?: number;
}

export function defaultCreateDemucsWorker(): Worker {
  return new Worker(new URL('./demucs-worker.ts', import.meta.url), {
    type: 'module',
  });
}

/**
 * Runs one Demucs separation and resolves with the vocals stem as 16kHz mono
 * PCM — the aligner's input format. The worker downmixes and resamples
 * internally, so nothing crosses the boundary at 44.1kHz stereo.
 *
 * `createWorker` is an injectable factory (defaults to the real
 * demucs-worker.ts) so tests can substitute a fake Worker without a real
 * Worker/module-URL environment — same seam as `runSeparationInWorker`.
 */
export async function runDemucsInWorker(
  audioBuffer: AudioBuffer,
  onProgress?: (progress: DemucsProgress) => void,
  createWorker: () => Worker = defaultCreateDemucsWorker,
): Promise<Float32Array> {
  const log = (progress: DemucsProgress) => {
    if (onProgress) onProgress(progress);
    else console.log(progress.message);
  };

  return new Promise((resolve, reject) => {
    const worker = createWorker();

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'progress') {
        log({
          message: msg.message,
          percent: msg.percent,
          etaSeconds: msg.etaSeconds,
        });
      } else if (msg.type === 'loaded') {
        // Model loaded — now send audio
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
          {type: 'separate', audioData: interleaved, numSamples},
          [interleaved.buffer],
        );
      } else if (msg.type === 'result') {
        // Done — terminate worker to reclaim all WASM memory
        worker.terminate();
        log({message: 'Worker terminated — WASM memory reclaimed'});
        resolve(msg.vocals16k as Float32Array);
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };

    worker.onerror = e => {
      worker.terminate();
      reject(new Error(e.message || 'Worker error'));
    };

    // Start by loading the model
    log({message: 'Starting Demucs worker...'});
    worker.postMessage({type: 'load'});
  });
}
