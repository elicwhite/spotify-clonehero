/**
 * The music edit: song-time stems -> video-time stems. Splices happen at bar
 * lines with short equal-power crossfades placed clear of any attack, then
 * per-stem gain lanes, an optional reverb ring-out after the last hit, and
 * the final fade.
 */
import type {Segment} from '../../src/music/contract';
import {throwProblems} from '../lib/check';
import {minOf} from '../lib/numbers';
import {mulberry32} from '../../src/motion/random';
import {detectOnsets, fftConvolve, toMono} from './dsp';
import {SAMPLE_RATE, allocStereo, toSamples, type Stereo} from './pcm';

export interface CrossfadeSpec {
  lengthSec: number;
  /** The fade ends at least this long before the bar line. */
  guardSec: number;
  /**
   * An attack this close before the bar line, on either side, is the
   * downbeat played early (or the outgoing side's own next downbeat arriving
   * early): the fade then ends `marginSec` before the earliest one, so no
   * attack is ever caught mid-fade.
   */
  lookbackSec: number;
  marginSec: number;
}

/**
 * The smallest spectral flux (default onset options) that counts as an
 * attack. A steady tone's analysis ripple peaks near 6; a noise hit at
 * -60 dBFS under that tone reaches about 170.
 */
const MIN_ATTACK_FLUX = 30;

/** Where one stem crossfades at one splice, video seconds. */
export interface FadeWindow {
  startSec: number;
  endSec: number;
}

/** A cut from one segment into the next, at the incoming segment's start. */
export interface Splice<S extends string, Seg extends Segment = Segment> {
  outgoing: Seg;
  incoming: Seg;
  /** Where each stem crossfades. */
  fades: Record<S, FadeWindow>;
}

/** The cuts between consecutive segments, each stem's fade from `fadesFor`. */
export function splicesOf<S extends string, Seg extends Segment>(
  segments: readonly Seg[],
  fadesFor: (outgoing: Seg, incoming: Seg) => Record<S, FadeWindow>,
): Splice<S, Seg>[] {
  const splices: Splice<S, Seg>[] = [];
  let outgoing: Seg | undefined;
  for (const incoming of segments) {
    if (outgoing)
      splices.push({outgoing, incoming, fades: fadesFor(outgoing, incoming)});
    outgoing = incoming;
  }
  return splices;
}

/**
 * Places one stem's crossfade at the splice from `outgoing` into `incoming`.
 * It ends `guardSec` before the bar line, or earlier when either side has an
 * attack within `lookbackSec` of the bar line.
 */
export function placeCrossfade(
  song: Stereo,
  outgoing: Segment,
  incoming: Segment,
  spec: CrossfadeSpec,
): FadeWindow {
  // Attack times relative to a song-time bar line, from the stem itself.
  const attacksNear = (barLine: number): number[] => {
    const a = Math.max(0, toSamples(barLine - 0.5));
    const b = Math.min(song.l.length, toSamples(barLine + 0.1));
    const mono = toMono({l: song.l.subarray(a, b), r: song.r.subarray(a, b)});
    if (mono.every(v => Math.abs(v) < 1e-3)) return []; // silence: nothing to protect
    return detectOnsets(mono, {delta: 0.05})
      .filter(o => o.strength >= 0.15 && o.flux >= MIN_ATTACK_FLUX)
      .map(o => a / SAMPLE_RATE + o.t - barLine)
      .filter(rel => rel >= -spec.lookbackSec && rel <= spec.guardSec);
  };
  const earliest = minOf([
    ...attacksNear(outgoing.songEnd),
    ...attacksNear(incoming.songStart),
  ]);
  const endSec =
    incoming.videoStart + Math.min(-spec.guardSec, earliest - spec.marginSec);
  return {startSec: endSec - spec.lengthSec, endSec};
}

/**
 * Renders one stem through the edit. Each segment plays its own stretch of
 * the song; at each splice the incoming segment takes over a few
 * milliseconds early (its pre-roll is the song just before its bar line) and
 * the stem's crossfade blends the two. Timing is never shifted: every
 * segment's songStart lands exactly on its videoStart.
 */
