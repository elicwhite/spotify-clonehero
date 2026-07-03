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
   * Pre-separated MONO drum stem at 44.1 kHz (mean of the stereo stem's
   * channels). When provided, the worker skips BS-Roformer separation.
   * The buffer is transferred to the worker (detached for the caller).
   */
  drumStemMono?: Float32Array | null;
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
  const drumStem = options.drumStemMono ?? null;

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
    if (drumStem) transfer.push(drumStem.buffer);
    worker.postMessage(
      {
        type: 'run',
        left,
        right,
        sampleRate,
        sourceHash,
        drumStem,
      },
      transfer,
    );
  });
}
