/**
 * Decode one or more audio files into a single stereo AudioBuffer at the
 * source's native sample rate.
 *
 * Decoding at the native rate matters: forcing an OfflineAudioContext to a
 * different rate routes the audio through Web Audio's lossy resampler before
 * any of our (libsoxr) resampling runs, which measurably drifts Beat This!
 * logits. Most chart audio is opus, which decodes natively at 48 kHz.
 */

import type {Files} from '@/lib/preview/chorus-chart-processing';

async function decodeNativeRate(data: Uint8Array): Promise<AudioBuffer> {
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
 * Decode and mix the given audio files into one stereo AudioBuffer (sum of
 * stems, clipped softly by 1/sqrt(n) gain like a rough loudness-preserving
 * mixdown). Single files pass through without re-rendering.
 */
export async function mergeAudioFiles(files: Files): Promise<AudioBuffer> {
  if (files.length === 0) throw new Error('mergeAudioFiles: no audio files');

  const decoded = await Promise.all(files.map(f => decodeNativeRate(f.data)));
  if (decoded.length === 1) return decoded[0];

  const rate = decoded[0].sampleRate;
  const numSamples = Math.max(
    ...decoded.map(b => Math.ceil((b.duration + 0.05) * rate)),
  );
  const ctx = new OfflineAudioContext(2, numSamples, rate);
  const gainValue = 1 / Math.sqrt(decoded.length);
  for (const buf of decoded) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    src.connect(gain).connect(ctx.destination);
    src.start(0);
  }
  return ctx.startRendering();
}
