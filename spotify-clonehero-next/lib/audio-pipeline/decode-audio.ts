/**
 * Shared decode-to-44.1kHz recipe used before stem separation.
 *
 * Decoding at the source's native rate matters: forcing an
 * OfflineAudioContext to a different rate routes the audio through Web
 * Audio's lossy resampler before any of our (libsoxr) resampling runs,
 * which measurably drifts model logits. Most chart audio is opus, which
 * decodes natively at 48 kHz.
 */

import {resampleSoxr} from '@/lib/tempo-map/resampler-soxr';

export async function decodeNativeRate(data: Uint8Array): Promise<AudioBuffer> {
  // Probe context just to learn the file's natural decode rate is not
  // possible with Web Audio — decodeAudioData resamples to the context rate.
  // Opus/webm/ogg decode natively at 48k; mp3/wav usually 44.1k. Use 48k for
  // opus/ogg containers and 44.1k otherwise, which avoids the implicit
  // resample for the dominant cases.
  const u8 = data;
  const isOgg =
    u8.length >= 4 &&
    u8[0] === 0x4f &&
    u8[1] === 0x67 &&
    u8[2] === 0x67 &&
    u8[3] === 0x53;
  const rate = isOgg ? 48000 : 44100;
  const ctx = new OfflineAudioContext(2, 1, rate);
  // Copy into a fresh ArrayBuffer — decodeAudioData detaches the buffer.
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  return ctx.decodeAudioData(buf as ArrayBuffer);
}

/**
 * Decode arbitrary audio bytes and resample to 44.1kHz using the same
 * recipe as the /tempo pipeline (forced-native-rate decode + libsoxr
 * per-channel resample), so both pages feed the stem separator
 * byte-identical 44.1kHz PCM for identical input bytes. Channel count is
 * preserved (mono stays mono; surround is capped to stereo).
 */
export async function decodeAndResampleTo44k(
  data: ArrayBuffer | Uint8Array,
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
    [resampledLeft, resampledRight] = await Promise.all([
      resampleSoxr(left, decoded.sampleRate, 44100),
      resampleSoxr(right, decoded.sampleRate, 44100),
    ]);
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
