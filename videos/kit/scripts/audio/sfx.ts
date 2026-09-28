/**
 * Sound design for a finished film: every effect is synthesized here with
 * ffmpeg (no third-party samples), placed at its cue frame over the music
 * bed, and the mix is brought to the loudness target with one static gain
 * (./loudness.ts), so the music keeps its build-to-drop contrast.
 *
 *   node --import tsx scripts/audio/sfx.ts --cues <cues.json|module.ts> [--fps <fps>] \
 *     --out <mix.wav> (--bed <bed.wav> | --length <frames>) [--export sfx] \
 *     [--lufs -14] [--true-peak -1.5] [--raw] [--kinds-dir <dir>] [--report <file.json>]
 *   node --import tsx scripts/audio/sfx.ts --list-kinds
 *
 * A cue is `{frame, kind, pan?, gain?}`: the film frame the sound starts on,
 * one of KINDS, a stereo position (-1 left .. 1 right, or `{from, to}` to
 * move across the sound; default: the kind's own), and dB relative to the
 * kind's level. `--cues` is a JSON array or a module whose export (`--export`,
 * default `sfx`) is that array. The frame rate is --fps, or the `fps` a cue
 * module exports beside its cues (a JSON cue list needs --fps; when both are
 * given they must agree). Without `--bed`, `--length` (frames) sets the
 * length and the sounds are mixed over silence.
 */
import path from 'node:path';
import {
  UsageError,
  int,
  isMain,
  loadData,
  moduleExports,
  need,
  num,
  parseFlags,
  positive,
  runCli,
} from '../lib/cli';
import {
  checkArray,
  checkNumber,
  checkRecord,
  throwProblems,
} from '../lib/check';
import {writeJsonAtomic} from '../lib/files';
import {ffmpeg} from '../lib/proc';
import {maxOf} from '../lib/numbers';
import {dbToGain} from './dsp';
import {
  loudnessProblems,
  normalizeLinear,
  type LoudnessReport,
} from './loudness';
import {
  SAMPLE_RATE,
  allocStereo,
  decodeStereo,
  writeWav,
  type Stereo,
} from './pcm';

/** A stereo position, -1 (left) .. 1 (right), fixed or moving across the sound. */
export type Pan = number | {from: number; to: number};

export interface SfxKindSpec {
  what: string;
  /** An ffmpeg lavfi graph producing the sound (mono, SAMPLE_RATE). */
  graph: string;
  /** Level after peak normalisation to -1 dBFS, dB. */
  levelDb: number;
  pan: Pan;
}

/** Deterministic noise: anoisesrc picks a random seed unless given one. */
const NOISE_SEED = 1;

/**
 * Pink noise through a lowpass whose cutoff rises `lo` -> `hi` -> `lo`
 * across `dur`: air moving past.
 */
function sweepNoise(
  dur: number,
  lo: number,
  hi: number,
  envPow: number,
): string {
  const steps = 24;
  const cmds = Array.from({length: steps + 1}, (_, k) => {
    const f = lo + (hi - lo) * (1 - Math.abs((2 * k) / steps - 1)) ** 1.5;
    return `${((dur * k) / steps).toFixed(3)} lowpass@lp f ${f.toFixed(0)}`;
  }).join('; ');
  return (
    `anoisesrc=d=${dur}:c=pink:a=0.9:r=${SAMPLE_RATE}:seed=${NOISE_SEED},asendcmd=c='${cmds}',` +
    `lowpass@lp=f=${lo},highpass=f=120,volume='pow(sin(PI*t/${dur}),${envPow})':eval=frame`
  );
}

const evalSrc = (expr: string, dur: number): string =>
  `aevalsrc='${expr}':d=${dur}:s=${SAMPLE_RATE}`;

/**
 * A moving sound sweeps from -0.8 to 0.8. The pan law puts a centred sound at
 * unity in both channels, so a moving one peaks 3 dB above a law that is
 * unity at the edges; the moving kinds' levels are 3 dB lower to match.
 */
const ACROSS: Pan = {from: -0.8, to: 0.8};

