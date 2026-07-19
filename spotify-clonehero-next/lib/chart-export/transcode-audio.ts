/**
 * Export-time audio transcoding to Opus.
 *
 * Clone Hero / YARG packages should ship Opus audio. Different editor pages
 * hand the export dialog audio in whatever format they have on hand — the
 * drum-transcription stem path already produces `.opus`, but the "original
 * uploaded file" path and the drum-edit page emit `.wav`/`.mp3`/`.ogg`/etc.,
 * and chart-flow passthrough assets can carry secondary audio in any format.
 *
 * This module normalizes all of that: any audio file that isn't already Opus
 * is decoded (via the browser's Web Audio decoder) and re-encoded to Opus
 * (via the WebCodecs encoder in {@link file://../audio/opus-encoder.ts}), and
 * its name gets an `.opus` extension. Files that are already `.opus`, and any
 * non-audio file (album art, video, …), pass through untouched.
 *
 * The naming/decision logic is pure and unit-tested. The actual decode +
 * encode is injected via {@link TranscodeIO} so tests can run without browser
 * audio APIs; the default IO wires up the real browser decoder/encoder.
 */

import {encodePcmToOpus} from '@/lib/audio/opus-encoder';
import {
  decodeAudio,
  interleaveAudioBuffer,
} from '@/lib/drum-transcription/audio/decoder';
import {TARGET_CHANNELS} from '@/lib/drum-transcription/audio/types';

/** File extensions treated as audio for transcode purposes. */
const AUDIO_EXTENSIONS = new Set([
  'wav',
  'mp3',
  'ogg',
  'opus',
  'flac',
  'm4a',
  'aac',
  'weba',
  'webm',
]);

/** Lower-cased extension (without the dot), or `''` if the name has none. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/** True if the file name looks like an audio file we know how to decode. */
export function isAudioFileName(fileName: string): boolean {
  return AUDIO_EXTENSIONS.has(fileExtension(fileName));
}

/** True if the file is already Opus (by extension). `.ogg` is NOT assumed to
 * be Opus — an Ogg container may carry Vorbis, so it is transcoded. */
export function isOpusFileName(fileName: string): boolean {
  return fileExtension(fileName) === 'opus';
}

/** Replace (or append) the extension with `.opus`. */
export function toOpusFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot >= 0 ? fileName.slice(0, dot) : fileName;
  return `${base}.opus`;
}

/** True if the file needs decoding + re-encoding to Opus: it's audio, and not
 * already Opus. Non-audio files return false (they pass through verbatim). */
export function needsOpusTranscode(fileName: string): boolean {
  return isAudioFileName(fileName) && !isOpusFileName(fileName);
}

/** A `{fileName, data}` entry, as produced by the export dialog's audio and
 * asset providers. `data` may be an `ArrayBuffer` or a `Uint8Array`. */
export interface TranscodeEntry {
  fileName: string;
  data: ArrayBuffer | Uint8Array;
}

/** Injectable decode/encode seam so the pure list logic can be tested without
 * the browser's audio APIs. */
export interface TranscodeIO {
  /** Decode encoded audio file bytes into interleaved Float32 PCM. */
  decode: (
    bytes: ArrayBuffer,
  ) => Promise<{pcm: Float32Array; sampleRate: number; channels: number}>;
  /** Encode interleaved Float32 PCM into `.opus` file bytes. */
  encode: (
    pcm: Float32Array,
    sampleRate: number,
    channels: number,
  ) => Promise<Uint8Array>;
}

function toUint8(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof Uint8Array) {
    // Slice to a standalone ArrayBuffer (the view may be a window into a
    // larger buffer, which decodeAudioData would choke on).
    return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
      ? (data.buffer as ArrayBuffer)
      : (data.slice().buffer as ArrayBuffer);
  }
  return data;
}

/** The real browser decode/encode path: Web Audio decode → interleave →
 * WebCodecs Opus encode. Decoding normalizes to 44.1 kHz stereo. */
export const defaultTranscodeIO: TranscodeIO = {
  decode: async bytes => {
    const buffer = await decodeAudio(bytes);
    return {
      pcm: interleaveAudioBuffer(buffer),
      sampleRate: buffer.sampleRate,
      channels: TARGET_CHANNELS,
    };
  },
  encode: (pcm, sampleRate, channels) =>
    encodePcmToOpus(pcm, sampleRate, channels),
};

/**
 * Transcode a mixed list of files so every audio entry is Opus. Audio files
 * that aren't already `.opus` are decoded + re-encoded and renamed to
 * `.opus`; already-Opus audio and non-audio files pass through unchanged.
 *
 * Order is preserved. Runs sequentially so concurrent decodes don't spin up
 * many `AudioContext`s at once.
 */
export async function transcodeAudioFilesToOpus(
  files: TranscodeEntry[],
  io: TranscodeIO = defaultTranscodeIO,
): Promise<{fileName: string; data: Uint8Array}[]> {
  const out: {fileName: string; data: Uint8Array}[] = [];
  for (const file of files) {
    if (needsOpusTranscode(file.fileName)) {
      const {pcm, sampleRate, channels} = await io.decode(
        toArrayBuffer(file.data),
      );
      const opus = await io.encode(pcm, sampleRate, channels);
      out.push({fileName: toOpusFileName(file.fileName), data: opus});
    } else {
      out.push({fileName: file.fileName, data: toUint8(file.data)});
    }
  }
  return out;
}
