/**
 * What a rendered file is: size, frame rate, frame count and colour tags,
 * read with ffprobe. Tools take the frame rate from the file instead of
 * assuming one.
 */
import {ffprobeJson} from './proc';

export interface VideoInfo {
  width: number;
  height: number;
  /** Frames per second, from the stream's r_frame_rate. */
  fps: number;
  /** The same rate as ffprobe states it ("60/1", "30000/1001"). */
  fpsRational: string;
  /** Container duration, seconds. */
  duration: number;
  codec: string;
  pixFmt: string;
  colorRange: string | null;
  colorSpace: string | null;
  colorTransfer: string | null;
  colorPrimaries: string | null;
}

interface ProbeStream {
  width?: number;
  height?: number;
  r_frame_rate?: string;
  codec_name?: string;
  pix_fmt?: string;
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  nb_read_frames?: string;
  nb_read_packets?: string;
}

interface Probe {
  streams?: ProbeStream[];
  format?: {duration?: string};
}

/** "30000/1001" -> 29.97... */
function parseRational(r: string): number {
  const [n, d = '1'] = r.split('/');
  const v = Number(n) / Number(d);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`Bad frame rate "${r}"`);
  return v;
}

/** The first video stream of `file`. */
export function probeVideo(file: string): VideoInfo {
  const probe = ffprobeJson<Probe>([
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,r_frame_rate,codec_name,pix_fmt,color_range,color_space,color_transfer,color_primaries:format=duration',
    file,
  ]);
  const s = probe.streams?.[0];
  if (!s?.width || !s.height || !s.r_frame_rate) {
    throw new Error(`${file} has no video stream`);
  }
  return {
    width: s.width,
    height: s.height,
    fps: parseRational(s.r_frame_rate),
    fpsRational: s.r_frame_rate,
    duration: Number(probe.format?.duration ?? NaN),
    codec: s.codec_name ?? '',
    pixFmt: s.pix_fmt ?? '',
    colorRange: s.color_range ?? null,
    colorSpace: s.color_space ?? null,
    colorTransfer: s.color_transfer ?? null,
    colorPrimaries: s.color_primaries ?? null,
  };
}

/** Frames in the first video stream, by decoding every one (exact, slower). */
export function countFrames(file: string): number {
  const probe = ffprobeJson<Probe>([
    '-count_frames',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=nb_read_frames',
    file,
  ]);
  const n = Number(probe.streams?.[0]?.nb_read_frames);
  if (!Number.isInteger(n))
    throw new Error(`Could not count frames of ${file}`);
  return n;
}

/** Duration of any media file (container), seconds. */
export function probeDuration(file: string): number {
  const probe = ffprobeJson<Probe>(['-show_entries', 'format=duration', file]);
  const d = Number(probe.format?.duration);
  if (!Number.isFinite(d))
    throw new Error(`Could not read the duration of ${file}`);
  return d;
}

/**
 * The first video packet's presentation time minus its decode time, seconds:
 * how long the first frame waits to be shown (non-zero with B-frames).
 */
export function firstFrameDecodeDelay(file: string): number {
  const probe = ffprobeJson<{
    packets?: {pts_time?: string; dts_time?: string}[];
  }>([
    '-select_streams',
    'v:0',
    '-read_intervals',
    '%+#1',
    '-show_entries',
    'packet=pts_time,dts_time',
    file,
  ]);
  const p = probe.packets?.[0];
  const delay = Number(p?.pts_time) - Number(p?.dts_time);
  if (!Number.isFinite(delay)) {
    throw new Error(`Could not read the first packet's timing in ${file}`);
  }
  return delay;
}