export const KINDS = {
  click: {
    what: 'mouse button down and release, 55 ms apart',
    graph:
      evalSrc(
        '(random(0)*2-1)*exp(-t*900)*0.9+(random(1)*2-1)*exp(-(t-0.055)*1100)*gte(t,0.055)*0.5+sin(2*PI*3200*t)*exp(-t*600)*0.4',
        0.12,
      ) + ',highpass=f=1500',
    levelDb: -17,
    pan: 0,
  },
  tick: {
    what: 'a UI toggle: bright, very short',
    graph: evalSrc(
      'sin(2*PI*2350*t)*exp(-t*140)+0.3*sin(2*PI*4700*t)*exp(-t*220)',
      0.08,
    ),
    levelDb: -21,
    pan: 0,
  },
  pop: {
    what: 'an element appearing: a quick upward blip',
    graph: evalSrc('sin(2*PI*(260*t+2600*t*t))*exp(-t*28)', 0.16),
    levelDb: -19,
    pan: 0,
  },
  swipe: {
    what: 'a cut or a card sliding in (0.3 s)',
    graph: sweepNoise(0.3, 1500, 9000, 3),
    levelDb: -22,
    pan: ACROSS,
  },
  whoosh: {
    what: 'a camera move (0.65 s, loudest half way: cue it 0.33 s before the fastest point)',
    graph: sweepNoise(0.65, 350, 5200, 2.5),
    levelDb: -18,
    pan: ACROSS,
  },
  'whoosh-long': {
    what: 'a long camera move (1.3 s)',
    graph: sweepNoise(1.3, 250, 4200, 2),
    levelDb: -17,
    pan: ACROSS,
  },
  impact: {
    what: 'the drop: a sub hit with a pitch fall, a noise crack and a short room tail',
    graph:
      evalSrc(
        'sin(2*PI*(62*t-26*t*t))*exp(-t*3.2)*0.9+(random(0)*2-1)*exp(-t*22)*0.5',
        1.4,
      ) + ',lowpass=f=2400,aecho=0.8:0.5:60|110:0.3|0.2',
    levelDb: -9,
    pan: 0,
  },
  riser: {
    what: 'a two-second build into a downbeat (cue it 2 s before the hit)',
    graph:
      evalSrc(
        '(random(0)*2-1)*pow(t/2,2.5)*0.7+sin(2*PI*(180*t+260*t*t))*pow(t/2,2)*0.35',
        2,
      ) + ',highpass=f=400',
    levelDb: -14,
    pan: 0,
  },
  success: {
    what: 'a completed action: a rising two-note chime',
    graph:
      evalSrc(
        '(sin(2*PI*1318.5*t)+0.35*sin(2*PI*2637*t))*exp(-t*7)+(sin(2*PI*1975.5*(t-0.085))+0.35*sin(2*PI*3951*(t-0.085)))*exp(-(t-0.085)*6)*gte(t,0.085)',
        0.9,
      ) + ',aecho=0.8:0.4:90:0.25',
    levelDb: -15,
    pan: 0,
  },
} satisfies Record<string, SfxKindSpec>;

export type SfxKind = keyof typeof KINDS;

export interface SfxCue {
  /** Film frame the sound starts on. */
  frame: number;
  kind: SfxKind;
  /** Default: the kind's own. */
  pan?: Pan;
  /** dB relative to the kind's level. */
  gain?: number;
}

const isKind = (k: string): k is SfxKind => Object.hasOwn(KINDS, k);

/** Checks a cue list as it arrives from a file or module, and narrows it; throws naming every bad cue. */
export function assertCues(value: unknown): asserts value is SfxCue[] {
  const p: string[] = [];
  if (!checkArray(p, value, 'the cues')) return throwProblems('Bad cues', p);
  const pan = {min: -1, max: 1};
  value.forEach((c, i) => {
    const at = `cue ${i}`;
    if (!checkRecord(p, c, at)) return;
    checkNumber(p, c.frame, `${at} frame`, {min: 0, integer: true});
    if (typeof c.kind !== 'string' || !isKind(c.kind)) {
      p.push(
        `${at}: unknown kind ${JSON.stringify(c.kind)} (known: ${Object.keys(KINDS).join(', ')})`,
      );
    }
    if (c.gain !== undefined) checkNumber(p, c.gain, `${at} gain`);
    if (typeof c.pan === 'number' || c.pan === undefined) {
      if (c.pan !== undefined) checkNumber(p, c.pan, `${at} pan`, pan);
    } else if (checkRecord(p, c.pan, `${at} pan`)) {
      checkNumber(p, c.pan.from, `${at} pan.from`, pan);
      checkNumber(p, c.pan.to, `${at} pan.to`, pan);
    }
  });
  throwProblems('Bad cues', p);
}

