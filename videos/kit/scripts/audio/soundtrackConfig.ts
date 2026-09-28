/**
 * A film's soundtrack edit, in musical units, and the pure steps that turn
 * it into times: the song-bar ranges into edit segments (they must add up to
 * the film), and the automation lanes into gain breakpoints on the film's
 * own beat grid. `buildSoundtrack` (./soundtrack.ts) renders it.
 *
 * Positions are VIDEO bars and beats (0-based), resolved against the chart's
 * beat grid carried through the edit, so they must be revisited whenever
 * `songBars` changes.
 */
import type {Segment} from '../../src/music/contract';
import {
  checkArray,
  checkNumber,
  checkRecord,
  checkString,
  isRecord,
  throwProblems,
} from '../lib/check';
import {SILENCE_DB, type CrossfadeSpec, type GainPoint} from './edit';

/** A film position: [video bar, beat]. Beats may be fractional or run past the bar. */
export type BarBeat = readonly [bar: number, beat: number];
/** A bar's downbeat, or a [bar, beat]. */
export type At = number | BarBeat;
/** A length on the film's beat grid, or in seconds. */
export type Span = {readonly beats: number} | {readonly sec: number};

/**
 * `gainDb` on `stems` from `from` until `to`: it ramps from 0 dB over the
 * `rampIn` before `from`, and back to 0 dB over the `rampOut` before `to`.
 */
export interface RampLane {
  kind: 'ramp';
  stems: readonly string[];
  gainDb: number;
  from: At;
  to: At;
  rampIn: Span;
  rampOut: Span;
}

/**
 * Silences `stems` between mute edges, listed in film order (the stems start
 * unmuted). A mute fades out over the `muteFadeSec` before its edge; an
 * unmute fades back in over the `unmuteFadeSec` before its edge.
 */
export interface MuteLane {
  kind: 'mute';
  stems: readonly string[];
  edges: readonly {at: At; mute: boolean}[];
  muteFadeSec: number;
  unmuteFadeSec: number;
}

/** One automation concern. Lanes on the same stem multiply. */
export type GainLane = RampLane | MuteLane;

/**
 * A reverb ring-out for an ending that stops before the film does: a send
 * opens at `send`, and the dry stems fade out over `dryFade` (which starts
 * at or after the send) so only the tail rings. See `TailSpec` in ./edit.ts
 * for the tone parameters.
 */
export interface TailConfig {
  send: At;
  sendRampSec: number;
  rt60Sec: number;
  wetDb: number;
  preDelaySec: number;
  brightHz: number;
  darkHz: number;
  darkenSec: number;
  lowCutHz: number;
  dryFade: {from: At; to: At};
  seed: number;
}

/**
 * A stem: files in the chart folder named `<name>.<ext>`, or several files
 * summed into one stem (`{name: 'drums', files: ['drums_1', 'drums_2']}`).
 */
export type StemSpec = string | {name: string; files: readonly string[]};

export interface SoundtrackConfig {
  /** Film length, seconds: a whole number of frames, and the length of `songBars` to within a frame. */
  durationSec: number;
  fps: number;
  /** The stems, as the chart folder has them; the mix is their plain sum. */
  stems: readonly StemSpec[];
  /** Song-bar ranges (inclusive, 0-based) laid end to end from video time 0. */
  songBars: readonly (readonly [first: number, last: number])[];
  /** Splice crossfades: `default`, and per stem where it differs. */
  crossfade: {
    default: CrossfadeSpec;
    stems?: Readonly<Record<string, CrossfadeSpec>>;
  };
  lanes?: readonly GainLane[];
  tail?: TailConfig;
  /** Fade from silence at the start (a click-free edge) and to silence at the end, seconds. */
  startFadeSec: number;
  finalFadeSec: number;
  master: {lufs: number; ceilingDbtp: number};
  /** The stem whose chart notes check the edit's timing (drum sync, sample-exact splices). */
  drumStem?: string;
  /** The stem whose muted ranges drop lyric phrases from the timeline. */
  vocalStem?: string;
  /** peaks.json: bins per second (default 240) and stems (default all). */
  peaks?: {rate?: number; stems?: readonly string[]};
  /** envelopes.json: stems (default all). */
  envelopes?: {stems?: readonly string[]};
  /** Extra words for timeline.json's `mix.notes`. */
  notes?: string;
}

export const stemName = (s: StemSpec): string =>
  typeof s === 'string' ? s : s.name;
export const stemFiles = (s: StemSpec): readonly string[] =>
  typeof s === 'string' ? [s] : s.files;

/** A segment of the edit and the song bars it plays (inclusive). */
export interface EditSegment extends Segment {
  firstBar: number;
  lastBar: number;
}

