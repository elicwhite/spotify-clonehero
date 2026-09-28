/**
 * Delivery steps for a rendered picture: mux the soundtrack with the AAC
 * encoder delay handled and the A/V offset measured, join a poster clip in
 * front of the film without a re-encode, retag BT.709, and encode smaller
 * variants. The CLIs are mux.ts and deliver.ts.
 *
 * Why these steps exist:
 * - Remotion's own MP4/AAC mux writes the audio edit list with media time
 *   0, so the encoder's priming samples are never trimmed and the audio
 *   plays about 43 ms late. ffmpeg's mp4 muxer writes the edit list with the
 *   priming skipped; `mux` uses it and measures the result.
 * - A Remotion render in bt709 mode asks ffmpeg for all four BT.709 tags,
 *   but ffmpeg takes the frames' own colour properties over those options,
 *   and the frames carry only the matrix and range (../lib/bt709.ts): the
 *   file's primaries and transfer are unset, and players that guess show
 *   crushed or shifted blacks. `retagBt709` sets all four, in the bitstream
 *   and the container, without a re-encode.
 * - A site that previews a video by its first frame should show the poster:
 *   `joinPoster` puts the poster clip first. The film's first frame waits for
 *   its B-frames (its first packet decodes before it shows); the poster's
 *   decode times move back by however much longer that wait is than the
 *   poster's own, or the joined stream decodes out of order and drops a
 *   frame.
 */
import fs from 'node:fs';
import path from 'node:path';
import {BT709_H264_METADATA, BT709_TAGS, bt709Filter} from '../lib/bt709';
import {produceAtomic, withScratchDir} from '../lib/files';
import {
  firstFrameDecodeDelay,
  countFrames,
  probeDuration,
  probeVideo,
} from '../lib/media';
import {ffmpeg} from '../lib/proc';

/** Rewrites an H.264 file's colour tags as BT.709 limited range, stream copied. */
export async function retagBt709(input: string, output: string): Promise<void> {
  await produceAtomic(output, tmp =>
    ffmpeg([
      '-y',
      '-i',
      input,
      '-map',
      '0:v:0',
      '-c',
      'copy',
      '-bsf:v',
      BT709_H264_METADATA,
      ...BT709_TAGS,
      tmp,
    ]),
  );
}

/**
 * Joins `poster` (a short clip rendered with the same encoder settings) in
 * front of `film`, stream copied. Returns the poster's frame count: the
 * joined file's first film frame is that many frames in.
 */
export async function joinPoster(
  poster: string,
  film: string,
  output: string,
): Promise<number> {
  const a = probeVideo(poster);
  const b = probeVideo(film);
  if (
    a.width !== b.width ||
    a.height !== b.height ||
    a.fpsRational !== b.fpsRational ||
    a.codec !== b.codec
  ) {
    throw new Error(
      `The poster (${a.width}x${a.height} ${a.fpsRational} ${a.codec}) must match the film ` +
        `(${b.width}x${b.height} ${b.fpsRational} ${b.codec}) to join without a re-encode`,
    );
  }
  // A one-frame poster shows its only frame at once; a longer one encoded
  // like the film already waits as long as the film does.
  const shift = firstFrameDecodeDelay(film) - firstFrameDecodeDelay(poster);
  const frames = countFrames(poster);
  await withScratchDir('poster-join', async scratch => {
    const shifted = path.join(scratch, 'poster.mp4');
    ffmpeg([
      '-y',
      '-i',
      poster,
      '-map',
      '0:v:0',
      '-c',
      'copy',
      // pts=PTS is spelled out: given only dts, setts also rewrites each
      // packet's pts to its new dts, which reorders a B-frame poster.
      '-bsf:v',
      `setts=pts=PTS:dts=DTS-(${shift.toFixed(6)})/TB`,
      shifted,
    ]);
    const list = path.join(scratch, 'join.txt');
    const quote = (f: string) => `'${f.replace(/'/g, "'\\''")}'`;
    fs.writeFileSync(
      list,
      `file ${quote(shifted)}\nduration ${(frames / b.fps).toFixed(6)}\nfile ${quote(path.resolve(film))}\n`,
    );
    await produceAtomic(output, tmp =>
      ffmpeg([
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        list,
        '-map',
        '0:v:0',
        '-c',
        'copy',
        tmp,
      ]),
    );
  });
  return frames;
}