/** One kind rendered to mono and peak-normalised to -1 dBFS. */
function renderKind(kind: SfxKind): Float32Array {
  const {stdout} = ffmpeg([
    '-f',
    'lavfi',
    '-i',
    KINDS[kind].graph,
    '-ac',
    '1',
    '-ar',
    String(SAMPLE_RATE),
    '-f',
    'f32le',
    'pipe:1',
  ]);
  const mono = new Float32Array(
    stdout.buffer.slice(
      stdout.byteOffset,
      stdout.byteOffset + stdout.byteLength,
    ),
  );
  const peak = maxOf(Array.from(mono, Math.abs), 0);
  if (!(peak > 0)) throw new Error(`The ${kind} sound rendered silent`);
  const k = dbToGain(-1) / peak;
  for (let i = 0; i < mono.length; i++) mono[i] = mono[i]! * k;
  return mono;
}

/**
 * Constant-power pan for a position in -1..1, scaled so a centred sound is
 * at unity in both channels.
 */
export function panGains(p: number): [number, number] {
  const theta = (Math.PI / 4) * (1 + p);
  return [Math.SQRT2 * Math.cos(theta), Math.SQRT2 * Math.sin(theta)];
}

/** Adds every cue's sound into `mix` (in place) at its frame's sample. */
export function placeCues(
  mix: Stereo,
  cues: readonly SfxCue[],
  fps: number,
  sounds: ReadonlyMap<SfxKind, Float32Array>,
): void {
  const total = mix.l.length;
  for (const cue of cues) {
    const sound = sounds.get(cue.kind);
    if (!sound) throw new Error(`No rendered sound for ${cue.kind}`);
    const spec = KINDS[cue.kind];
    const g = dbToGain(spec.levelDb + (cue.gain ?? 0));
    const pan = cue.pan ?? spec.pan;
    const start = Math.round((cue.frame / fps) * SAMPLE_RATE);
    const n = Math.min(sound.length, total - start);
    for (let i = 0; i < n; i++) {
      const p =
        typeof pan === 'number'
          ? pan
          : pan.from +
            (pan.to - pan.from) * (i / Math.max(1, sound.length - 1));
      const [gl, gr] = panGains(p);
      const v = sound[i]! * g;
      mix.l[start + i] = mix.l[start + i]! + v * gl;
      mix.r[start + i] = mix.r[start + i]! + v * gr;
    }
  }
}

export interface SfxOptions {
  cues: readonly SfxCue[];
  fps: number;
  /** The music bed; without one, `length` (frames) sets the mix's length. */
  bed?: string;
  length?: number;
  out: string;
  /** Loudness target; null writes the placed mix as it is. */
  loudness: {lufs: number; truePeakDb: number} | null;
  /** Also write each kind's rendered sound here (for auditioning). */
  kindsDir?: string;
}

/**
 * Renders the cues' sounds, places them over the bed (or silence) and, with
 * a loudness target, normalises the mix; returns its report.
 */
export function buildSfxMix(options: SfxOptions) {
  assertCues(options.cues);
  if (!(options.fps > 0))
    throw new Error(`fps must be above 0, got ${options.fps}`);
  if (!options.bed && !(options.length && options.length > 0)) {
    throw new Error('The mix needs a bed, or a length in frames');
  }
  const mix = options.bed
    ? decodeStereo(options.bed)
    : allocStereo(Math.round((options.length! / options.fps) * SAMPLE_RATE));
  const kinds = [...new Set(options.cues.map(c => c.kind))].sort();
  const sounds = new Map(kinds.map(k => [k, renderKind(k)] as const));
  if (options.kindsDir) {
    for (const [kind, mono] of sounds) {
      writeWav(
        path.join(options.kindsDir, `${kind}.wav`),
        {l: mono, r: mono},
        32,
      );
    }
  }
  placeCues(mix, options.cues, options.fps, sounds);
  const lastCue = maxOf(
    options.cues.map(c => c.frame),
    -1,
  );
  const lengthFrames = (mix.l.length / SAMPLE_RATE) * options.fps;
  const report = {
    cues: options.cues.length,
    kinds,
    lengthSec: mix.l.length / SAMPLE_RATE,
    cuesPastTheEnd: options.cues.filter(c => c.frame >= lengthFrames).length,
    lastCueFrame: lastCue,
    loudness: null as LoudnessReport | null,
    problems: [] as string[],
  };
  if (report.cuesPastTheEnd) {
    report.problems.push(
      `${report.cuesPastTheEnd} cues start after the mix ends`,
    );
  }
  const {loudness} = options;
  if (!loudness) {
    writeWav(options.out, mix);
    return report;
  }
  const normalized = normalizeLinear(mix, options.out, loudness);
  report.loudness = normalized.report;
  report.problems.push(...loudnessProblems(normalized.report.output, loudness));
  return report;
}

