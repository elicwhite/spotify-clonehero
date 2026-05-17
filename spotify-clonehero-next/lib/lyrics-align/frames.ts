/**
 * Exact wav2vec2-base feature-extractor output length for a given sample
 * count. The conv stack (kernels [10,3,3,3,3,2,2], strides [5,2,2,2,2,2,2])
 * is deterministic, so this matches the model's emitted frame count exactly
 * — used to trim emissions back after fixed-size padding on the WebGPU path.
 */
export function wav2vecFrames(samples: number): number {
  const kernels = [10, 3, 3, 3, 3, 2, 2];
  const strides = [5, 2, 2, 2, 2, 2, 2];
  let len = samples;
  for (let i = 0; i < kernels.length; i++) {
    len = Math.floor((len - kernels[i]) / strides[i]) + 1;
  }
  return Math.max(0, len);
}
