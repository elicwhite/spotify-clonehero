/**
 * A music bed arranged from loops. Each track is a loop file placed on a beat
 * grid: time-stretched to the arrangement's tempo with rubberband when its
 * own tempo differs, tiled to length, shaped (fades, high/low-pass, stepped
 * filter sweeps) and summed. The mix then gets one static loudness gain,
 * and a true-peak limiter only if the peaks need one (./loudness.ts).
 *
 *   node --import tsx scripts/audio/loopBed.ts --arrangement <file.json|module.ts> \
 *     --library <loop folder> --out <bed.wav> [--export arrangement] [--stem <name>] \
 *     [--report <file.json>]
 *
 * The arrangement is data (a JSON file, or a module export): see
 * `Arrangement`. Track files are relative to --library. `--stem drums`
 * renders only the tracks labelled `stem: 'drums'` (the drum part on its own,
 * say, to transcribe for a highway), at the same loudness gain as the full
 * bed so the two line up.
 *
 * macOS only for AAC loops (Apple Loops are AAC in CAF): the encoder's
 * priming samples, which ffmpeg keeps when it decodes a CAF and which would
 * put every loop late and leave a gap at each seam, are read with macOS's
 * `afinfo`. Loops in formats without priming (WAV, AIFF, FLAC) work
 * anywhere.
 */
import path from 'node:path';
import {
  UsageError,
  isMain,
  loadData,
  need,
  parseFlags,
  runCli,
} from '../lib/cli';
import {
  checkArray,
  checkNumber,
  checkRecord,
  checkString,
  throwProblems,
} from '../lib/check';
import {writeJsonAtomic} from '../lib/files';
import {ffmpeg, ffprobeJson, run} from '../lib/proc';
import {maxOf} from '../lib/numbers';
import {biquad, biquadSteps, butterworth, dbToGain, type Biquad} from './dsp';
import {
  loudnessProblems,
  normalizeLinear,
  type LoudnessTarget,
} from './loudness';
import {applyMaster, master} from './master';
import {SAMPLE_RATE, allocStereo, writeWav, type Stereo} from './pcm';

export interface LoopTrack {
  /** The loop file, relative to the library folder. */
  file: string;
  /** Beat the track starts on (0-based) and its length, in the arrangement's beats. */
  startBeat: number;
  beats: number;
  /** The loop's own length in beats: its tiling period. */
  loopBeats: number;
  /** The loop's native tempo (default: the arrangement's); stretched when different. */
  bpm?: number;
  /**
   * How rubberband stretches it: 'smooth' (its defaults, for tonal parts) or
   * 'percussive' (crisp transients, short windows, independent phase: drum
   * attacks stay within about 2 ms of the grid instead of smearing 10 ms
   * early). Default 'smooth'.
   */
  stretch?: 'smooth' | 'percussive';
  /** Beats into the loop where the track starts (default 0). */
  offsetBeats?: number;
  gainDb?: number;
  fadeInBeats?: number;
  fadeOutBeats?: number;
  highpassHz?: number;
  lowpassHz?: number;
  /**
   * A stepped filter sweep: the track's beats in equal slices, each lowpassed
   * at the next cutoff (Hz), so the filter opens (or closes) step by step.
   * The filter runs on through the steps without restarting.
   */
  sweep?: readonly number[];
  /** A label for rendering a group of tracks on its own (--stem). */
  stem?: string;
}

export interface Arrangement {
  bpm: number;
  /** The bed's length in beats (default: where the last track ends). */
  lengthBeats?: number;
  tracks: readonly LoopTrack[];
  /** Default -14 LUFS, -1.5 dBTP. */
  loudness?: LoudnessTarget;
}

const STRETCH_OPTIONS = {
  smooth: '',
  percussive:
    ':transients=crisp:detector=percussive:phase=independent:window=short',
} as const;