/**
 * The cues' frame rate: --fps, else the `fps` the cue module exports beside
 * its cues. When both are given they must agree.
 */
async function cueFps(
  cuesFile: string,
  flag: string | undefined,
): Promise<number> {
  const json = /\.json$/i.test(cuesFile);
  const exported = json ? undefined : (await moduleExports(cuesFile)).fps;
  if (
    exported !== undefined &&
    !(typeof exported === 'number' && exported > 0)
  ) {
    throw new Error(
      `${cuesFile} exports fps ${JSON.stringify(exported)}; it must be a number above 0`,
    );
  }
  if (flag === undefined) {
    if (exported === undefined) {
      throw new UsageError(
        json
          ? 'a JSON cue list needs --fps'
          : `give --fps, or export fps from ${cuesFile}`,
      );
    }
    return exported;
  }
  const fps = positive(flag, 'fps');
  if (exported !== undefined && exported !== fps) {
    throw new UsageError(
      `--fps ${fps} disagrees with the fps ${cuesFile} exports, ${exported}`,
    );
  }
  return fps;
}

const USAGE = `
Usage: node --import tsx scripts/audio/sfx.ts --cues <cues.json|module.ts> [--fps <fps>]
         --out <mix.wav> (--bed <bed.wav> | --length <frames>) [--export sfx]
         [--lufs -14] [--true-peak -1.5] [--raw] [--kinds-dir <dir>] [--report <file.json>]
       node --import tsx scripts/audio/sfx.ts --list-kinds
`;

async function main(): Promise<void> {
  const {values} = parseFlags({
    cues: {type: 'string'},
    export: {type: 'string', default: 'sfx'},
    fps: {type: 'string'},
    bed: {type: 'string'},
    length: {type: 'string'},
    out: {type: 'string'},
    lufs: {type: 'string'},
    'true-peak': {type: 'string'},
    raw: {type: 'boolean', default: false},
    'kinds-dir': {type: 'string'},
    report: {type: 'string'},
    'list-kinds': {type: 'boolean', default: false},
  });
  if (values['list-kinds']) {
    for (const [kind, spec] of Object.entries(KINDS)) {
      console.log(
        `${kind.padEnd(12)} ${String(spec.levelDb).padStart(4)} dB  ${spec.what}`,
      );
    }
    return;
  }
  const cuesFile = need(values.cues, 'cues');
  if (!values.bed && values.length === undefined) {
    throw new UsageError(
      'give --bed, or --length (frames) for a mix without one',
    );
  }
  const cues = await loadData(cuesFile, values.export);
  assertCues(cues);
  const report = buildSfxMix({
    cues,
    fps: await cueFps(cuesFile, values.fps),
    bed: values.bed,
    length:
      values.length === undefined
        ? undefined
        : int(values.length, 'length', undefined, 1),
    out: path.resolve(need(values.out, 'out')),
    loudness: values.raw
      ? null
      : {
          lufs: num(values.lufs, 'lufs', -14),
          truePeakDb: num(values['true-peak'], 'true-peak', -1.5),
        },
    kindsDir: values['kinds-dir'],
  });
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (values.report) writeJsonAtomic(values.report, report, 2);
  console.log(`${cues.length} cues -> ${values.out}`);
  if (report.problems.length) {
    console.error(`SFX mix check failed: ${report.problems.join('; ')}`);
    process.exitCode = 1;
  }
}

if (isMain(import.meta.url)) runCli(USAGE, main);
