/**
 * Opus encoding via the WebCodecs `AudioEncoder`.
 *
 * Takes interleaved Float32 PCM (any sample rate), resamples it to Opus's
 * native 48 kHz, encodes with the browser's hardware/native Opus encoder, and
 * muxes the raw packets into a playable Ogg Opus (`.opus`) file.
 *
 * Browser-only: requires WebCodecs (`AudioEncoder`, `AudioData`) and
 * `OfflineAudioContext`. Guard call sites with {@link isOpusEncodeSupported}.
 */

import {muxOggOpus, type OpusPacket} from './ogg-opus';

/** Opus always decodes at 48 kHz; encode input must be resampled to it. */
const OPUS_SAMPLE_RATE = 48000;

/** Feature detection for Opus encoding (WebCodecs AudioEncoder + AudioData). */
export function isOpusEncodeSupported(): boolean {
  return (
    typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined'
  );
}

/**
 * Resample interleaved PCM to 48 kHz using an OfflineAudioContext and return
 * the per-channel planar Float32 data.
 */
async function resampleTo48k(
  interleaved: Float32Array,
  sourceRate: number,
  channels: number,
): Promise<Float32Array[]> {
  const frameCount = Math.floor(interleaved.length / channels);

  const buildPlanar = (buffer: AudioBuffer): Float32Array[] =>
    Array.from({length: channels}, (_, ch) =>
      // Copy out of the AudioBuffer so the data survives the context.
      Float32Array.from(
        buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1)),
      ),
    );

  // Deinterleave into an AudioBuffer at the source rate.
  const sourceCtx = new OfflineAudioContext({
    numberOfChannels: channels,
    length: Math.max(1, frameCount),
    sampleRate: sourceRate,
  });
  const sourceBuffer = sourceCtx.createBuffer(
    channels,
    Math.max(1, frameCount),
    sourceRate,
  );
  for (let ch = 0; ch < channels; ch++) {
    const chData = sourceBuffer.getChannelData(ch);
    for (let i = 0; i < frameCount; i++) {
      chData[i] = interleaved[i * channels + ch];
    }
  }

  if (sourceRate === OPUS_SAMPLE_RATE) {
    return buildPlanar(sourceBuffer);
  }

  // Render through a 48 kHz context to resample.
  const targetLength = Math.max(
    1,
    Math.ceil((frameCount * OPUS_SAMPLE_RATE) / sourceRate),
  );
  const ctx = new OfflineAudioContext({
    numberOfChannels: channels,
    length: targetLength,
    sampleRate: OPUS_SAMPLE_RATE,
  });
  const src = ctx.createBufferSource();
  src.buffer = sourceBuffer;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return buildPlanar(rendered);
}

export interface EncodeOpusOptions {
  /** Target bitrate in bits/sec. Default 128 kbps (good stereo quality). */
  bitrate?: number;
}

/**
 * Encode interleaved Float32 PCM into an Ogg Opus file.
 *
 * @param interleaved Interleaved PCM samples (channel-interleaved).
 * @param sampleRate  Sample rate of the input PCM.
 * @param channels    Channel count of the input PCM.
 * @returns The `.opus` file bytes.
 * @throws If WebCodecs Opus encoding is unavailable or the encoder errors.
 */
export async function encodePcmToOpus(
  interleaved: Float32Array,
  sampleRate: number,
  channels: number,
  options: EncodeOpusOptions = {},
): Promise<Uint8Array> {
  if (!isOpusEncodeSupported()) {
    throw new Error('Opus encoding is not supported in this browser.');
  }

  const bitrate = options.bitrate ?? 128000;
  const planar = await resampleTo48k(interleaved, sampleRate, channels);
  const totalFrames = planar[0]?.length ?? 0;

  const chunks: {bytes: Uint8Array; durationUs: number}[] = [];
  let encodeError: Error | null = null;

  const encoder = new AudioEncoder({
    output: chunk => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      chunks.push({bytes, durationUs: chunk.duration ?? 0});
    },
    error: err => {
      encodeError = err instanceof Error ? err : new Error(String(err));
    },
  });

  encoder.configure({
    codec: 'opus',
    sampleRate: OPUS_SAMPLE_RATE,
    numberOfChannels: channels,
    bitrate,
  });

  // Feed the resampled audio in 1-second AudioData frames.
  const chunkFrames = OPUS_SAMPLE_RATE;
  for (let start = 0; start < totalFrames; start += chunkFrames) {
    const n = Math.min(chunkFrames, totalFrames - start);
    const frameData = new Float32Array(n * channels);
    for (let ch = 0; ch < channels; ch++) {
      frameData.set(planar[ch].subarray(start, start + n), ch * n);
    }
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate: OPUS_SAMPLE_RATE,
      numberOfFrames: n,
      numberOfChannels: channels,
      timestamp: Math.round((start / OPUS_SAMPLE_RATE) * 1e6),
      data: frameData,
    });
    encoder.encode(audioData);
    audioData.close();
  }

  await encoder.flush();
  encoder.close();

  if (encodeError) throw encodeError;

  // Assign cumulative granule positions (48 kHz sample counts). If a browser
  // omits the chunk duration, fall back to a standard 20 ms Opus frame so the
  // granule (and thus the file's reported duration) stays monotonic and sane.
  const DEFAULT_FRAME_SAMPLES = 960; // 20 ms at 48 kHz
  let cumulativeSamples = 0;
  const packets: OpusPacket[] = chunks.map(({bytes, durationUs}) => {
    const frameSamples =
      durationUs > 0
        ? Math.round((durationUs / 1e6) * OPUS_SAMPLE_RATE)
        : DEFAULT_FRAME_SAMPLES;
    cumulativeSamples += frameSamples;
    return {data: bytes, granulePosition: cumulativeSamples};
  });

  return muxOggOpus({
    channelCount: channels,
    preSkip: 0,
    inputSampleRate: sampleRate,
    packets,
  });
}