/** Checks an arrangement as it arrives from a file or module, and narrows it; throws naming every problem. */
export function assertArrangement(
  value: unknown,
): asserts value is Arrangement {
  const p: string[] = [];
  if (!checkRecord(p, value, 'the arrangement'))
    return throwProblems('Bad arrangement', p);
  checkNumber(p, value.bpm, 'bpm', {above: 0});
  if (value.lengthBeats !== undefined)
    checkNumber(p, value.lengthBeats, 'lengthBeats', {above: 0});
  if (
    value.loudness !== undefined &&
    checkRecord(p, value.loudness, 'loudness')
  ) {
    checkNumber(p, value.loudness.lufs, 'loudness.lufs', {max: 0});
    checkNumber(p, value.loudness.truePeakDb, 'loudness.truePeakDb', {max: 0});
  }
  if (checkArray(p, value.tracks, 'tracks')) {
    if (!value.tracks.length) p.push('there are no tracks');
    value.tracks.forEach((t, i) => {
      const at = `track ${i}`;
      if (!checkRecord(p, t, at)) return;
      checkString(p, t.file, `${at} file`);
      checkNumber(p, t.startBeat, `${at} startBeat`, {min: 0});
      const beats = checkNumber(p, t.beats, `${at} beats`, {above: 0});
      checkNumber(p, t.loopBeats, `${at} loopBeats`, {above: 0});
      for (const k of ['bpm', 'highpassHz', 'lowpassHz']) {
        if (t[k] !== undefined) checkNumber(p, t[k], `${at} ${k}`, {above: 0});
      }
      /** An optional length in beats: 0 when absent, undefined when bad. */
      const optionalBeats = (k: string) =>
        t[k] === undefined ? 0 : checkNumber(p, t[k], `${at} ${k}`, {min: 0});
      optionalBeats('offsetBeats');
      const fadeIn = optionalBeats('fadeInBeats');
      const fadeOut = optionalBeats('fadeOutBeats');
      if (t.gainDb !== undefined) checkNumber(p, t.gainDb, `${at} gainDb`);
      if (
        beats !== undefined &&
        fadeIn !== undefined &&
        fadeOut !== undefined &&
        fadeIn + fadeOut > beats
      ) {
        p.push(`${at}: its fades are longer than the track`);
      }
      if (t.sweep !== undefined && checkArray(p, t.sweep, `${at} sweep`)) {
        t.sweep.forEach((hz, k) =>
          checkNumber(p, hz, `${at} sweep[${k}]`, {above: 0}),
        );
      }
      if (
        t.stretch !== undefined &&
        !(
          typeof t.stretch === 'string' &&
          Object.hasOwn(STRETCH_OPTIONS, t.stretch)
        )
      ) {
        p.push(`${at}: stretch must be 'smooth' or 'percussive'`);
      }
      if (t.stem !== undefined) checkString(p, t.stem, `${at} stem`);
    });
  }
  throwProblems('Bad arrangement', p);
}

/** An AAC file's encoder priming frames and valid frames, from macOS `afinfo`. */
function aacFrames(file: string): {priming: number; valid: number} {
  if (process.platform !== 'darwin') {
    throw new Error(
      `${file} is AAC: its encoder priming is read with macOS afinfo, so AAC loops need macOS ` +
        '(convert the loop to WAV or FLAC to use it elsewhere)',
    );
  }
  const {stdout} = run('afinfo', [file]);
  const m = /(\d+)\s+valid frames\s*\+\s*(\d+)\s+priming/.exec(
    stdout.toString(),
  );
  if (!m) throw new Error(`afinfo reported no priming for ${file}`);
  return {valid: Number(m[1]), priming: Number(m[2])};
}

interface Probe {
  streams?: {codec_name?: string}[];
}

/** A loop may come out of the stretch this much short of its period (a zero tail). */
const SHORT_TOLERANCE_SEC = 0.002;

/**
 * One period of a loop at the arrangement's tempo, as SAMPLE_RATE stereo:
 * cut to its valid frames (priming and padding off), stretched with
 * rubberband when its tempo differs, cut to exactly `periodSamples`.
 */
