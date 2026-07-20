/**
 * Audio decoding module for the drum transcription pipeline.
 *
 * Decodes any browser-supported audio format (MP3, WAV, FLAC, OGG, AAC, M4A,
 * WebM, etc.) into raw PCM at 44.1kHz stereo, using the same forced-native-
 * rate decode + libsoxr resample recipe as the /tempo pipeline
 * (`@/lib/audio-pipeline/decode-audio`), so identical input bytes produce
 * byte-identical 44.1kHz PCM into the stem separator on both pages.
 *
 * The decoded audio is stored as interleaved Float32 PCM in OPFS for
 * consumption by the BS-Roformer stem separation pipeline.
 */

import {decodeAndResampleTo44k} from '@/lib/audio-pipeline/decode-audio';
import {TARGET_CHANNELS} from './types';

/**
 * Decodes an ArrayBuffer of audio data into an AudioBuffer at 44.1kHz stereo.
 *
 * Mono sources are preserved (mono-to-stereo conversion happens during
 * interleaving).
 *
 * @throws {Error} If the audio data cannot be decoded (unsupported format, corrupt file).
 */
export async function decodeAudio(
  arrayBuffer: ArrayBuffer,
): Promise<AudioBuffer> {
  try {
    return await decodeAndResampleTo44k(arrayBuffer);
  } catch (err) {
    throw new Error(
      `Failed to decode audio. The file may be corrupt or in an unsupported format. ` +
        `Supported formats: MP3, WAV, OGG, FLAC, AAC, M4A, WebM. ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
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
