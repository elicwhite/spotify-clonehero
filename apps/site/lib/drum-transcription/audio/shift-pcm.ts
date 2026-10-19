/**
 * Shift the start of interleaved PCM (plan 0064 editor-button addendum §5,
 * extended by plan 0124 §2) — used to apply the chart's `audioAnchor` to
 * in-memory audio buffers (full mix, drum stem, vocals stem) before
 * WAV-encoding or Opus-encoding them, so in-session playback and export match
 * the chart's shifted event timing.
 *
 * The anchor is signed. A positive anchor means the chart moved later than
 * the recording and the audio needs silence in front; a negative one means
 * the chart moved earlier and the front of the recording has to come off.
 * The second case is reachable on a chart that arrives with silence already
 * in its audio — imported, or exported by us and opened again — where
 * removing a bar of lead-in has to take the audio with it.
 *
 * Neither case touches the stored audio. Both run on a decoded copy.
 */

/**
 * Return interleaved PCM shifted at the front by `shiftSamples` frames:
 * positive prepends that many frames of digital silence, negative removes
 * that many from the front. `shiftSamples` is a per-channel frame count, so
 * the region added or removed is `|shiftSamples| * channels` floats.
 *
 * Zero returns `pcm` unchanged (same reference), which callers rely on to
 * skip the worker entirely. A trim of more than the buffer holds returns an
 * empty buffer rather than throwing — the caller's bounds are what keep the
 * music safe, and there is no useful audio left to defend at that point.
 */
export function shiftPcmStart(
  pcm: Float32Array,
  shiftSamples: number,
  channels: number,
): Float32Array {
  if (shiftSamples === 0) return pcm;
  const shiftFloats = shiftSamples * channels;
  if (shiftSamples > 0) {
    const out = new Float32Array(shiftFloats + pcm.length);
    out.set(pcm, shiftFloats);
    return out;
  }
  const cut = Math.min(-shiftFloats, pcm.length);
  return pcm.slice(cut);
}
