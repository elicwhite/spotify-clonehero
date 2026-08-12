/**
 * Shared decode-to-44.1kHz recipe used before stem separation.
 *
 * Decoding at the source's native rate matters: forcing an
 * OfflineAudioContext to a different rate routes the audio through Web
 * Audio's lossy resampler before any of our (libsoxr) resampling runs,
 * which measurably drifts model logits. Most chart audio is opus, which
 * decodes natively at 48 kHz.
 *
 * The forced rate is also the slow one, by a wide margin: on an album-length
 * opus, decoding at 48 kHz takes about half as long as asking the same
 * decoder for 44.1 kHz. A caller that only wants audio to PLAY should decode
 * at the native rate ({@link nativeDecodeRate} + {@link decodeAtRate}) and
 * keep it there — {@link decodeAndResampleTo44k} exists for the pipelines
 * that need one fixed rate to feed a model.
 */

import {
  resampleStereoInWorker,
  type PcmWorkerOptions,
} from '@/lib/audio-pipeline/pcm-client';

/**
 * The rate `data` decodes at with no implicit resample.
 *
 * A probe context, just to learn the file's natural decode rate, is not
 * possible with Web Audio — `decodeAudioData` always resamples to the
 * context rate. Opus/webm/ogg decode natively at 48k; mp3/wav usually
 * 44.1k, so the container's magic bytes decide.
 */
export function nativeDecodeRate(data: Uint8Array): number {
  const isOgg =
    data.length >= 4 &&
    data[0] === 0x4f &&
    data[1] === 0x67 &&
    data[2] === 0x67 &&
    data[3] === 0x53;
  return isOgg ? 48000 : 44100;
}

/** Decode `data` into an `AudioBuffer` at exactly `rate`, resampling through
 *  Web Audio's own decoder when the source isn't already there. */
export async function decodeAtRate(
  data: Uint8Array,
  rate: number,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, 1, rate);
  // Copy into a fresh ArrayBuffer — decodeAudioData detaches the buffer.
  const buf = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  );
  return ctx.decodeAudioData(buf as ArrayBuffer);
}

export function decodeNativeRate(data: Uint8Array): Promise<AudioBuffer> {
  return decodeAtRate(data, nativeDecodeRate(data));
}

/**
 * Decode arbitrary audio bytes and resample to 44.1kHz using the same
 * recipe as the /tempo pipeline (forced-native-rate decode + libsoxr
 * per-channel resample), so both pages feed the stem separator
 * byte-identical 44.1kHz PCM for identical input bytes. Channel count is
 * preserved (mono stays mono; surround is capped to stereo).
 *
 * `decodeAudioData` already does its work off the main thread, but libsoxr
 * does not: one `resampleSoxr` call blocks its thread for the whole signal.
 * The resample therefore runs in `pcm-worker.ts`, which is why this takes an
 * optional worker factory / abort signal.
 */
export async function decodeAndResampleTo44k(
  data: ArrayBuffer | Uint8Array,
  options: PcmWorkerOptions = {},
): Promise<AudioBuffer> {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const decoded = await decodeNativeRate(u8);

  if (decoded.numberOfChannels === 0) {
    throw new Error('Audio file contains no audio channels.');
  }
  const channels = Math.min(decoded.numberOfChannels, 2);

  const left = decoded.getChannelData(0);
  const right = channels > 1 ? decoded.getChannelData(1) : left;

  let resampledLeft: Float32Array;
  let resampledRight: Float32Array;
  if (decoded.sampleRate === 44100) {
    resampledLeft = left.slice();
    resampledRight = right.slice();
  } else {
    // Copies: AudioBuffer channel views can't be transferred to the worker.
    const resampled = await resampleStereoInWorker(
      left.slice(),
      right.slice(),
      decoded.sampleRate,
      44100,
      options,
    );
    resampledLeft = resampled.left;
    resampledRight = resampled.right;
  }

  const out = new AudioBuffer({
    numberOfChannels: channels,
    length: resampledLeft.length,
    sampleRate: 44100,
  });
  out.copyToChannel(new Float32Array(resampledLeft), 0);
  if (channels > 1) out.copyToChannel(new Float32Array(resampledRight), 1);
  return out;
}