function loopPeriod(
  file: string,
  nativeBpm: number,
  bpm: number,
  periodSamples: number,
  stretch: keyof typeof STRETCH_OPTIONS,
): Stereo {
  const codec = ffprobeJson<Probe>([
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name',
    file,
  ]).streams?.[0]?.codec_name;
  if (!codec) throw new Error(`${file} has no audio stream`);
  const aac = codec === 'aac' ? aacFrames(file) : null;
  const filters = [
    ...(aac
      ? [
          `atrim=start_sample=${aac.priming}:end_sample=${aac.priming + aac.valid}`,
          'asetpts=N/SR/TB',
        ]
      : []),
    `aresample=${SAMPLE_RATE}`,
    'aformat=channel_layouts=stereo',
    ...(nativeBpm !== bpm
      ? [`rubberband=tempo=${bpm / nativeBpm}${STRETCH_OPTIONS[stretch]}`]
      : []),
    `atrim=end_sample=${periodSamples}`,
  ];
  const {stdout} = ffmpeg([
    '-i',
    file,
    '-af',
    filters.join(','),
    '-f',
    'f32le',
    '-ac',
    '2',
    'pipe:1',
  ]);
  const pcm = new Float32Array(
    stdout.buffer.slice(
      stdout.byteOffset,
      stdout.byteOffset + stdout.byteLength,
    ),
  );
  const frames = pcm.length >> 1;
  if (frames < periodSamples - SHORT_TOLERANCE_SEC * SAMPLE_RATE) {
    throw new Error(
      `${file} is ${(frames / SAMPLE_RATE).toFixed(3)} s at ${bpm} BPM, shorter than its ` +
        `${(periodSamples / SAMPLE_RATE).toFixed(3)} s loop: check its loopBeats and bpm`,
    );
  }
  const out = allocStereo(periodSamples);
  for (let i = 0; i < Math.min(frames, periodSamples); i++) {
    out.l[i] = pcm[2 * i]!;
    out.r[i] = pcm[2 * i + 1]!;
  }
  return out;
}

/**
 * The lowpass of a track as steps over its samples: one cutoff throughout,
 * or a sweep's cutoffs on equal slices of its beats.
 */
function lowpassSteps(
  t: LoopTrack,
  beatSamples: number,
): {from: number; f: Biquad}[] {
  const start = Math.round(t.startBeat * beatSamples);
  if (t.sweep?.length) {
    const n = t.sweep.length;
    return t.sweep.map((hz, k) => ({
      from: Math.round((t.startBeat + (k * t.beats) / n) * beatSamples) - start,
      f: butterworth('lp', hz),
    }));
  }
  return t.lowpassHz ? [{from: 0, f: butterworth('lp', t.lowpassHz)}] : [];
}

/**
 * Adds one track to the mix: its loop tiled from the offset for the whole
 * track, filtered (a sweep steps the lowpass without resetting it), faded,
 * gained and placed. Start and end are rounded once, on the beat grid, so
 * tracks meet sample-exact.
 */
export function addTrack(
  mix: Stereo,
  t: LoopTrack,
  period: Stereo,
  beatSamples: number,
): void {
  const n = period.l.length;
  const start = Math.round(t.startBeat * beatSamples);
  const end = Math.min(
    Math.round((t.startBeat + t.beats) * beatSamples),
    mix.l.length,
  );
  const length = end - start;
  if (length <= 0) return;
  const offset = Math.round((t.offsetBeats ?? 0) * beatSamples);
  const g = dbToGain(t.gainDb ?? 0);
  const fadeIn = Math.round((t.fadeInBeats ?? 0) * beatSamples);
  const fadeOut = Math.round((t.fadeOutBeats ?? 0) * beatSamples);
  const highpass = t.highpassHz ? butterworth('hp', t.highpassHz) : null;
  const lowpass = lowpassSteps(t, beatSamples);
  for (const ch of ['l', 'r'] as const) {
    let x: Float32Array | Float64Array = new Float32Array(length);
    for (let i = 0; i < length; i++) x[i] = period[ch][(offset + i) % n]!;
    if (highpass) x = biquad(x, highpass);
    if (lowpass.length) x = biquadSteps(x, lowpass);
    for (let i = 0; i < length; i++) {
      let k = g;
      if (i < fadeIn) k *= i / fadeIn;
      if (i >= length - fadeOut) k *= (length - i) / fadeOut;
      mix[ch][start + i] = mix[ch][start + i]! + x[i]! * k;
    }
  }
}