/** Mono float PCM of a file's audio at `rate`, from `startSec` for `durSec`. */
function pcmOf(
  file: string,
  rate: number,
  startSec: number,
  durSec: number,
): Float32Array {
  const {stdout} = ffmpeg([
    '-ss',
    startSec.toFixed(6),
    '-t',
    durSec.toFixed(6),
    '-i',
    file,
    '-vn',
    '-ac',
    '1',
    '-ar',
    String(rate),
    '-f',
    'f32le',
    'pipe:1',
  ]);
  return new Float32Array(
    stdout.buffer.slice(
      stdout.byteOffset,
      stdout.byteOffset + stdout.byteLength,
    ),
  );
}

export interface AvOffset {
  /** Audio relative to picture, ms: positive = audio late. Null when there was nothing to measure. */
  offsetMs: number | null;
  correlation: number;
  /** Clip time of the measured window, seconds. */
  atSec: number;
}

const RATE = 16000;
const WINDOW_SEC = 0.5;
const MAX_LAG_SEC = 0.1;

/**
 * Where `muxed`'s audio sits against the mix it came from: the loudest
 * half-second of the mix inside the clip, cross-correlated with the muxed
 * audio (as a player decodes it, edit list applied) over +-100 ms. Clip time
 * u shows film time u + `filmStartSec`.
 */
function measureAvOffset(
  muxed: string,
  mix: string,
  filmStartSec: number,
): AvOffset {
  const dur = probeDuration(muxed);
  const out = pcmOf(muxed, RATE, 0, dur);
  // The mix as the clip should carry it: silence before the film starts.
  const lead = Math.max(0, Math.round(-filmStartSec * RATE));
  const mixPart = pcmOf(mix, RATE, Math.max(0, filmStartSec), dur);
  const ref = new Float32Array(out.length);
  ref.set(mixPart.subarray(0, Math.max(0, ref.length - lead)), lead);
  const win = Math.round(WINDOW_SEC * RATE);
  const maxLag = Math.round(MAX_LAG_SEC * RATE);
  // The loudest window of the reference, clear of the edges by the lag range.
  let best = -1;
  let bestEnergy = 0;
  for (let s = maxLag; s + win + maxLag <= ref.length; s += win >> 2) {
    let e = 0;
    for (let i = s; i < s + win; i++) e += ref[i]! * ref[i]!;
    if (e > bestEnergy) {
      bestEnergy = e;
      best = s;
    }
  }
  if (best < 0 || bestEnergy < 1e-6)
    return {offsetMs: null, correlation: 0, atSec: 0};
  let bestLag = 0;
  let bestCorr = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let xy = 0;
    let oo = 0;
    for (let i = 0; i < win; i++) {
      const o = out[best + lag + i] ?? 0;
      xy += ref[best + i]! * o;
      oo += o * o;
    }
    const c = xy / Math.sqrt(bestEnergy * oo + 1e-30);
    if (c > bestCorr) {
      bestCorr = c;
      bestLag = lag;
    }
  }
  return {
    offsetMs: (bestLag * 1000) / RATE,
    correlation: bestCorr,
    atSec: best / RATE,
  };
}

export interface MuxResult extends AvOffset {
  /** Film frame of the clip's first frame. */
  fromFrame: number;
  fps: number;
  /** Frames in the muxed file (always the picture's). */
  frames: number;
}

/**
 * Puts the matching slice of `mix` under `picture` (any audio it has is
 * replaced): film frame `fromFrame` is the picture's first frame; a negative
 * one plays silence until film frame 0, and a mix that ends before the
 * picture is padded with silence. AAC at 320 kb/s, muxed by ffmpeg. Throws
 * when the muxed file lost a frame.
 */
