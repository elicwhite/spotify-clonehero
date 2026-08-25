/**
 * Builds the follower's reference: the song's own recording, as mono PCM at the
 * chroma sample rate.
 *
 * A chart that ships stems has no single file holding the mix — `song.opus`
 * there is the *residual* backing, everything the other stems do not cover. So
 * the mix has to be rebuilt by summing every stem. Crowd and preview tracks are
 * left out: crowd noise is not part of the performance, and preview is a
 * duplicated excerpt that would match in two places at once.
 */

import {decodeAtRate} from '../audio-pipeline/decode-audio';
import {getBasename, hasAudioExtension} from '../src-shared/utils';
import {CHROMA_SAMPLE_RATE} from './chroma';

/** Stems that must not go into the reference mix. */
const EXCLUDED = ['crowd', 'preview'];

export function isReferenceStem(fileName: string): boolean {
  if (!hasAudioExtension(fileName)) return false;
  const base = getBasename(fileName).toLowerCase();
  return !EXCLUDED.some(name => base === name || base.startsWith(`${name}_`));
}

/**
 * Decodes and sums the chart's audio into one mono signal at
 * {@link CHROMA_SAMPLE_RATE}.
 *
 * Decoding has to happen on the main thread — `OfflineAudioContext` does not
 * exist in a worker — but `decodeAudioData` does its own work off-thread, so
 * this yields rather than blocking. The expensive part, the chromagram, is what
 * the worker takes.
 */
export async function buildReferenceAudio(
  files: {fileName: string; data: Uint8Array}[],
): Promise<Float32Array> {
  const stems = files.filter(f => isReferenceStem(f.fileName));
  if (stems.length === 0) {
    throw new Error('This chart has no audio to follow along with.');
  }

  let mix: Float32Array | null = null;
  for (const stem of stems) {
    let buffer: AudioBuffer;
    try {
      buffer = await decodeAtRate(stem.data, CHROMA_SAMPLE_RATE);
    } catch {
      // One unreadable stem should not cost the whole reference; the mix of the
      // others still carries the song's harmony.
      continue;
    }
    const channels = buffer.numberOfChannels;
    if (channels === 0) continue;
    if (mix === null) mix = new Float32Array(buffer.length);
    else if (buffer.length > mix.length) {
      const grown = new Float32Array(buffer.length);
      grown.set(mix);
      mix = grown;
    }
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) mix[i] += data[i] / channels;
    }
  }

  if (mix === null) {
    throw new Error('None of this chart’s audio could be decoded.');
  }

  // Chroma is normalised per frame, so absolute level does not matter — but
  // keeping the mix in range avoids surprises for anything that reuses this.
  let peak = 0;
  for (let i = 0; i < mix.length; i++) {
    const a = Math.abs(mix[i]);
    if (a > peak) peak = a;
  }
  if (peak > 1) {
    for (let i = 0; i < mix.length; i++) mix[i] /= peak;
  }
  return mix;
}
