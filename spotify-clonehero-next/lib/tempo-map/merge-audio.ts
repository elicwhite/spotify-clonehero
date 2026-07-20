import type {Files} from '@/lib/preview/chorus-chart-processing';
import {decodeNativeRate} from '@/lib/audio-pipeline/decode-audio';

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