export async function muxAudio(
  picture: string,
  mix: string,
  output: string,
  fromFrame: number,
): Promise<MuxResult> {
  const {fps} = probeVideo(picture);
  const pictureFrames = countFrames(picture);
  const start = fromFrame / fps;
  const dur = probeDuration(picture);
  const silenceMs = start < 0 ? -start * 1000 : 0;
  await produceAtomic(output, async tmp => {
    ffmpeg([
      '-y',
      '-i',
      picture,
      '-ss',
      Math.max(0, start).toFixed(6),
      '-t',
      dur.toFixed(6),
      '-i',
      mix,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-af',
      `adelay=${silenceMs.toFixed(6)}:all=1,apad`,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '320k',
      '-shortest',
      '-movflags',
      '+faststart',
      tmp,
    ]);
    const frames = countFrames(tmp);
    if (frames !== pictureFrames) {
      throw new Error(
        `the muxed file has ${frames} frames, the picture ${pictureFrames}`,
      );
    }
  });
  return {
    fromFrame,
    fps,
    frames: pictureFrames,
    ...measureAvOffset(output, mix, start),
  };
}

/** Below this the muxed audio is not the mix at all, whatever the offset reads. */
const MIN_CORRELATION = 0.9;

/**
 * One line on a mux's measured offset; `ok` is false when it is out of
 * tolerance or the audio does not match the mix.
 */
export function describeOffset(
  r: MuxResult,
  toleranceMs: number,
): {line: string; ok: boolean} {
  if (r.offsetMs === null) {
    return {
      line: 'A/V offset: not measured (the mix is silent under this clip)',
      ok: true,
    };
  }
  const inSync = Math.abs(r.offsetMs) <= toleranceMs;
  const matches = r.correlation >= MIN_CORRELATION;
  return {
    line:
      `measured A/V offset: ${r.offsetMs >= 0 ? '+' : ''}${r.offsetMs.toFixed(1)} ms (positive = audio late), ` +
      `correlation ${r.correlation.toFixed(2)} at ${r.atSec.toFixed(2)} s` +
      (inSync ? '' : `  OUT OF SYNC (tolerance ${toleranceMs} ms)`) +
      (matches ? '' : `  NOT THE MIX (correlation under ${MIN_CORRELATION})`),
    ok: inSync && matches,
  };
}

/**
 * A smaller encode of a delivery: its file suffix, quality, and height (the
 * width keeps the master's aspect; never above the master's size).
 */
export interface Variant {
  suffix: string;
  crf: number;
  /** Output height, or null for the master's. */
  height: number | null;
}

/**
 * "web:18:same" (the master's size) or "720p:24:h720" (720 high). A height
 * is even and at least 2, as 4:2:0 H.264 needs.
 */
export function parseVariant(spec: string): Variant {
  const m = /^([\w-]+):(\d+):(same|h\d+)$/.exec(spec);
  if (!m) {
    throw new Error(
      `A variant looks like web:18:same or 720p:24:h720; got "${spec}"`,
    );
  }
  const size = m[3]!;
  const height = size === 'same' ? null : Number(size.slice(1));
  if (height !== null && (height < 2 || height % 2 !== 0)) {
    throw new Error(
      `A variant's height is even and at least 2 (4:2:0 H.264); got "${spec}"`,
    );
  }
  return {suffix: m[1]!, crf: Number(m[2]), height};
}

/** Re-encodes a BT.709 master to a variant's quality and size, picture only. */
export async function encodeVariant(
  master: string,
  output: string,
  v: Variant,
): Promise<void> {
  const {width, height} = probeVideo(master);
  const even = (n: number) => Math.round(n / 2) * 2;
  // A variant is never larger than the master.
  const size =
    v.height === null || v.height >= height
      ? {width, height}
      : {width: even((width * v.height) / height), height: v.height};
  await produceAtomic(output, tmp =>
    ffmpeg([
      '-y',
      '-i',
      master,
      '-map',
      '0:v:0',
      '-vf',
      bt709Filter({from: 'yuv', ...size}),
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      String(v.crf),
      '-profile:v',
      'high',
      '-movflags',
      '+faststart',
      ...BT709_TAGS,
      '-an',
      tmp,
    ]),
  );
}
