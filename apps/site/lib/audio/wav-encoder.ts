/**
 * WAV audio encoder.
 *
 * Converts Float32 PCM data (interleaved, [-1, 1]) to a standard
 * 16-bit PCM WAV file (RIFF/WAVE format).
 *
 * The 44-byte header follows the canonical WAV format:
 *   - RIFF header (12 bytes)
 *   - fmt  chunk (24 bytes)
 *   - data chunk header (8 bytes)
 *   - PCM sample data
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Write an ASCII string at the given byte offset in a DataView. */
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode interleaved Float32 PCM samples as a 16-bit WAV ArrayBuffer.
 *
 * @param pcmData    - Interleaved Float32 samples in [-1, 1].
 *                     For stereo: [L0, R0, L1, R1, ...]
 * @param sampleRate - Sample rate in Hz (e.g. 44100).
 * @param numChannels - Number of audio channels (1 = mono, 2 = stereo).
 * @returns An ArrayBuffer containing a valid RIFF/WAVE file.
 */
export function encodeWav(
  pcmData: Float32Array,
  sampleRate: number,
  numChannels: number,
): ArrayBuffer {
  const bytesPerSample = 2; // 16-bit
  const dataLength = pcmData.length * bytesPerSample;
  const headerLength = 44;
  const buffer = new ArrayBuffer(headerLength + dataLength);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true); // file size - 8
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size (16 for PCM)
  view.setUint16(20, 1, true); // audio format (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true); // block align
  view.setUint16(34, bytesPerSample * 8, true); // bits per sample

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Convert Float32 [-1, 1] to Int16
  const offset = 44;
  for (let i = 0; i < pcmData.length; i++) {
    const sample = Math.max(-1, Math.min(1, pcmData[i]));
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(offset + i * 2, int16, true);
  }

  return buffer;
}

/**
 * Encode interleaved Float32 PCM samples as a WAV Blob.
 *
 * Convenience wrapper around {@link encodeWav} that returns a Blob
 * with the `audio/wav` MIME type.
 */
export function encodeWavBlob(
  pcmData: Float32Array,
  sampleRate: number,
  numChannels: number,
): Blob {
  const buffer = encodeWav(pcmData, sampleRate, numChannels);
  return new Blob([buffer], {type: 'audio/wav'});
}
