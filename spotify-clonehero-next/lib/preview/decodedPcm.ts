/**
 * The `AudioBuffer` a given interleaved PCM buffer was produced from.
 *
 * Audio in this app is routinely decoded once and then interleaved for the
 * code that works on samples — waveform peaks, leading-silence padding, a
 * re-encoded export. `AudioManager` then needs it back as an `AudioBuffer` to
 * play it, and de-interleaving a quarter of a billion samples to rebuild the
 * buffer they just came out of is seconds of an album-length song's load.
 * Registering the pair here lets that step be skipped entirely.
 *
 * Keyed by the PCM's identity, which is what makes it safe: only the code
 * that interleaved a specific `AudioBuffer` into a specific `Float32Array`
 * registers the pair, and anything that pads or otherwise rewrites those
 * samples produces a NEW array, which simply isn't in here.
 *
 * A miss on lookup only costs the de-interleave it was avoiding, but a
 * REGISTRATION is not free: the map is weak in its key, so the buffer stays
 * reachable for as long as the PCM does — and the PCM is retained for the
 * whole editing session. That is a second full copy of the song's samples,
 * around a gigabyte on an album-length chart, so a caller that knows these
 * samples will not be played must {@link forgetDecodedBuffer} them.
 */
const decodedBufferForPcm = new WeakMap<Float32Array, AudioBuffer>();

/** Record that `pcm` is exactly `buffer`'s samples, interleaved. */
export function rememberDecodedBuffer(
  pcm: Float32Array,
  buffer: AudioBuffer,
): void {
  decodedBufferForPcm.set(pcm, buffer);
}

/**
 * The same pairing, the other way round: what a decoded buffer's samples
 * already look like interleaved.
 *
 * Reading a track's PCM back out of Web Audio means allocating a second copy
 * of the whole song and interleaving into it — over a second on an
 * album-length chart, and pure waste when the interleaved form is the thing
 * the buffer was built from in the first place.
 */
const interleavedForBuffer = new WeakMap<
  AudioBuffer,
  {data: Float32Array; channels: number}
>();

/**
 * Record `pcm` as `buffer`'s interleaved form, for the reverse lookup.
 *
 * Only when the two genuinely describe each other. They don't always: the
 * decoder upmixes a mono source to stereo PCM, and an empty track still gets
 * the one frame Web Audio insists on. Pairing either would hand a later
 * reader samples that misdescribe what is playing, so a mismatch is left
 * unrecorded and the reader falls back to reading the buffer itself.
 */
export function rememberInterleaved(
  buffer: AudioBuffer,
  pcm: Float32Array,
  channels: number,
): void {
  if (buffer.numberOfChannels !== channels) return;
  if (Math.floor(pcm.length / channels) !== buffer.length) return;
  interleavedForBuffer.set(buffer, {data: pcm, channels});
}

/**
 * `buffer`'s samples in interleaved form, when they are already known.
 *
 * SHARED, not a copy: this is the caller's own PCM coming back to it, and the
 * whole point is not to duplicate a gigabyte. Read-only.
 */
export function interleavedPcmFor(
  buffer: AudioBuffer,
): {data: Float32Array; channels: number} | undefined {
  return interleavedForBuffer.get(buffer);
}

/** Release the buffer registered for `pcm`, for a caller that has established
 *  nothing will play these exact samples. A no-op if none was registered. */
export function forgetDecodedBuffer(pcm: Float32Array): void {
  decodedBufferForPcm.delete(pcm);
}

/**
 * The buffer `pcm` was interleaved out of, when it is still around AND
 * genuinely describes the format the caller is asking for.
 *
 * The format check is not paranoia: the interleaver upmixes a mono source to
 * stereo, so a mono file's PCM has twice the samples of the one-channel
 * buffer it came from and must be rebuilt rather than reused.
 */
export function decodedBufferFor(
  pcm: Float32Array,
  sampleRate: number,
  channels: number,
): AudioBuffer | undefined {
  const buffer = decodedBufferForPcm.get(pcm);
  return buffer &&
    buffer.sampleRate === sampleRate &&
    buffer.numberOfChannels === channels
    ? buffer
    : undefined;
}
