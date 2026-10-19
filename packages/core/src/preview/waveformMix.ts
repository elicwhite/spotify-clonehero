/**
 * Mix decoded audio stems into a single interleaved stereo PCM buffer for
 * waveform visualization (transport WaveformDisplay + highway
 * WaveformSurface). Charts frequently ship one file per stem
 * (guitar/bass/drums/song…); a waveform of just one of them misrepresents
 * the song, so all decodable stems are summed.
 */

import {runSliced} from '../sliced-work';

/** Per-channel sample data of one decoded audio file. Matches what an
 *  AudioBuffer yields via getChannelData(), but kept structural so the
 *  mixer is testable outside the browser. */
export interface DecodedStem {
  channelData: Float32Array[];
}

/**
 * Sum stems into interleaved stereo. Mono stems feed both channels;
 * multi-channel stems contribute channel 0 to the left and the last
 * channel to the right. Output length covers the longest stem. When the
 * summed signal clips (|sample| > 1), the whole mix is scaled down by the
 * peak so relative dynamics survive.
 *
 * Returns null when there is nothing to mix.
 */
export function mixToInterleavedStereo(
  stems: DecodedStem[],
): {data: Float32Array; channels: 2} | null {
  const usable = stems.filter(s => s.channelData.length > 0);
  if (usable.length === 0) return null;

  const length = Math.max(...usable.map(s => s.channelData[0].length));
  const data = new Float32Array(length * 2);

  for (const stem of usable) {
    const left = stem.channelData[0];
    const right = stem.channelData[stem.channelData.length - 1];
    for (let i = 0; i < left.length; i++) {
      data[i * 2] += left[i];
      data[i * 2 + 1] += right[i];
    }
  }

  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  if (peak > 1) {
    const scale = 1 / peak;
    for (let i = 0; i < data.length; i++) {
      data[i] *= scale;
    }
  }

  return {data, channels: 2};
}

/**
 * {@link mixToInterleavedStereo} for stems that are already interleaved in
 * one shared layout — a chart package's files, which the editor decodes to
 * interleaved stereo at a single rate. Same rules: the sum covers the
 * longest stem, and a sum that clips is scaled down by its peak.
 *
 * Runs in slices that yield to the event loop ({@link runSliced}): the
 * editor sums a package while it is already open, and a whole song of stems
 * in one go would stall the highway.
 */
export async function mixInterleavedYielding(
  stems: readonly Float32Array[],
): Promise<Float32Array> {
  const length = Math.max(0, ...stems.map(stem => stem.length));
  const mix = new Float32Array(length);
  let peak = 0;
  await runSliced(length, (from, to) => {
    for (const stem of stems) {
      const end = Math.min(to, stem.length);
      for (let i = from; i < end; i++) mix[i] += stem[i];
    }
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(mix[i]));
  });
  if (peak > 1) {
    const scale = 1 / peak;
    await runSliced(length, (from, to) => {
      for (let i = from; i < to; i++) mix[i] *= scale;
    });
  }
  return mix;
}
