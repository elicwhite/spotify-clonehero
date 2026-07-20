/**
 * Prepend digital silence to interleaved PCM (plan 0064 editor-button
 * addendum §5) — used to pad in-memory audio buffers (full mix, drum stem,
 * vocals stem) by the chart's `audioAnchor` before WAV-encoding or
 * Opus-encoding them, so in-session playback and export match the chart's
 * shifted event timing.
 */

/**
 * Return a new interleaved PCM buffer with `padSamples` frames of silence
 * prepended, followed by `pcm` unchanged. `padSamples` is a per-channel
 * frame count (the prepended region is `padSamples * channels` floats of
 * `0`). `padSamples <= 0` returns `pcm` unchanged (same reference).
 */
export function padPcmStart(
  pcm: Float32Array,
  padSamples: number,
  channels: number,
): Float32Array {
  if (padSamples <= 0) return pcm;
  const padFloats = padSamples * channels;
  const out = new Float32Array(padFloats + pcm.length);
  out.set(pcm, padFloats);
  return out;
}
