// Reproduce LinkSeg's beat -> per-beat-window pipeline (build_linkseg_cache.py / predict.py).
// All float64 to match numpy/librosa bit-for-bit. Given Beat This! beat times (s) at 22050 and the
// mono 22050 waveform, produces (a) the requantized beat times the model "sees" (needed for decode)
// and (b) the 16382-sample windows fed to the mel front-end.

import {LINKSEG_SR, LINKSEG_WIN_SAMPLES} from './linkseg-mel';

const HOP = 256; // beat-frame quantization hop
const MAX_LEN = 1500; // downsample_frames cap
const PAD = (HOP * 64 - 2) / 2; // 8191 ; window half-width, matches predict.py

// librosa.time_to_frames(times, sr, hop) = floor(times * sr / hop)
function timeToFrames(times: number[], sr: number, hop: number): number[] {
  return times.map(t => Math.floor((t * sr) / hop));
}
// librosa.frames_to_time(frames, sr, hop) = frames * hop / sr
function framesToTime(frames: number[], sr: number, hop: number): number[] {
  return frames.map(f => (f * hop) / sr);
}
// librosa.util.fix_frames(frames, x_min=0, pad=True): sorted-unique, with 0 included
function fixFrames(frames: number[]): number[] {
  const s = new Set<number>();
  s.add(0);
  for (const f of frames) if (f >= 0) s.add(f);
  return Array.from(s).sort((a, b) => a - b);
}
// LinkSeg downsample_frames: halve (stride-2) until <= maxLen
function downsampleFrames(frames: number[], maxLen: number): number[] {
  let f = frames;
  while (f.length > maxLen) f = f.filter((_, i) => i % 2 === 0);
  return f;
}

// np.pad(mode='edge'): replicate the edge sample.
function edgePad(x: Float32Array, pad: number): Float32Array {
  const L = x.length;
  const out = new Float32Array(L + 2 * pad);
  out.fill(x[0], 0, pad);
  out.set(x, pad);
  out.fill(x[L - 1], pad + L, pad + 2 * pad + L);
  return out;
}

export type LinkSegWindows = {beatTimes: number[]; windows: Float32Array[]};

/**
 * @param beatTimes Beat This! beat times in seconds (any beat source; LinkSeg is robust to it)
 * @param wave22k   mono waveform at 22050 Hz
 */
export function buildLinkSegWindows(beatTimes: number[], wave22k: Float32Array): LinkSegWindows {
  let frames = timeToFrames(beatTimes, LINKSEG_SR, HOP);
  frames = fixFrames(frames);
  frames = downsampleFrames(frames, MAX_LEN);
  const bt = framesToTime(frames, LINKSEG_SR, HOP);
  const bf1 = timeToFrames(bt, LINKSEG_SR, 1); // floor(bt * 22050)

  const padded = edgePad(wave22k, PAD);
  const windows: Float32Array[] = [];
  for (const i of bf1) {
    windows.push(padded.subarray(i, i + LINKSEG_WIN_SAMPLES)); // 2*PAD = 16382
  }
  return {beatTimes: bt, windows};
}
