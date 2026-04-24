/**
 * Client for the Demucs web worker.
 * Spawns a worker, runs separation, then terminates it to fully reclaim WASM memory.
 *
 * Ported from ~/projects/vocal-alignment/browser-aligner/src/demucs-client.ts
 */

export async function runDemucsInWorker(
  audioBuffer: AudioBuffer,
  onProgress?: (msg: string) => void,
): Promise<Float32Array> {
  const log = onProgress ?? console.log;

  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./demucs-worker.ts', import.meta.url),
      {type: 'module'},
    );

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'progress') {
        log(msg.message);
      } else if (msg.type === 'loaded') {
        // Model loaded — now send audio
        log('Preparing audio for separation...');

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
        log('Worker terminated — WASM memory reclaimed');
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
    log('Starting Demucs worker...');
    worker.postMessage({type: 'load'});
  });
}

/**
 * Resample an AudioBuffer to 16kHz mono using Web Audio API.
 * Use this when a vocals stem is already available (skip Demucs).
 */
export async function resampleTo16kMono(
  audioData: Uint8Array,
  mimeType: string,
): Promise<Float32Array> {
  const blob = new Blob([audioData as Uint8Array<ArrayBuffer>], {type: mimeType});
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new OfflineAudioContext(1, 1, 16000);
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(audioBuffer.duration * 16000),
    16000,
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}