/**
 * Lays the song-bar ranges end to end from video time 0. `bars[i].t` is song
 * bar i's start (song seconds); a range needs the bar after its last one for
 * its end. The ranges must add up to `durationSec` to within one frame: a
 * film is a whole number of frames and bars rarely are, so the last segment
 * ends exactly on the film's end (playing a few milliseconds more or less of
 * its last bar). Throws when they do not.
 */
export function editSegments(
  bars: readonly {t: number}[],
  ranges: SoundtrackConfig['songBars'],
  durationSec: number,
  fps: number,
): EditSegment[] {
  if (!ranges.length) throw new Error('songBars is empty');
  const segments: EditSegment[] = [];
  let video = 0;
  for (const [a, b] of ranges) {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a) {
      throw new Error(
        `Song bars ${a}-${b}: a range is two whole bar numbers, first <= last`,
      );
    }
    const first = bars[a];
    const after = bars[b + 1];
    if (!first || !after) {
      throw new Error(
        `Song bars ${a}-${b} are outside the chart (bars 0-${bars.length - 2} have an end)`,
      );
    }
    const length = after.t - first.t;
    segments.push({
      videoStart: video,
      videoEnd: video + length,
      songStart: first.t,
      songEnd: after.t,
      firstBar: a,
      lastBar: b,
    });
    video += length;
  }
  if (!(Math.abs(video - durationSec) < 1 / fps)) {
    throw new Error(
      `The song bars ${ranges.map(([a, b]) => `${a}-${b}`).join(', ')} last ${video.toFixed(6)} s, ` +
        `but durationSec is ${durationSec}: they must add up to the film's length, to within a frame ` +
        `(${Math.abs(video - durationSec).toFixed(6)} s ${video > durationSec ? 'over' : 'short'})`,
    );
  }
  const last = segments[segments.length - 1]!;
  last.songEnd = last.songStart + (durationSec - last.videoStart);
  last.videoEnd = durationSec;
  return segments;
}

export const atParts = (at: At): BarBeat =>
  typeof at === 'number' ? [at, 0] : at;

/** Every film position the config names, labelled for error messages. */
export function configPositions(config: SoundtrackConfig): [string, At][] {
  const out: [string, At][] = [];
  (config.lanes ?? []).forEach((lane, i) => {
    const what = `lanes[${i}] (${lane.kind})`;
    if (lane.kind === 'ramp') {
      out.push([`${what}.from`, lane.from], [`${what}.to`, lane.to]);
    } else {
      lane.edges.forEach((e, k) => out.push([`${what}.edges[${k}]`, e.at]));
    }
  });
  if (config.tail) {
    out.push(
      ['tail.send', config.tail.send],
      ['tail.dryFade.from', config.tail.dryFade.from],
      ['tail.dryFade.to', config.tail.dryFade.to],
    );
  }
  return out;
}

/** Records the problems with a position: a bar number or a [bar, beat]. */
function checkAt(problems: string[], at: unknown, name: string): void {
  const [bar, beat] =
    typeof at === 'number' ? [at, 0] : Array.isArray(at) ? at : [];
  if (at === undefined || (Array.isArray(at) && at.length !== 2)) {
    problems.push(`${name} must be a bar or a [bar, beat]`);
    return;
  }
  checkNumber(problems, bar, `${name} bar`, {min: 0, integer: true});
  checkNumber(problems, beat, `${name} beat`);
}

/** Records the problems with a span: {beats} or {sec}, not negative. */
function checkSpan(problems: string[], span: unknown, name: string): void {
  if (isRecord(span) && 'beats' in span) {
    checkNumber(problems, span.beats, `${name}.beats`, {min: 0});
  } else if (isRecord(span) && 'sec' in span) {
    checkNumber(problems, span.sec, `${name}.sec`, {min: 0});
  } else {
    problems.push(`${name} must be {beats} or {sec}`);
  }
}

function checkCrossfade(problems: string[], spec: unknown, name: string): void {
  if (!checkRecord(problems, spec, name)) return;
  checkNumber(problems, spec.lengthSec, `${name}.lengthSec`, {above: 0});
  checkNumber(problems, spec.guardSec, `${name}.guardSec`, {min: 0});
  checkNumber(problems, spec.lookbackSec, `${name}.lookbackSec`, {min: 0});
  checkNumber(problems, spec.marginSec, `${name}.marginSec`, {min: 0});
}

