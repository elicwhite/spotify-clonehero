/**
 * Serialization for the OPFS drum-stem cache (`tempo-map-stem-cache`):
 * a planar stereo stem stored as one Float32Array — the full left channel
 * (N samples) followed by the full right channel (N samples), 2N total.
 * Stereo is required because the CRNN transcriber is a stereo model; a
 * mono-only cache would leave cache-hit runs with nothing to transcribe.
 */

export interface StereoStem {
  left: Float32Array;
  right: Float32Array;
}

/** Pack a planar stereo stem into a single [L‖R] buffer for storage.
 * Channels are truncated to the shorter of the two lengths. */
export function packStereoStem(stem: StereoStem): Float32Array {
  const n = Math.min(stem.left.length, stem.right.length);
  const packed = new Float32Array(n * 2);
  packed.set(stem.left.subarray(0, n), 0);
  packed.set(stem.right.subarray(0, n), n);
  return packed;
}

/**
 * Unpack a stored [L‖R] buffer back into planar stereo. Returns null when
 * the buffer isn't exactly 2×`sampleCount` floats (wrong song length or a
 * corrupt/legacy cache entry).
 */
export function unpackStereoStem(
  packed: Float32Array,
  sampleCount: number,
): StereoStem | null {
  if (packed.length !== sampleCount * 2) return null;
  return {
    left: packed.subarray(0, sampleCount),
    right: packed.subarray(sampleCount),
  };
}

/** Mean-of-channels mono mixdown — the signal Beat This! and the
 * drum-onset stage consume. */
export function stereoStemToMono(stem: StereoStem): Float32Array {
  const n = Math.min(stem.left.length, stem.right.length);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mono[i] = (stem.left[i] + stem.right[i]) * 0.5;
  }
  return mono;
}