export function renderEdit<S extends string>(
  song: Stereo,
  segments: readonly Segment[],
  splices: readonly Splice<S>[],
  stem: S,
  totalSamples: number,
): Stereo {
  const out = allocStereo(totalSamples);
  const read = (ch: Float32Array, idx: number): number =>
    idx >= 0 && idx < ch.length ? ch[idx]! : 0;
  // The song sample under video sample v is v + offsetOf(segment).
  const offsetOf = (seg: Segment) =>
    toSamples(seg.songStart) - toSamples(seg.videoStart);
  const copy = (seg: Segment, from: number, to: number) => {
    const offset = offsetOf(seg);
    for (let v = Math.max(0, from); v < Math.min(totalSamples, to); v++) {
      out.l[v] = read(song.l, v + offset);
      out.r[v] = read(song.r, v + offset);
    }
  };
  for (const seg of segments)
    copy(seg, toSamples(seg.videoStart), toSamples(seg.videoEnd));
  for (const {outgoing, incoming, fades} of splices) {
    const w0 = toSamples(fades[stem].startSec);
    const w1 = toSamples(fades[stem].endSec);
    copy(incoming, w1, toSamples(incoming.videoStart));
    const a = offsetOf(outgoing);
    const b = offsetOf(incoming);
    for (let v = w0; v < w1; v++) {
      const theta = ((v - w0 + 0.5) / (w1 - w0)) * (Math.PI / 2);
      const gOut = Math.cos(theta);
      const gIn = Math.sin(theta);
      out.l[v] = read(song.l, v + a) * gOut + read(song.l, v + b) * gIn;
      out.r[v] = read(song.r, v + a) * gOut + read(song.r, v + b) * gIn;
    }
  }
  return out;
}

// ---------------------------------------------------------------- Gain lanes

/** A gain breakpoint. Linear in dB between points. */
export interface GainPoint {
  /** Video seconds. */
  atSec: number;
  gainDb: number;
}

/** Gains at or below this are treated as silence. */
export const SILENCE_DB = -120;

/**
 * A breakpoint curve's dB value at `sec` (points sorted by time): held flat
 * before the first and after the last point, linear in dB between points.
 * Ramps to or from silence run through -80 dB so they stay smooth.
 */
function dbAt(sorted: readonly GainPoint[], sec: number): number {
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (sec <= first.atSec) return first.gainDb;
  if (sec >= last.atSec) return last.gainDb;
  let k = 0;
  while (sorted[k + 1]!.atSec < sec) k++;
  const a = sorted[k]!;
  const b = sorted[k + 1]!;
  const u = b.atSec > a.atSec ? (sec - a.atSec) / (b.atSec - a.atSec) : 1;
  const aSilent = a.gainDb <= SILENCE_DB;
  const bSilent = b.gainDb <= SILENCE_DB;
  if ((aSilent && (bSilent || u === 0)) || (bSilent && u === 1)) {
    return SILENCE_DB;
  }
  const da = Math.max(a.gainDb, -80);
  const dbb = Math.max(b.gainDb, -80);
  return da + (dbb - da) * u;
}

/** Per-sample gain (linear) of one breakpoint curve. */
export function gainCurve(
  points: GainPoint[],
  totalSamples: number,
): Float32Array {
  const g = new Float32Array(totalSamples).fill(1);
  if (!points.length) return g;
  const sorted = [...points].sort((a, b) => a.atSec - b.atSec);
  for (let i = 0; i < totalSamples; i++) {
    const db = dbAt(sorted, i / SAMPLE_RATE);
    g[i] = db <= SILENCE_DB ? 0 : 10 ** (db / 20);
  }
  return g;
}

export function applyGain(s: Stereo, g: Float32Array): void {
  for (let i = 0; i < s.l.length; i++) {
    s.l[i] = s.l[i]! * g[i]!;
    s.r[i] = s.r[i]! * g[i]!;
  }
}

/** A stretch of video time, [startSec, endSec). */
export interface TimeRange {
  startSec: number;
  endSec: number;
}

/**
 * Where a breakpoint curve is silent. A curve that ends silent stays silent
 * until `endSec`.
 */
export function silentRanges(
  points: readonly GainPoint[],
  endSec: number,
): TimeRange[] {
  const ranges: TimeRange[] = [];
  let run: TimeRange | undefined;
  for (const p of [...points].sort((a, b) => a.atSec - b.atSec)) {
    if (p.gainDb > SILENCE_DB) run = undefined;
    else if (run) run.endSec = p.atSec;
    else ranges.push((run = {startSec: p.atSec, endSec: p.atSec}));
  }
  if (run) run.endSec = endSec;
  return ranges;
}

// ---------------------------------------------------------------- Ring-out

export interface TailSpec {
  /** Video time the reverb send opens (just before the final hits). */
  sendStartSec: number;
  /** Send fade-in length. */
  sendRampSec: number;
  /** Decay time to -60 dB. */
  rt60Sec: number;
  /** Wet level for a unit-energy impulse response, dB. */
  wetDb: number;
  preDelaySec: number;
  /** Tone: the tail's lowpass cutoff glides from `brightHz` to `darkHz`. */
  brightHz: number;
  darkHz: number;
  /** Time constant of that glide. */
  darkenSec: number;
  /** One-pole low cut on the reverb return, Hz. */
  lowCutHz: number;
  /**
   * After the band stops, the dry stems fade out over these video times. The
   * fade starts at or after the send opens, so the dry level never jumps.
   */
  dryFadeStartSec: number;
  dryFadeEndSec: number;
  seed: number;
}

