/**
 * Audio decoding module for the drum transcription pipeline.
 *
 * Uses the Web Audio API to decode any browser-supported audio format
 * (MP3, WAV, FLAC, OGG, AAC, M4A, WebM, etc.) into raw PCM at 44.1kHz stereo.
 *
 * The decoded audio is stored as interleaved Float32 PCM in OPFS for
 * consumption by the Demucs stem separation pipeline.
 */

import {TARGET_SAMPLE_RATE, TARGET_CHANNELS} from './types';

/**
 * Decodes an ArrayBuffer of audio data into an AudioBuffer at 44.1kHz stereo.
 *
 * - If the source is already 44.1kHz, it is returned as-is.
 * - If the source has a different sample rate, it is resampled via OfflineAudioContext.
 * - Mono sources are preserved (mono-to-stereo conversion happens during interleaving).
 *
 * @throws {Error} If the audio data cannot be decoded (unsupported format, corrupt file).
 */
export async function decodeAudio(
  arrayBuffer: ArrayBuffer,
): Promise<AudioBuffer> {
  // AudioContext is needed to decode audio data. We create a temporary one
  // and close it after decoding to avoid leaking resources.
  const tempCtx = new AudioContext();
  let decoded: AudioBuffer;

  try {
    decoded = await tempCtx.decodeAudioData(arrayBuffer);
  } catch (err) {
    await tempCtx.close();
    throw new Error(
      `Failed to decode audio. The file may be corrupt or in an unsupported format. ` +
        `Supported formats: MP3, WAV, OGG, FLAC, AAC, M4A, WebM. ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }

  await tempCtx.close();

  if (decoded.numberOfChannels === 0) {
    throw new Error('Audio file contains no audio channels.');
  }

  // Resample to 44.1kHz if needed using OfflineAudioContext
  if (decoded.sampleRate !== TARGET_SAMPLE_RATE) {
    return resampleAudio(decoded);
  }

  return decoded;
}

/**
 * Resamples an AudioBuffer to the target sample rate (44.1kHz) using
 * OfflineAudioContext.
 */
async function resampleAudio(source: AudioBuffer): Promise<AudioBuffer> {
  const outputChannels = Math.min(source.numberOfChannels, TARGET_CHANNELS);
  const outputLength = Math.ceil(source.duration * TARGET_SAMPLE_RATE);

  const offlineCtx = new OfflineAudioContext(
    outputChannels,
    outputLength,
    TARGET_SAMPLE_RATE,
  );

  const bufferSource = offlineCtx.createBufferSource();
  bufferSource.buffer = source;
  bufferSource.connect(offlineCtx.destination);
  bufferSource.start();

  return offlineCtx.startRendering();
}

/**
 * Interleaves an AudioBuffer's channels into a single Float32Array.
 *
 * For stereo: [L0, R0, L1, R1, ...]
 * For mono: duplicates to stereo [S0, S0, S1, S1, ...]
 *
 * The output always has TARGET_CHANNELS (2) channels interleaved.
 */
export function interleaveAudioBuffer(audioBuffer: AudioBuffer): Float32Array {
  const numSamples = audioBuffer.length;
  const interleaved = new Float32Array(numSamples * TARGET_CHANNELS);

  const left = audioBuffer.getChannelData(0);
  const right =
    audioBuffer.numberOfChannels >= 2 ? audioBuffer.getChannelData(1) : left; // Mono: duplicate left channel

  for (let i = 0; i < numSamples; i++) {
    interleaved[i * 2] = left[i];
    interleaved[i * 2 + 1] = right[i];
  }

  return interleaved;
}
