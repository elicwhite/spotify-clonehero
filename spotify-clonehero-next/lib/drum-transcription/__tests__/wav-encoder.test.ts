/**
 * Tests for the WAV encoder.
 *
 * Validates:
 * - Correct RIFF/WAVE header structure (44 bytes)
 * - Proper sample conversion from Float32 to Int16
 * - Mono and stereo encoding
 * - Edge cases (silence, clipping, boundary values)
 */

import {describe, test, expect} from '@jest/globals';
import {encodeWav} from '../audio/wav-encoder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a 4-character ASCII string from a DataView at the given offset. */
function readString(view: DataView, offset: number, length: number): string {
  let str = '';
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(view.getUint8(offset + i));
  }
  return str;
}

/** Create a sine wave at the given frequency. */
function createSineWave(
  frequency: number,
  sampleRate: number,
  numChannels: number,
  durationSeconds: number,
): Float32Array {
  const samplesPerChannel = Math.floor(sampleRate * durationSeconds);
  const totalSamples = samplesPerChannel * numChannels;
  const data = new Float32Array(totalSamples);

  for (let i = 0; i < samplesPerChannel; i++) {
    const sample = Math.sin(2 * Math.PI * frequency * (i / sampleRate));
    for (let ch = 0; ch < numChannels; ch++) {
      data[i * numChannels + ch] = sample;
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wav-encoder', () => {
  test('produces correct RIFF header for stereo 44100Hz', () => {
    const pcm = new Float32Array(44100 * 2); // 1 second stereo silence
    const buffer = encodeWav(pcm, 44100, 2);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    expect(readString(view, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8);
    expect(readString(view, 8, 4)).toBe('WAVE');
  });

  test('produces correct fmt chunk for stereo 44100Hz', () => {
    const pcm = new Float32Array(44100 * 2);
    const buffer = encodeWav(pcm, 44100, 2);
    const view = new DataView(buffer);

    // fmt sub-chunk
    expect(readString(view, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16); // PCM chunk size
    expect(view.getUint16(20, true)).toBe(1); // PCM audio format
    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(44100); // sample rate
    expect(view.getUint32(28, true)).toBe(44100 * 2 * 2); // byte rate
    expect(view.getUint16(32, true)).toBe(4); // block align (2 channels * 2 bytes)
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });

  test('produces correct data chunk header', () => {
    const pcm = new Float32Array(100);
    const buffer = encodeWav(pcm, 44100, 1);
    const view = new DataView(buffer);

    expect(readString(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(100 * 2); // 100 samples * 2 bytes each
  });

  test('total buffer size is header + data', () => {
    const numSamples = 1000;
    const pcm = new Float32Array(numSamples);
    const buffer = encodeWav(pcm, 44100, 1);

    expect(buffer.byteLength).toBe(44 + numSamples * 2);
  });

  test('mono encoding sets channels to 1', () => {
    const pcm = new Float32Array(44100); // 1 second mono
    const buffer = encodeWav(pcm, 44100, 1);
    const view = new DataView(buffer);

    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(28, true)).toBe(44100 * 1 * 2); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
  });

  test('converts Float32 silence to Int16 zeros', () => {
    const pcm = new Float32Array(10); // 10 samples of silence
    const buffer = encodeWav(pcm, 44100, 1);
    const view = new DataView(buffer);

    for (let i = 0; i < 10; i++) {
      expect(view.getInt16(44 + i * 2, true)).toBe(0);
    }
  });

  test('converts Float32 +1.0 to Int16 +32767', () => {
    const pcm = new Float32Array([1.0]);
    const buffer = encodeWav(pcm, 44100, 1);
    const view = new DataView(buffer);

    expect(view.getInt16(44, true)).toBe(32767);
  });

  test('converts Float32 -1.0 to Int16 -32768', () => {
    const pcm = new Float32Array([-1.0]);
    const buffer = encodeWav(pcm, 44100, 1);
    const view = new DataView(buffer);

    expect(view.getInt16(44, true)).toBe(-32768);
  });

  test('clamps values outside [-1, 1]', () => {
    const pcm = new Float32Array([2.0, -2.0, 1.5, -1.5]);
    const buffer = encodeWav(pcm, 44100, 1);
    const view = new DataView(buffer);

    // +2.0 should clamp to +32767
    expect(view.getInt16(44, true)).toBe(32767);
    // -2.0 should clamp to -32768
    expect(view.getInt16(46, true)).toBe(-32768);
    // +1.5 should clamp to +32767
    expect(view.getInt16(48, true)).toBe(32767);
    // -1.5 should clamp to -32768
    expect(view.getInt16(50, true)).toBe(-32768);
  });

  test('preserves stereo interleaving', () => {
    // L=0.5, R=-0.5, L=0.25, R=-0.25
    const pcm = new Float32Array([0.5, -0.5, 0.25, -0.25]);
    const buffer = encodeWav(pcm, 44100, 2);
    const view = new DataView(buffer);

    const s0 = view.getInt16(44, true); // L = 0.5 -> ~16383
    const s1 = view.getInt16(46, true); // R = -0.5 -> ~-16384
    const s2 = view.getInt16(48, true); // L = 0.25 -> ~8191
    const s3 = view.getInt16(50, true); // R = -0.25 -> ~-8192

    expect(s0).toBeGreaterThan(0);
    expect(s1).toBeLessThan(0);
    expect(s2).toBeGreaterThan(0);
    expect(s3).toBeLessThan(0);

    // Left channel should be positive, right negative
    expect(Math.abs(s0)).toBeGreaterThan(Math.abs(s2));
    expect(Math.abs(s1)).toBeGreaterThan(Math.abs(s3));
  });

  test('different sample rates produce correct header', () => {
    const pcm = new Float32Array(48000 * 2);
    const buffer = encodeWav(pcm, 48000, 2);
    const view = new DataView(buffer);

    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(28, true)).toBe(48000 * 2 * 2); // byte rate
  });

  test('sine wave maintains approximate amplitude after conversion', () => {
    // Create a 440Hz sine wave for 0.1 seconds
    const sineWave = createSineWave(440, 44100, 1, 0.1);
    const buffer = encodeWav(sineWave, 44100, 1);
    const view = new DataView(buffer);

    // Find the peak value in the Int16 data
    let maxVal = 0;
    const numSamples = sineWave.length;
    for (let i = 0; i < numSamples; i++) {
      const val = Math.abs(view.getInt16(44 + i * 2, true));
      if (val > maxVal) maxVal = val;
    }

    // Peak should be close to 32767 (full scale sine wave)
    expect(maxVal).toBeGreaterThan(32000);
    expect(maxVal).toBeLessThanOrEqual(32767);
  });

  test('empty input produces valid header-only WAV', () => {
    const pcm = new Float32Array(0);
    const buffer = encodeWav(pcm, 44100, 1);
    const view = new DataView(buffer);

    expect(buffer.byteLength).toBe(44);
    expect(readString(view, 0, 4)).toBe('RIFF');
    expect(readString(view, 8, 4)).toBe('WAVE');
    expect(view.getUint32(40, true)).toBe(0); // data length = 0
  });
});