export interface LoopBedOptions {
  arrangement: Arrangement;
  library: string;
  out: string;
  /** Render only the tracks with this `stem` label (at the full bed's gain). */
  stem?: string;
}

/** Arranges, mixes and normalises the bed (or one stem of it); returns its report. */
export function buildLoopBed(options: LoopBedOptions) {
  const a = options.arrangement;
  assertArrangement(a);
  const target = a.loudness ?? {lufs: -14, truePeakDb: -1.5};
  const beatSamples = (60 / a.bpm) * SAMPLE_RATE;
  const lengthBeats =
    a.lengthBeats ??
    maxOf(
      a.tracks.map(t => t.startBeat + t.beats),
      0,
    );
  const total = Math.round(lengthBeats * beatSamples);
  const periods = new Map<string, Stereo>();
  const periodOf = (p: LoopTrack) => {
    const key = `${p.file}@${p.bpm ?? a.bpm}/${p.loopBeats}/${p.stretch ?? 'smooth'}`;
    let period = periods.get(key);
    if (!period) {
      period = loopPeriod(
        path.join(options.library, p.file),
        p.bpm ?? a.bpm,
        a.bpm,
        Math.round(p.loopBeats * beatSamples),
        p.stretch ?? 'smooth',
      );
      periods.set(key, period);
    }
    return period;
  };
  const mixOf = (only: (t: LoopTrack) => boolean) => {
    const mix = allocStereo(total);
    for (const t of a.tracks.filter(only))
      addTrack(mix, t, periodOf(t), beatSamples);
    return mix;
  };

  const summary = {
    bpm: a.bpm,
    lengthBeats,
    lengthSec: total / SAMPLE_RATE,
    tracks: a.tracks.length,
  };
  const full = mixOf(() => true);
  if (!options.stem) {
    const {report: loudness} = normalizeLinear(full, options.out, target);
    return {
      ...summary,
      loudness,
      stem: null,
      problems: loudnessProblems(loudness.output, target),
    };
  }
  const stem = options.stem;
  const only = (t: LoopTrack) => t.stem === stem;
  const count = a.tracks.filter(only).length;
  if (!count) throw new Error(`No track has stem "${stem}"`);
  // The full bed's master (gain and limiter curve), so the stem lines up with it.
  const m = master([full], target.lufs, target.truePeakDb);
  const audio = mixOf(only);
  applyMaster([audio], m);
  writeWav(options.out, audio);
  return {
    ...summary,
    loudness: null,
    stem: {
      name: stem,
      tracks: count,
      out: options.out,
      gainDb: m.gainDb,
      limiterMaxReductionDb: m.maxReductionDb,
    },
    problems: [],
  };
}

const USAGE = `
Usage: node --import tsx scripts/audio/loopBed.ts --arrangement <file.json|module.ts> \\
         --library <loop folder> --out <bed.wav> [--export arrangement] [--stem <name>] [--report <file.json>]
`;

async function main(): Promise<void> {
  const {values} = parseFlags({
    arrangement: {type: 'string'},
    export: {type: 'string', default: 'arrangement'},
    library: {type: 'string'},
    out: {type: 'string'},
    stem: {type: 'string'},
    report: {type: 'string'},
  });
  const file = need(values.arrangement, 'arrangement');
  const arrangement = await loadData(file, values.export);
  assertArrangement(arrangement);
  const report = buildLoopBed({
    arrangement,
    library: path.resolve(need(values.library, 'library')),
    out: path.resolve(need(values.out, 'out')),
    stem: values.stem,
  });
  console.log(JSON.stringify(report, null, 2));
  if (values.report) writeJsonAtomic(values.report, report, 2);
  console.log(`wrote ${values.out}`);
  if (report.problems.length) {
    console.error(`Loop bed check failed: ${report.problems.join('; ')}`);
    process.exitCode = 1;
  }
}

if (isMain(import.meta.url)) runCli(USAGE, main);