function checkLane(
  problems: string[],
  lane: unknown,
  name: string,
  stems: ReadonlySet<string>,
): void {
  if (!checkRecord(problems, lane, name)) return;
  if (checkArray(problems, lane.stems, `${name}.stems`)) {
    if (!lane.stems.length) problems.push(`${name} has no stems`);
    for (const s of lane.stems) {
      if (typeof s !== 'string' || !stems.has(s)) {
        problems.push(
          `${name} names ${JSON.stringify(s)}, which is not a stem`,
        );
      }
    }
  }
  if (lane.kind === 'ramp') {
    checkNumber(problems, lane.gainDb, `${name}.gainDb`);
    checkAt(problems, lane.from, `${name}.from`);
    checkAt(problems, lane.to, `${name}.to`);
    checkSpan(problems, lane.rampIn, `${name}.rampIn`);
    checkSpan(problems, lane.rampOut, `${name}.rampOut`);
  } else if (lane.kind === 'mute') {
    checkNumber(problems, lane.muteFadeSec, `${name}.muteFadeSec`, {min: 0});
    checkNumber(problems, lane.unmuteFadeSec, `${name}.unmuteFadeSec`, {
      min: 0,
    });
    if (!checkArray(problems, lane.edges, `${name}.edges`)) return;
    lane.edges.forEach((e, k) => {
      if (!checkRecord(problems, e, `${name}.edges[${k}]`)) return;
      checkAt(problems, e.at, `${name}.edges[${k}].at`);
      const before =
        k === 0 ? false : (lane.edges as {mute?: unknown}[])[k - 1]?.mute;
      if (typeof e.mute !== 'boolean') {
        problems.push(`${name}.edges[${k}].mute must be true or false`);
      } else if (e.mute === before) {
        problems.push(
          `${name}.edges[${k}] ${e.mute ? 'mutes' : 'unmutes'} a stem that already is`,
        );
      }
    });
  } else {
    problems.push(`${name}.kind must be 'ramp' or 'mute'`);
  }
}

function checkTail(problems: string[], tail: unknown): void {
  if (!checkRecord(problems, tail, 'tail')) return;
  checkAt(problems, tail.send, 'tail.send');
  if (checkRecord(problems, tail.dryFade, 'tail.dryFade')) {
    checkAt(problems, tail.dryFade.from, 'tail.dryFade.from');
    checkAt(problems, tail.dryFade.to, 'tail.dryFade.to');
  }
  for (const k of [
    'sendRampSec',
    'rt60Sec',
    'darkenSec',
    'brightHz',
    'darkHz',
    'lowCutHz',
  ]) {
    checkNumber(problems, tail[k], `tail.${k}`, {above: 0});
  }
  checkNumber(problems, tail.preDelaySec, 'tail.preDelaySec', {min: 0});
  checkNumber(problems, tail.wetDb, 'tail.wetDb');
  checkNumber(problems, tail.seed, 'tail.seed', {integer: true});
}

/**
 * Checks a soundtrack config as it arrives from a module (every field's type
 * and range, stem names, alternating mute edges) and narrows it; throws
 * naming every problem. The order of positions on the film's grid (a ramp's
 * ends, the tail's send before its dry fade) needs the chart, and is checked
 * when the soundtrack is built.
 */
