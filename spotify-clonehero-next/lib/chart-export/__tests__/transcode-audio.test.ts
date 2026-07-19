/**
 * Tests for export-time Opus transcoding.
 *
 * The naming/decision logic is pure and asserted directly. The orchestrator's
 * decode + encode is browser-only (Web Audio + WebCodecs), so it is exercised
 * with an injected mock {@link TranscodeIO} that records what it was asked to
 * transcode.
 */

import {describe, test, expect, jest} from '@jest/globals';

import {
  fileExtension,
  isAudioFileName,
  isOpusFileName,
  toOpusFileName,
  needsOpusTranscode,
  transcodeAudioFilesToOpus,
  type TranscodeIO,
} from '../transcode-audio';

describe('pure naming/decision logic', () => {
  test('fileExtension is lower-cased and dotless, or empty', () => {
    expect(fileExtension('song.WAV')).toBe('wav');
    expect(fileExtension('drums.opus')).toBe('opus');
    expect(fileExtension('a.b.mp3')).toBe('mp3');
    expect(fileExtension('noext')).toBe('');
  });

  test('isAudioFileName recognizes known audio extensions only', () => {
    for (const name of [
      'song.wav',
      'song.mp3',
      'song.ogg',
      'song.opus',
      'song.flac',
      'song.m4a',
      'song.aac',
    ]) {
      expect(isAudioFileName(name)).toBe(true);
    }
    expect(isAudioFileName('album.png')).toBe(false);
    expect(isAudioFileName('video.mp4')).toBe(false);
    expect(isAudioFileName('notes.chart')).toBe(false);
  });

  test('isOpusFileName is true only for .opus (ogg is not assumed opus)', () => {
    expect(isOpusFileName('drums.opus')).toBe(true);
    expect(isOpusFileName('song.ogg')).toBe(false);
    expect(isOpusFileName('song.wav')).toBe(false);
  });

  test('toOpusFileName swaps or appends the extension', () => {
    expect(toOpusFileName('song.wav')).toBe('song.opus');
    expect(toOpusFileName('drums.mp3')).toBe('drums.opus');
    expect(toOpusFileName('song.opus')).toBe('song.opus');
    expect(toOpusFileName('noext')).toBe('noext.opus');
  });

  test('needsOpusTranscode: audio that is not already opus', () => {
    expect(needsOpusTranscode('song.wav')).toBe(true);
    expect(needsOpusTranscode('song.mp3')).toBe(true);
    expect(needsOpusTranscode('song.ogg')).toBe(true);
    expect(needsOpusTranscode('drums.opus')).toBe(false);
    expect(needsOpusTranscode('album.png')).toBe(false);
  });
});

describe('transcodeAudioFilesToOpus', () => {
  function mockIO(): TranscodeIO {
    return {
      decode: jest.fn(async () => ({
        pcm: new Float32Array([0.1, 0.2]),
        sampleRate: 44100,
        channels: 2,
      })),
      encode: jest.fn(async () => new Uint8Array([0x4f, 0x67, 0x67, 0x53])),
    };
  }

  test('transcodes non-opus audio, renames to .opus, and encodes the bytes', async () => {
    const io = mockIO();
    const wav = new Uint8Array([1, 2, 3, 4]);
    const out = await transcodeAudioFilesToOpus(
      [{fileName: 'song.wav', data: wav.buffer}],
      io,
    );

    expect(io.decode).toHaveBeenCalledTimes(1);
    expect(io.encode).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0].fileName).toBe('song.opus');
    expect(Array.from(out[0].data)).toEqual([0x4f, 0x67, 0x67, 0x53]);
  });

  test('passes already-opus audio through untouched (no decode/encode)', async () => {
    const io = mockIO();
    const opus = new Uint8Array([9, 9, 9]);
    const out = await transcodeAudioFilesToOpus(
      [{fileName: 'drums.opus', data: opus}],
      io,
    );

    expect(io.decode).not.toHaveBeenCalled();
    expect(io.encode).not.toHaveBeenCalled();
    expect(out[0].fileName).toBe('drums.opus');
    expect(Array.from(out[0].data)).toEqual([9, 9, 9]);
  });

  test('passes non-audio assets through untouched', async () => {
    const io = mockIO();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const out = await transcodeAudioFilesToOpus(
      [{fileName: 'album.png', data: png}],
      io,
    );

    expect(io.decode).not.toHaveBeenCalled();
    expect(out[0].fileName).toBe('album.png');
    expect(Array.from(out[0].data)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test('preserves order across a mixed list', async () => {
    const io = mockIO();
    const out = await transcodeAudioFilesToOpus(
      [
        {fileName: 'drums.opus', data: new Uint8Array([1])},
        {fileName: 'song.wav', data: new Uint8Array([2]).buffer},
        {fileName: 'album.png', data: new Uint8Array([3])},
      ],
      io,
    );

    expect(out.map(f => f.fileName)).toEqual([
      'drums.opus',
      'song.opus',
      'album.png',
    ]);
    // Only the wav was transcoded.
    expect(io.decode).toHaveBeenCalledTimes(1);
  });
});
