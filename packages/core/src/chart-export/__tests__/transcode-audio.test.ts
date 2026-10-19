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
    const {files: out} = await transcodeAudioFilesToOpus(
      [{fileName: 'song.wav', data: wav.buffer}],
      io,
    );

    expect(io.decode).toHaveBeenCalledTimes(1);
    expect(io.encode).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0].fileName).toBe('song.opus');
    expect(Array.from(out[0].data)).toEqual([0x4f, 0x67, 0x67, 0x53]);
  });

  test('passes already-opus audio through untouched (decodes for duration only, no encode)', async () => {
    const io = mockIO();
    const opus = new Uint8Array([9, 9, 9]);
    const {files: out} = await transcodeAudioFilesToOpus(
      [{fileName: 'drums.opus', data: opus}],
      io,
    );

    expect(io.decode).toHaveBeenCalledTimes(1);
    expect(io.encode).not.toHaveBeenCalled();
    expect(out[0].fileName).toBe('drums.opus');
    expect(Array.from(out[0].data)).toEqual([9, 9, 9]);
  });

  test('survives a decoder that detaches its input buffer (decodeAudioData semantics)', async () => {
    // The real `decodeAudioData` DETACHES the ArrayBuffer it is given. The
    // orchestrator must therefore hand the decoder a copy, never the
    // source's own buffer — regression test for the padded-export crash
    // ("Cannot perform Construct on a detached ArrayBuffer") and its silent
    // sibling (a Uint8Array source passing through as an empty view).
    const received: ArrayBuffer[] = [];
    const io: TranscodeIO = {
      decode: async bytes => {
        received.push(bytes);
        // Detach exactly like decodeAudioData does.
        structuredClone(bytes, {transfer: [bytes]});
        return {
          pcm: new Float32Array([0.1, 0.2]),
          sampleRate: 44100,
          channels: 2,
        };
      },
      encode: async () => new Uint8Array([0x4f]),
    };

    const abSource = new Uint8Array([7, 8, 9]).buffer;
    const u8Source = new Uint8Array([4, 5, 6]);
    const {files: out, durationMs} = await transcodeAudioFilesToOpus(
      [
        {fileName: 'song.opus', data: abSource},
        {fileName: 'drums.opus', data: u8Source},
      ],
      io,
    );

    // The decoder never received the sources' own buffers…
    expect(received[0]).not.toBe(abSource);
    expect(received[1]).not.toBe(u8Source.buffer);
    // …so the source buffers are still intact and the output bytes real.
    expect(abSource.byteLength).toBe(3);
    expect(u8Source.byteLength).toBe(3);
    expect(Array.from(out[0].data)).toEqual([7, 8, 9]);
    expect(Array.from(out[1].data)).toEqual([4, 5, 6]);
    expect(durationMs).toBeCloseTo((1 / 44100) * 1000, 6);
  });

  test('passes non-audio assets through untouched', async () => {
    const io = mockIO();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const {files: out} = await transcodeAudioFilesToOpus(
      [{fileName: 'album.png', data: png}],
      io,
    );

    expect(io.decode).not.toHaveBeenCalled();
    expect(out[0].fileName).toBe('album.png');
    expect(Array.from(out[0].data)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test('preserves order across a mixed list', async () => {
    const io = mockIO();
    const {files: out} = await transcodeAudioFilesToOpus(
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
    // Both the opus (duration-only) and the wav (transcode) decode.
    expect(io.decode).toHaveBeenCalledTimes(2);
    expect(io.encode).toHaveBeenCalledTimes(1);
  });

  test('durationMs is null when there is no audio', async () => {
    const io = mockIO();
    const {durationMs} = await transcodeAudioFilesToOpus(
      [{fileName: 'album.png', data: new Uint8Array([1])}],
      io,
    );
    expect(durationMs).toBeNull();
  });

  test('durationMs is the longest decoded audio duration, in ms', async () => {
    let call = 0;
    const io: TranscodeIO = {
      decode: jest.fn(async () => {
        call += 1;
        return call === 1
          ? // 44100 samples / 2 channels / 44100 Hz = 0.5s = 500ms
            {pcm: new Float32Array(44100), sampleRate: 44100, channels: 2}
          : // 88200 samples / 2 channels / 44100 Hz = 1s = 1000ms
            {pcm: new Float32Array(88200), sampleRate: 44100, channels: 2};
      }),
      encode: jest.fn(async () => new Uint8Array([1])),
    };
    const {durationMs} = await transcodeAudioFilesToOpus(
      [
        {fileName: 'drums.wav', data: new Uint8Array([1]).buffer},
        {fileName: 'song.wav', data: new Uint8Array([2]).buffer},
      ],
      io,
    );
    expect(durationMs).toBe(1000);
  });
});
