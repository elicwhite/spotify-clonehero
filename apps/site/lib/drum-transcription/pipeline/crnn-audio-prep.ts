/**
 * Resamples a planar stereo drum stem (44.1 kHz, the separator's output
 * rate) to interleaved stereo at 48 kHz, the rate the stereo CRNN expects.
 *
 * Shared by drum-transcription's runner.ts (loading a stem back out of OPFS)
 * and /tempo's tempo-track.ts (consuming the tempo pipeline worker's
 * in-memory separation output directly) so both run CRNN on audio prepared
 * the exact same way.
 */

import {resampleSoxr} from '@/lib/tempo-map/resampler-soxr';

/** Sample rate the stereo CRNN model expects (mel: 1024 FFT / 480 hop). */
export const CRNN_SAMPLE_RATE = 48000;

export async function planarStereoToCrnnInput(
  left44k: Float32Array,
  right44k: Float32Array,
  fromSampleRate = 44100,
): Promise<Float32Array> {
  const [left, right] = await Promise.all([
    resampleSoxr(left44k, fromSampleRate, CRNN_SAMPLE_RATE),
    resampleSoxr(right44k, fromSampleRate, CRNN_SAMPLE_RATE),
  ]);
  const n = Math.min(left.length, right.length);
  const stereo = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    stereo[i * 2] = left[i];
    stereo[i * 2 + 1] = right[i];
  }
  return stereo;
}