/**
 * Throws naming every problem with a tail's times: a send outside the audio
 * it rings out (0 to `endSec`), or a dry fade that starts before the send
 * opens or ends before it starts, either of which makes the dry level jump.
 * The tail's numbers (decay, tone, levels) are checked with the config
 * (`assertSoundtrackConfig`); the times need the film's beat grid.
 */
export function checkTailTimes(spec: TailSpec, endSec: number): void {
  const problems: string[] = [];
  const sec = (t: number) => `${t.toFixed(3)} s`;
  if (!(spec.sendStartSec >= 0 && spec.sendStartSec < endSec)) {
    problems.push(
      `the send opens at ${sec(spec.sendStartSec)}, outside the audio (0 to ${sec(endSec)})`,
    );
  }
  if (!(spec.dryFadeStartSec >= spec.sendStartSec)) {
    problems.push(
      `the dry fade (${sec(spec.dryFadeStartSec)}) starts before the send opens (${sec(spec.sendStartSec)})`,
    );
  }
  if (!(spec.dryFadeEndSec > spec.dryFadeStartSec)) {
    problems.push(
      `the dry fade ends (${sec(spec.dryFadeEndSec)}) at or before it starts (${sec(spec.dryFadeStartSec)})`,
    );
  }
  throwProblems('Bad tail', problems);
}

/**
 * A synthetic hall impulse response: decorrelated noise per channel, an
 * exponential decay, and a lowpass that closes over time so the highs die
 * first (like a real room). Unit energy per channel. Deterministic.
 */
export function makeImpulseResponse(spec: TailSpec): Stereo {
  const len = toSamples(Math.min(spec.rt60Sec * 1.4, 8));
  const ir = allocStereo(len);
  const pre = toSamples(spec.preDelaySec);
  const attack = toSamples(0.004);
  [ir.l, ir.r].forEach((ch, c) => {
    const rnd = mulberry32(spec.seed + c * 7919);
    let lp = 0;
    let hpIn = 0;
    let hpOut = 0;
    const hpA = Math.exp((-2 * Math.PI * spec.lowCutHz) / SAMPLE_RATE);
    let energy = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / SAMPLE_RATE;
      const white = rnd() * 2 - 1;
      const fc =
        spec.darkHz +
        (spec.brightHz - spec.darkHz) * Math.exp(-t / spec.darkenSec);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / SAMPLE_RATE);
      lp += a * (white - lp);
      // One-pole low cut keeps the tail from booming.
      hpOut = hpA * (hpOut + lp - hpIn);
      hpIn = lp;
      const env =
        Math.exp((-6.907755 * t) / spec.rt60Sec) *
        Math.min(1, (i - pre) / attack);
      const v = hpOut * env;
      ch[i] = v;
      energy += v * v;
    }
    const norm = 1 / Math.sqrt(energy);
    for (let i = 0; i < len; i++) ch[i] = ch[i]! * norm;
  });
  return ir;
}

/**
 * Sends the stem from `sendStartSec` into the impulse response and adds the
 * wet tail; the dry signal fades out after the band has stopped so only the
 * tail rings. Operates in place. The spec's times must have passed
 * `checkTailTimes` for this audio.
 */
export function addRingOut(s: Stereo, ir: Stereo, spec: TailSpec): void {
  const total = s.l.length;
  const start = toSamples(spec.sendStartSec);
  const ramp = Math.max(1, toSamples(spec.sendRampSec));
  const wet = 10 ** (spec.wetDb / 20);
  const f0 = toSamples(spec.dryFadeStartSec);
  const f1 = toSamples(spec.dryFadeEndSec);
  (['l', 'r'] as const).forEach(c => {
    const ch = s[c];
    const send = new Float32Array(total - start);
    for (let i = 0; i < send.length; i++) {
      send[i] = ch[start + i]! * Math.min(1, (i + 0.5) / ramp);
    }
    const tail = fftConvolve(send, ir[c]);
    for (let i = start; i < total; i++) {
      let dry = ch[i]!;
      if (i >= f1) dry = 0;
      else if (i >= f0)
        dry *= 0.5 + 0.5 * Math.cos((Math.PI * (i - f0)) / (f1 - f0));
      ch[i] = dry + wet * tail[i - start]!;
    }
  });
}

/** Raised-cosine fade in from exact silence over the first `sec` seconds. */
export function fadeInStart(s: Stereo, sec: number): void {
  const n = toSamples(sec);
  for (let i = 0; i < n; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
    s.l[i] = s.l[i]! * g;
    s.r[i] = s.r[i]! * g;
  }
}

/** Raised-cosine fade to exact silence over the last `sec` seconds. */
export function fadeOutEnd(s: Stereo, sec: number): void {
  const total = s.l.length;
  const n = toSamples(sec);
  for (let k = 0; k < n; k++) {
    const i = total - n + k;
    const g = 0.5 + 0.5 * Math.cos((Math.PI * (k + 1)) / n);
    s.l[i] = s.l[i]! * g;
    s.r[i] = s.r[i]! * g;
  }
}
