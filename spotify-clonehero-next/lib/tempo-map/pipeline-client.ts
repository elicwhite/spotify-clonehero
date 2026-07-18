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

export interface TempoPipelineOptions {
  /** Raw source bytes; hashed for the OPFS drum-stem cache. */
  sourceBytes?: ArrayBuffer | null;
  /**
   * Pre-separated drum stem, planar stereo at 44.1 kHz. When provided,
   * the worker skips BS-Roformer separation and echoes the stem back in
   * the result. The buffers are transferred to the worker (detached for
   * the caller) — consume `PipelineResult.drumStemStereo` afterwards.
   */
  drumStemStereo?: {left: Float32Array; right: Float32Array} | null;
  onProgress?: (p: PipelineProgress) => void;
}

export async function runTempoPipeline(
  audioBuffer: AudioBuffer,
  options: TempoPipelineOptions = {},
): Promise<PipelineResult> {
  const left = audioBuffer.getChannelData(0).slice();
  const right =
    audioBuffer.numberOfChannels > 1
      ? audioBuffer.getChannelData(1).slice()
      : left.slice();
  return runTempoPipelineFromPcm(
    {left, right, sampleRate: audioBuffer.sampleRate},
    options,
  );
}

/**
 * Planar-PCM entry point for callers that don't hold an AudioBuffer (e.g.
 * the drum-transcription pipeline resuming from OPFS-stored PCM).
 * `left`/`right` buffers are transferred to the worker (detached for the
 * caller), so pass copies if you still need them.
 */
export async function runTempoPipelineFromPcm(
  input: {left: Float32Array; right: Float32Array; sampleRate: number},
  options: TempoPipelineOptions = {},
): Promise<PipelineResult> {
  const sourceHash = options.sourceBytes
    ? await sha256Hex(options.sourceBytes)
    : null;

  const {left, right, sampleRate} = input;
  const drumStemStereo = options.drumStemStereo ?? null;

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

    const transfer: Transferable[] = [left.buffer, right.buffer];
    if (drumStemStereo) {
      // Dedupe: the two channels may be views over one shared buffer.
      for (const buf of new Set([
        drumStemStereo.left.buffer,
        drumStemStereo.right.buffer,
      ])) {
        transfer.push(buf);
      }
    }
    worker.postMessage(
      {
        type: 'run',
        left,
        right,
        sampleRate,
        sourceHash,
        drumStemStereo,
      },
      transfer,
    );
  });
}
