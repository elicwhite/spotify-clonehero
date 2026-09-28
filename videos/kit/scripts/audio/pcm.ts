/**
 * PCM in and out. ffmpeg decodes any file to 48 kHz float stereo; WAV files
 * are written directly (24-bit PCM or 32-bit float) so the sample count is
 * exact, and atomically (temporary file plus rename).
 *
 * The soundtrack pipeline works at one rate, SAMPLE_RATE: every decode is
 * resampled to it and every WAV is written at it.
 */
import fs from 'node:fs';
import {writeFileAtomic} from '../lib/files';
import {ffmpeg} from '../lib/proc';

export const SAMPLE_RATE = 48000;

/** Planar stereo audio. */
export interface Stereo {
  l: Float32Array;
  r: Float32Array;
}

export function allocStereo(frames: number): Stereo {
  return {l: new Float32Array(frames), r: new Float32Array(frames)};
}

/** Seconds to the nearest sample. */
export const toSamples = (sec: number): number => Math.round(sec * SAMPLE_RATE);

/** Decodes a file to SAMPLE_RATE stereo float with ffmpeg (Opus pre-skip handled). */
export function decodeStereo(file: string): Stereo {
  const {stdout: buf} = ffmpeg([
    '-i',
    file,
    '-f',
    'f32le',
    '-acodec',
    'pcm_f32le',
    '-ac',
    '2',
    '-ar',
    String(SAMPLE_RATE),
    'pipe:1',
  ]);
  const interleaved = new Float32Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  const frames = interleaved.length >> 1;
  const out = allocStereo(frames);
  for (let i = 0; i < frames; i++) {
    out.l[i] = interleaved[2 * i]!;
    out.r[i] = interleaved[2 * i + 1]!;
  }
  return out;
}

/**
 * A stereo WAV file's bytes: 24-bit PCM (rounded, no dither) or 32-bit
 * float. Throws on a NaN or infinite sample, which 24-bit rounding would
 * otherwise write as silence.
 */
export function encodeWav(audio: Stereo, bits: 24 | 32 = 24): Buffer {
  const frames = audio.l.length;
  const bytesPerSample = bits / 8;
  const blockAlign = 2 * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(bits === 32 ? 3 : 1, 20); // 3 = IEEE float
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * blockAlign, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  let o = 44;
  const max = 8388607;
  for (let i = 0; i < frames; i++) {
    for (const ch of [audio.l, audio.r]) {
      const v = ch[i]!;
      if (!Number.isFinite(v)) {
        throw new Error(
          `sample ${i} of the ${ch === audio.l ? 'left' : 'right'} channel is ${v}; ` +
            `refusing to write it as silence`,
        );
      }
      if (bits === 32) {
        buf.writeFloatLE(v, o);
      } else {
        const q = Math.max(-max - 1, Math.min(max, Math.round(v * max)));
        buf[o] = q & 0xff;
        buf[o + 1] = (q >> 8) & 0xff;
        buf[o + 2] = (q >> 16) & 0xff;
      }
      o += bytesPerSample;
    }
  }
  return buf;
}

/**
 * Writes a stereo WAV atomically. 24-bit PCM is rounded without dither: the
 * 24-bit floor is far below the music, and rounding keeps the output
 * byte-for-byte deterministic.
 */
export function writeWav(
  file: string,
  audio: Stereo,
  bits: 24 | 32 = 24,
): void {
  writeFileAtomic(file, encodeWav(audio, bits));
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/**
 * Reads a 16/24/32-bit PCM or 32-bit float WAV (mono is duplicated to both
 * channels). It must be at SAMPLE_RATE.
 */
export function readWav(file: string): Stereo {
  const buf = fs.readFileSync(file);
  if (
    buf.toString('ascii', 0, 4) !== 'RIFF' ||
    buf.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error(`${file} is not a WAV file`);
  }
  let o = 12;
  let fmt = WAVE_FORMAT_PCM;
  let bits = 16;
  let channels = 2;
  let rate = SAMPLE_RATE;
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') {
      fmt = buf.readUInt16LE(o + 8);
      channels = buf.readUInt16LE(o + 10);
      rate = buf.readUInt32LE(o + 12);
      bits = buf.readUInt16LE(o + 22);
      // The sub-format GUID starts with the plain format code.
      if (fmt === WAVE_FORMAT_EXTENSIBLE) fmt = buf.readUInt16LE(o + 8 + 24);
    } else if (id === 'data') {
      if (rate !== SAMPLE_RATE) {
        throw new Error(
          `${file} is ${rate} Hz; the pipeline reads ${SAMPLE_RATE} Hz`,
        );
      }
      if (fmt === WAVE_FORMAT_FLOAT ? bits !== 32 : fmt !== WAVE_FORMAT_PCM) {
        throw new Error(`${file}: unsupported WAV format ${fmt} (${bits}-bit)`);
      }
      const bps = bits / 8;
      const frames = Math.floor(
        Math.min(size, buf.length - o - 8) / (bps * channels),
      );
      const out = allocStereo(frames);
      const scale = 1 / 2 ** (bits - 1);
      let p = o + 8;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channels; c++) {
          let v: number;
          if (fmt === WAVE_FORMAT_FLOAT) v = buf.readFloatLE(p);
          else if (bits === 24) v = buf.readIntLE(p, 3) * scale;
          else if (bits === 32) v = buf.readInt32LE(p) * scale;
          else v = buf.readInt16LE(p) * scale;
          if (c === 0) out.l[i] = v;
          if (c === 1 || channels === 1) out.r[i] = v;
          p += bps;
        }
      }
      return out;
    }
    o += 8 + size + (size & 1);
  }
  throw new Error(`No data chunk in ${file}`);
}
