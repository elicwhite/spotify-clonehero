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

export async function runDemucsInWorker(
  audioBuffer: AudioBuffer,
  onProgress?: (progress: DemucsProgress) => void,
): Promise<Float32Array> {
  const log = (progress: DemucsProgress) => {
    if (onProgress) onProgress(progress);
    else console.log(progress.message);
  };

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./demucs-worker.ts', import.meta.url), {
      type: 'module',
    });

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

/**
 * Resample an AudioBuffer to 16kHz mono using Web Audio API.
 * Use this when a vocals stem is already available (skip Demucs).
 */
export async function resampleTo16kMono(
  audioData: Uint8Array,
  mimeType: string,
): Promise<Float32Array> {
  const blob = new Blob([audioData as Uint8Array<ArrayBuffer>], {
    type: mimeType,
  });
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

/**
 * Sum a list of audio stems into a single 44.1kHz stereo AudioBuffer suitable
 * for runDemucsInWorker. Used when a chart's bundled vocal stem produced a
 * low-confidence alignment and we want to fall back to AI separation against
 * a reconstructed full mix.
 *
 * Each stem is decoded (codec is whatever the browser supports), resampled to
 * 44.1kHz by OfflineAudioContext, and summed at the destination. A 1/√N gain
 * keeps loudness ~stable so Demucs sees a sane signal level regardless of
 * stem count.
 */
export async function mixStemsToAudioBuffer(
  stems: Array<{data: Uint8Array; mimeType: string}>,
): Promise<AudioBuffer> {
  if (stems.length === 0) {
    throw new Error('mixStemsToAudioBuffer: no stems');
  }

  const decoded = await Promise.all(
    stems.map(async s => {
      const blob = new Blob([s.data as Uint8Array<ArrayBuffer>], {
        type: s.mimeType,
      });
      const arrayBuffer = await blob.arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, 44100);
      return ctx.decodeAudioData(arrayBuffer);
    }),
  );

  const numSamples = Math.max(
    ...decoded.map(b => Math.ceil(b.duration * 44100)),
  );
  const ctx = new OfflineAudioContext(2, numSamples, 44100);
  const stemGain = 1 / Math.sqrt(decoded.length);
  for (const buf of decoded) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = stemGain;
    src.connect(gain).connect(ctx.destination);
    src.start(0);
  }
  return ctx.startRendering();
}