export function assertSoundtrackConfig(
  value: unknown,
): asserts value is SoundtrackConfig {
  const p: string[] = [];
  if (!checkRecord(p, value, 'the config'))
    return throwProblems('Bad soundtrack config', p);
  const c = value;
  const fps = checkNumber(p, c.fps, 'fps', {above: 0});
  const durationSec = checkNumber(p, c.durationSec, 'durationSec', {above: 0});
  if (fps !== undefined && durationSec !== undefined) {
    const frames = durationSec * fps;
    if (Math.abs(frames - Math.round(frames)) > 1e-6) {
      p.push(
        `durationSec ${durationSec} is not a whole number of frames at ${fps} fps`,
      );
    }
  }
  const names: string[] = [];
  if (checkArray(p, c.stems, 'stems')) {
    if (!c.stems.length) p.push('stems is empty');
    c.stems.forEach((stem, i) => {
      if (typeof stem === 'string' && stem) {
        names.push(stem);
      } else if (isRecord(stem)) {
        if (checkString(p, stem.name, `stems[${i}].name`))
          names.push(stem.name);
        if (
          !Array.isArray(stem.files) ||
          !stem.files.length ||
          stem.files.some(f => typeof f !== 'string' || !f)
        ) {
          p.push(`stems[${i}].files must list file names`);
        }
      } else {
        p.push(`stems[${i}] must be a name or {name, files}`);
      }
    });
  }
  const known = new Set(names);
  if (known.size !== names.length) p.push('stem names repeat');
  if (known.has('mix')) p.push('"mix" is reserved for the sum of the stems');
  const checkStemName = (v: unknown, name: string) => {
    if (v !== undefined && (typeof v !== 'string' || !known.has(v))) {
      p.push(`${name} names ${JSON.stringify(v)}, which is not a stem`);
    }
  };
  if (checkArray(p, c.songBars, 'songBars')) {
    if (!c.songBars.length) p.push('songBars is empty');
    c.songBars.forEach((r, i) => {
      if (!Array.isArray(r) || r.length !== 2)
        return p.push(`songBars[${i}] must be [first, last]`);
      const bar = {min: 0, integer: true};
      const first = checkNumber(p, r[0], `songBars[${i}] first`, bar);
      const last = checkNumber(p, r[1], `songBars[${i}] last`, bar);
      if (first !== undefined && last !== undefined && last < first)
        p.push(`songBars[${i}] ends before it starts`);
    });
  }
  if (checkRecord(p, c.crossfade, 'crossfade')) {
    checkCrossfade(p, c.crossfade.default, 'crossfade.default');
    if (
      c.crossfade.stems !== undefined &&
      checkRecord(p, c.crossfade.stems, 'crossfade.stems')
    ) {
      for (const [stem, spec] of Object.entries(c.crossfade.stems)) {
        checkStemName(stem, 'crossfade.stems');
        checkCrossfade(p, spec, `crossfade.stems.${stem}`);
      }
    }
  }
  if (c.lanes !== undefined && checkArray(p, c.lanes, 'lanes')) {
    c.lanes.forEach((lane, i) => checkLane(p, lane, `lanes[${i}]`, known));
  }
  if (c.tail !== undefined) checkTail(p, c.tail);
  checkNumber(p, c.startFadeSec, 'startFadeSec', {min: 0});
  checkNumber(p, c.finalFadeSec, 'finalFadeSec', {min: 0});
  if (checkRecord(p, c.master, 'master')) {
    checkNumber(p, c.master.lufs, 'master.lufs', {max: 0});
    checkNumber(p, c.master.ceilingDbtp, 'master.ceilingDbtp', {max: 0});
  }
  checkStemName(c.drumStem, 'drumStem');
  checkStemName(c.vocalStem, 'vocalStem');
  for (const key of ['peaks', 'envelopes'] as const) {
    const curves = c[key];
    if (curves === undefined || !checkRecord(p, curves, key)) continue;
    if (key === 'peaks' && curves.rate !== undefined)
      checkNumber(p, curves.rate, 'peaks.rate', {above: 0});
    if (
      curves.stems !== undefined &&
      checkArray(p, curves.stems, `${key}.stems`)
    ) {
      for (const s of curves.stems) checkStemName(s, `${key}.stems`);
    }
  }
  if (c.notes !== undefined && typeof c.notes !== 'string')
    p.push('notes must be text');
  throwProblems('Bad soundtrack config', p);
}

/** Video seconds of a position on the film's grid (`timeOfBeat` from beatGrid). */
export type TimeOfBeat = (bar: number, beat?: number) => number;

/** Seconds of `at`, or of the point `back` before it. */
export function timeAt(timeOfBeat: TimeOfBeat, at: At, back?: Span): number {
  const [bar, beat] = atParts(at);
  if (back && 'beats' in back) return timeOfBeat(bar, beat - back.beats);
  return timeOfBeat(bar, beat) - (back?.sec ?? 0);
}

/** A lane's gain breakpoints in video seconds. */
export function lanePoints(
  lane: GainLane,
  timeOfBeat: TimeOfBeat,
): GainPoint[] {
  const forwards = (points: readonly GainPoint[]) =>
    points.every((p, i) => i === 0 || p.atSec >= points[i - 1]!.atSec);
  const stems = lane.stems.join('/');
  if (lane.kind === 'ramp') {
    const from = timeAt(timeOfBeat, lane.from);
    const to = timeAt(timeOfBeat, lane.to);
    const points = [
      {atSec: timeAt(timeOfBeat, lane.from, lane.rampIn), gainDb: 0},
      {atSec: from, gainDb: lane.gainDb},
      {atSec: timeAt(timeOfBeat, lane.to, lane.rampOut), gainDb: lane.gainDb},
      {atSec: to, gainDb: 0},
    ];
    if (!forwards(points)) {
      throw new Error(
        `A ${lane.gainDb} dB ramp on ${stems} runs backwards: its ramps overlap (from ${from.toFixed(3)} s to ${to.toFixed(3)} s)`,
      );
    }
    return points;
  }
  const points = lane.edges.flatMap((edge): GainPoint[] => {
    const atSec = timeAt(timeOfBeat, edge.at);
    return edge.mute
      ? [
          {atSec: atSec - lane.muteFadeSec, gainDb: 0},
          {atSec, gainDb: SILENCE_DB},
        ]
      : [
          {atSec: atSec - lane.unmuteFadeSec, gainDb: SILENCE_DB},
          {atSec, gainDb: 0},
        ];
  });
  if (!forwards(points)) {
    throw new Error(
      `The mute lane on ${stems} runs backwards: its edges must be in film order, each fade after ` +
        `the edge before it (fades and edges at ${points.map(p => p.atSec.toFixed(3)).join(', ')} s)`,
    );
  }
  return points;
}
