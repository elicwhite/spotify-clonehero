/**
 * Main-thread client for the tempo-mapping pipeline worker. Spawns a worker,
 * runs the pipeline on an AudioBuffer, then terminates the worker to reclaim
 * WASM/GPU memory.
 */

import type {
  PipelineProgress,
  PipelineResult,
  PipelineWorkerMessage,
} from './types';

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function runTempoPipeline(
  audioBuffer: AudioBuffer,
  options: {
    /** Raw source bytes; hashed for the OPFS drum-stem cache. */
    sourceBytes?: ArrayBuffer | null;
    onProgress?: (p: PipelineProgress) => void;
  } = {},
): Promise<PipelineResult> {
  const sourceHash = options.sourceBytes
    ? await sha256Hex(options.sourceBytes)
    : null;

  const left = audioBuffer.getChannelData(0).slice();
  const right =
    audioBuffer.numberOfChannels > 1
      ? audioBuffer.getChannelData(1).slice()
      : left.slice();

  return new Promise<PipelineResult>((resolve, reject) => {
    const worker = new Worker(
      new URL('./pipeline-worker.ts', import.meta.url),
      {
        type: 'module',
      },
    );

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as PipelineWorkerMessage;
      if (msg.type === 'progress') {
        const {type: _type, ...p} = msg;
        options.onProgress?.(p);
      } else if (msg.type === 'result') {
        worker.terminate();
        resolve(msg.result);
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = e => {
      worker.terminate();
      reject(new Error(e.message || 'Tempo pipeline worker error'));
    };

    worker.postMessage(
      {
        type: 'run',
        left,
        right,
        sampleRate: audioBuffer.sampleRate,
        sourceHash,
      },
      [left.buffer, right.buffer],
    );
  });
}
