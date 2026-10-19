/**
 * Beat This! ONNX runner.
 *
 * Port of beat_this.inference.split_predict_aggregate: split the mel into
 * 1500-frame chunks with a 6-frame discarded border, run the model on each
 * chunk, and stitch logits with "keep_first" overlap handling (process in
 * reverse so earlier chunk predictions overwrite later overlaps).
 *
 * The session must be created on the **wasm** EP (CPU fp32): the WebGPU EP
 * silently computes this transformer in fp16, drifting logits by ~1 unit
 * versus Python beat_this.
 */

import type * as ortTypes from 'onnxruntime-web';

const CHUNK_SIZE = 1500; // beat_this default chunk size (frames)
const BORDER_SIZE = 6; // frames discarded at each chunk edge

/**
 * Generate (start, paddedChunk) pairs matching beat_this split_piece with
 * avoid_short_end=True. `mel` is flat Float32Array of length T*128.
 */
function splitPiece(mel: Float32Array, T: number, nMels = 128) {
  const starts: number[] = [];
  for (
    let s = -BORDER_SIZE;
    s < T - BORDER_SIZE;
    s += CHUNK_SIZE - 2 * BORDER_SIZE
  ) {
    starts.push(s);
  }
  if (T > CHUNK_SIZE - 2 * BORDER_SIZE) {
    starts[starts.length - 1] = T - (CHUNK_SIZE - BORDER_SIZE);
  }
  const chunks = starts.map(start => {
    const out = new Float32Array(CHUNK_SIZE * nMels);
    const srcLo = Math.max(start, 0);
    const srcHi = Math.min(start + CHUNK_SIZE, T);
    const leftPad = Math.max(0, -start);
    for (let i = 0; i < srcHi - srcLo; i++) {
      const srcRow = (srcLo + i) * nMels;
      const dstRow = (leftPad + i) * nMels;
      for (let m = 0; m < nMels; m++) out[dstRow + m] = mel[srcRow + m];
    }
    return out;
  });
  return {starts, chunks};
}

/**
 * Run Beat This! on a precomputed log-mel; returns raw frame-wise logits.
 */
export async function runBeatThisOnnx({
  ort,
  session,
  mel,
  T,
  nMels = 128,
  onChunk,
}: {
  ort: typeof ortTypes;
  session: ortTypes.InferenceSession;
  mel: Float32Array;
  T: number;
  nMels?: number;
  onChunk?: (done: number, total: number) => void;
}): Promise<{beatLogits: Float32Array; downbeatLogits: Float32Array}> {
  const {starts, chunks} = splitPiece(mel, T, nMels);

  const beatLogits = new Float32Array(T).fill(-1000);
  const downbeatLogits = new Float32Array(T).fill(-1000);

  const order = chunks.map((_, i) => i).reverse(); // keep_first
  let done = 0;
  for (const i of order) {
    const start = starts[i];
    const chunk = chunks[i];
    const t = new ort.Tensor('float32', chunk, [1, CHUNK_SIZE, nMels]);
    const out = await session.run({input_spectrogram: t});
    t.dispose();
    const beat = out['beat'].data as Float32Array;
    const downbeat = out['downbeat'].data as Float32Array;
    // shape [1, CHUNK_SIZE]; keep [BORDER, CHUNK-BORDER) clamped into [0, T)
    const lo = start + BORDER_SIZE;
    const srcLo = BORDER_SIZE;
    const srcHi = CHUNK_SIZE - BORDER_SIZE;
    for (let j = 0; j < srcHi - srcLo; j++) {
      const tIdx = lo + j;
      if (tIdx < 0 || tIdx >= T) continue;
      beatLogits[tIdx] = beat[srcLo + j];
      downbeatLogits[tIdx] = downbeat[srcLo + j];
    }
    out['beat'].dispose();
    out['downbeat'].dispose();
    done++;
    onChunk?.(done, chunks.length);
  }

  return {beatLogits, downbeatLogits};
}
