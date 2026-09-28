/**
 * `buildSoundtrack`: a film's soundtrack and the timing data every scene
 * syncs to, from a chart folder and the film's edit (./soundtrackConfig.ts).
 *
 *   node --import tsx scripts/audio/soundtrack.ts --config <soundtrack.config.ts> \
 *     --chart <chart folder> --out <film>/public/generated [--export default] [--report <file.json>]
 *
 * The chart folder needs a notes.chart (or notes.mid), song.ini and the
 * stems the config names; the full mix is their plain sum, as the game plays
 * it. Writes under --out, each file atomically:
 *
 *   audio/mix.wav            the mastered mix (24-bit, 48 kHz)
 *   audio/stems/<stem>.wav   each stem at the master's gain; they sum to the mix
 *   peaks.json, envelopes.json   per-stem curves and the mix's
 *   timeline.json            the contract (src/music/contract.ts), credits in `meta`; written last
 *
 * Lyric text is never written anywhere: only syllable timing leaves the
 * chart module. Deterministic: the same inputs give the same bytes. The
 * verification numbers go to stdout (and --report); when a check fails the
 * files are still written, for inspection, and the tool exits 1.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {Timeline} from '../../src/music/contract';
import {beatGrid} from '../../src/music/beatGrid';
import {songTimeAt} from '../../src/music/songTime';
import {importExport, isMain, need, parseFlags, runCli} from '../lib/cli';
import {writeJsonAtomic} from '../lib/files';
import {maxOf, minOf} from '../lib/numbers';
import {loadSongChart, type SongChart} from './chart';
import {
  addRingOut,
  applyGain,
  fadeInStart,
  fadeOutEnd,
  gainCurve,
  makeImpulseResponse,
  placeCrossfade,
  renderEdit,
  silentRanges,
  splicesOf,
  checkTailTimes,
  type FadeWindow,
  type GainPoint,
  type Splice,
  type TailSpec,
  type TimeRange,
} from './edit';
import {applyMaster, master, sumStems, type MasterResult} from './master';
import {
  SAMPLE_RATE,
  allocStereo,
  decodeStereo,
  readWav,
  writeWav,
  type Stereo,
} from './pcm';
import {
  atParts,
  assertSoundtrackConfig,
  configPositions,
  editSegments,
  lanePoints,
  stemFiles,
  stemName,
  timeAt,
  type EditSegment,
  type GainLane,
  type SoundtrackConfig,
  type TimeOfBeat,
} from './soundtrackConfig';
import {
  buildEnvelopes,
  buildPeaks,
  buildTimeline,
  gridTimeline,
} from './timeline';
import {
  attackOffsets,
  clickCheck,
  editLagCheck,
  ffmpegLoudness,
  groupDrumHits,
  syncReport,
  syncVsSource,
} from './verify';

const AUDIO_EXTENSIONS = ['opus', 'ogg', 'mp3', 'wav', 'flac', 'm4a'];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The audio file named `base` in the chart folder. */
function findStemFile(folder: string, base: string): string {
  const re = new RegExp(
    `^${escapeRegExp(base)}\\.(${AUDIO_EXTENSIONS.join('|')})$`,
    'i',
  );
  const match = fs.readdirSync(folder).find(f => re.test(f));
  if (!match) throw new Error(`No "${base}" audio file in the chart folder`);
  return path.join(folder, match);
}

/** A stem decoded from its file(s), several files summed. */
function decodeStem(folder: string, files: readonly string[]): Stereo {
  const parts = files.map(f => decodeStereo(findStemFile(folder, f)));
  return parts.length === 1 ? parts[0]! : sumStems(parts);
}

const record = <T>(
  names: readonly string[],
  f: (name: string) => T,
): Record<string, T> => Object.fromEntries(names.map(n => [n, f(n)]));

export interface SoundtrackPaths {
  /** The chart folder. */
  chart: string;
  /** Where the generated files go (normally the film's public/generated). */
  out: string;
}

/** The files `buildSoundtrack` writes under `out`. */
export const soundtrackFiles = (out: string, stems: readonly string[]) => ({
  timeline: path.join(out, 'timeline.json'),
  peaks: path.join(out, 'peaks.json'),
  envelopes: path.join(out, 'envelopes.json'),
  mix: path.join(out, 'audio', 'mix.wav'),
  stems: record(stems, s => path.join(out, 'audio', 'stems', `${s}.wav`)),
});

interface Rendered {
  song: SongChart;
  segments: EditSegment[];
  sources: Record<string, Stereo>;
  edited: Record<string, Stereo>;
  mix: Stereo;
  splices: Splice<string, EditSegment>[];
  lanes: {lane: GainLane; points: GainPoint[]}[];
  vocalMutes: TimeRange[];
  tail: TailSpec | null;
  mastered: MasterResult;
}

/** The chart through the edit: every stem rendered, automated and mastered. */
function render(config: SoundtrackConfig, chart: string): Rendered {
  const {durationSec, fps} = config;
  const names = config.stems.map(stemName);
  const total = Math.round(durationSec * SAMPLE_RATE);

  const song = loadSongChart(chart);
  const segments = editSegments(song.bars, config.songBars, durationSec, fps);

  // The film's own grid, for placing automation on bars and beats.
  const grid = gridTimeline(song, segments, durationSec, fps);
  const timeOfBeat: TimeOfBeat = beatGrid(grid).timeOfBeat;
  for (const [what, at] of configPositions(config)) {
    const [bar] = atParts(at);
    if (bar > grid.bars.length) {
      throw new Error(
        `${what}: video bar ${bar} is past the film's ${grid.bars.length} bars`,
      );
    }
  }

  const lanes = (config.lanes ?? []).map(lane => ({
    lane,
    points: lanePoints(lane, timeOfBeat),
  }));
  const vocal = config.vocalStem;
  const vocalMutes = lanes
    .filter(
      ({lane}) => vocal && lane.kind === 'mute' && lane.stems.includes(vocal),
    )
    .flatMap(({points}) => silentRanges(points, durationSec))
    .sort((a, b) => a.startSec - b.startSec);

  const t = config.tail;
  const tail: TailSpec | null = t
    ? {
        sendStartSec: timeAt(timeOfBeat, t.send),
        sendRampSec: t.sendRampSec,
        rt60Sec: t.rt60Sec,
        wetDb: t.wetDb,
        preDelaySec: t.preDelaySec,
        brightHz: t.brightHz,
        darkHz: t.darkHz,
        darkenSec: t.darkenSec,
        lowCutHz: t.lowCutHz,
        dryFadeStartSec: timeAt(timeOfBeat, t.dryFade.from),
        dryFadeEndSec: timeAt(timeOfBeat, t.dryFade.to),
        seed: t.seed,
      }
    : null;
  if (tail) checkTailTimes(tail, durationSec);
  const ir = tail ? makeImpulseResponse(tail) : null;

  const sources = record(names, name =>
    decodeStem(chart, stemFiles(config.stems.find(s => stemName(s) === name)!)),
  );
  const fadeSpec = (stem: string) =>
    config.crossfade.stems?.[stem] ?? config.crossfade.default;
  const splices = splicesOf(segments, (outgoing, incoming) =>
    record(names, stem =>
      placeCrossfade(sources[stem]!, outgoing, incoming, fadeSpec(stem)),
    ),
  );
  const edited = record(names, stem => {
    const s = renderEdit(sources[stem]!, segments, splices, stem, total);
    for (const {lane, points} of lanes) {
      if (lane.stems.includes(stem)) applyGain(s, gainCurve(points, total));
    }
    if (tail && ir) addRingOut(s, ir, tail);
    fadeInStart(s, config.startFadeSec);
    fadeOutEnd(s, config.finalFadeSec);
    return s;
  });

  // One gain (and a limiter only if needed) shared by every stem.
  const stems = names.map(n => edited[n]!);
  const mastered = master(stems, config.master.lufs, config.master.ceilingDbtp);
  applyMaster(stems, mastered);
  return {
    song,
    segments,
    sources,
    edited,
    mix: sumStems(stems),
    splices,
    lanes,
    vocalMutes,
    tail,
    mastered,
  };
}

const sec4 = (t: number) => t.toFixed(4);
const ms = (s: number) => Math.round(s * 1000);

/** timeline.json's `mix.notes`: what was done to the mix, in words. */
function describe(config: SoundtrackConfig, r: Rendered): string {
  const {fps} = config;
  const names = config.stems.map(stemName);
  const m = r.mastered;
  return [
    `Edit: song bars ${config.songBars.map(([a, b]) => `${a}-${b}`).join(', then ')}.`,
    ...r.splices.map(({outgoing, incoming, fades}) => {
      const at = incoming.videoStart;
      return (
        `Splice at ${sec4(at)} s (frame ${Math.round(at * fps)}), song bar ${outgoing.lastBar} to ${incoming.firstBar}: ` +
        `equal-power crossfades placed clear of attacks (ms relative to the bar line: ` +
        names
          .map(
            s =>
              `${s} ${ms(fades[s]!.startSec - at)}..${ms(fades[s]!.endSec - at)}`,
          )
          .join(', ') +
        ').'
      );
    }),
    ...r.lanes.map(({lane, points}) => {
      const stems = lane.stems.join('/');
      if (lane.kind === 'mute') {
        const silent = silentRanges(points, config.durationSec);
        return `${stems} silent ${silent.map(x => `${sec4(x.startSec)}-${sec4(x.endSec)} s`).join(' and ')}.`;
      }
      const [a, b, c, d] = points.map(p => sec4(p.atSec));
      return `${stems} ${lane.gainDb > 0 ? '+' : ''}${lane.gainDb} dB from ${b} s until ${d} s (ramps ${a}-${b} s and ${c}-${d} s).`;
    }),
    ...(r.tail
      ? [
          `Ending: reverb send opens at ${sec4(r.tail.sendStartSec)} s, RT60 ${r.tail.rt60Sec} s; dry stems fade ` +
            `${sec4(r.tail.dryFadeStartSec)}-${sec4(r.tail.dryFadeEndSec)} s.`,
        ]
      : []),
    `First ${config.startFadeSec * 1000} ms faded in; last ${config.finalFadeSec * 1000} ms faded to silence.`,
    `Master: ${m.gainDb >= 0 ? '+' : ''}${m.gainDb.toFixed(2)} dB on every stem` +
      (m.limiter
        ? `, true-peak limiter (max ${m.maxReductionDb.toFixed(2)} dB)`
        : ', no limiting') +
      '. Stems are written at the master gain and sum to the mix.',
    ...(config.notes ? [config.notes] : []),
  ].join(' ');
}

/**
 * Drum sync against the chart and the unedited stem, and the proof that the
 * edit moved no hit by a single sample; null without a drum stem or notes.
 */
function drumChecks(
  config: SoundtrackConfig,
  r: Rendered,
  timeline: Timeline,
  files: ReturnType<typeof soundtrackFiles>,
) {
  const stem = config.drumStem;
  const notes = timeline.notes.drums;
  if (!stem || !notes.length) return null;
  const written = readWav(files.stems[stem]!);
  const source = r.sources[stem]!;
  const attacks = attackOffsets(written, groupDrumHits(notes));
  // Past the start of the ring-out's dry fade the edit replaces the band
  // with its reverb tail on purpose: there is nothing to align.
  const aligned = notes.filter(
    d => d.t < (r.tail?.dryFadeStartSec ?? Infinity),
  );
  return {
    stem,
    sync: syncReport(attacks),
    syncVsSource: syncVsSource(attacks, source, t => songTimeAt(t, r.segments)),
    editLag: editLagCheck(
      written,
      source,
      aligned.map(d => ({t: d.t, songT: r.song.tickToSec(d.tick)})),
    ),
  };
}

/** The verification numbers, and what failed. */
function verify(
  config: SoundtrackConfig,
  r: Rendered,
  timeline: Timeline,
  files: ReturnType<typeof soundtrackFiles>,
) {
  const names = config.stems.map(stemName);
  const total = Math.round(config.durationSec * SAMPLE_RATE);
  const m = r.mastered;
  const written = readWav(files.mix);
  const ff = ffmpegLoudness(files.mix);
  const clicks = r.splices.flatMap(({incoming, fades}) => {
    const windows: FadeWindow[] = names.map(s => fades[s]!);
    const union: FadeWindow = {
      startSec: minOf(windows.map(w => w.startSec)),
      endSec: maxOf(windows.map(w => w.endSec)),
    };
    const checks = [
      ...names.map(stem => ({stem, audio: r.edited[stem]!, w: fades[stem]!})),
      {stem: 'mix', audio: r.mix, w: union},
    ];
    return checks.map(({stem, audio, w}) => {
      const c = clickCheck(audio, w);
      return {
        splice: incoming.videoStart,
        stem,
        ratio: +c.ratio.toFixed(3),
        hfRatio: +c.hfRatio.toFixed(3),
      };
    });
  });
  const drums = drumChecks(config, r, timeline, files);
  const report = {
    samples: written.l.length,
    durationSec: written.l.length / SAMPLE_RATE,
    loudness: {
      lufs: +m.lufs.toFixed(2),
      truePeakDb: +m.truePeakDb.toFixed(2),
      ffmpeg: ff,
    },
    masterGainDb: +m.gainDb.toFixed(2),
    limiterMaxReductionDb: +m.maxReductionDb.toFixed(2),
    splices: r.splices.map(({outgoing, incoming, fades}) => ({
      t: incoming.videoStart,
      songBars: [outgoing.lastBar, incoming.firstBar],
      fadesMs: record(names, s => [
        ms(fades[s]!.startSec - incoming.videoStart),
        ms(fades[s]!.endSec - incoming.videoStart),
      ]),
    })),
    clicks,
    drums,
    segments: timeline.segments,
    counts: {
      drums: timeline.notes.drums.length,
      guitar: timeline.notes.guitar.length,
      syllables: timeline.vocals.syllables.length,
      phrases: timeline.vocals.phrases.length,
    },
  };
  const {lufs, ceilingDbtp} = config.master;
  const problems: string[] = [];
  if (written.l.length !== total)
    problems.push(`mix has ${written.l.length} samples, expected ${total}`);
  if (!(Math.abs(m.lufs - lufs) <= 0.5))
    problems.push(`loudness ${m.lufs.toFixed(2)} LUFS, target ${lufs}`);
  if (!(Math.abs(ff.lufs - lufs) <= 0.5))
    problems.push(`ffmpeg reads ${ff.lufs} LUFS, target ${lufs}`);
  // Written as "not <=" so an unreadable (NaN) peak fails too.
  const peak = Math.max(m.truePeakDb, ff.truePeakDb);
  if (!(peak <= ceilingDbtp))
    problems.push(`true peak ${peak.toFixed(2)} dBTP, ceiling ${ceilingDbtp}`);
  if (config.drumStem && !drums) {
    problems.push(
      `drumStem is "${config.drumStem}" but the edit has no drum notes to check it against`,
    );
  }
  if (drums && drums.editLag.notes === 0) {
    problems.push(
      `no ${drums.stem} hit could be checked for sample-exact timing`,
    );
  }
  if (drums && drums.editLag.maxAbsLagSamples !== 0) {
    problems.push(
      `the edit moved ${drums.stem} hits by up to ${drums.editLag.maxAbsLagSamples} samples`,
    );
  }
  // A splice step clearly above anything in the surrounding 300 ms is a click.
  for (const c of clicks) {
    if (c.ratio > 1.5 || c.hfRatio > 1.5)
      problems.push(`possible click in ${c.stem} at ${c.splice} s`);
  }
  return {report, problems};
}

export interface SoundtrackResult {
  timeline: Timeline;
  report: ReturnType<typeof verify>['report'];
  problems: string[];
}

/** Checks the config, then renders, writes and verifies a film's soundtrack. See the file comment. */
export function buildSoundtrack(
  config: SoundtrackConfig,
  paths: SoundtrackPaths,
): SoundtrackResult {
  assertSoundtrackConfig(config);
  const chart = path.resolve(paths.chart);
  const out = path.resolve(paths.out);
  const r = render(config, chart);
  const names = config.stems.map(stemName);
  const files = soundtrackFiles(out, names);

  const timeline = buildTimeline({
    song: r.song,
    segments: r.segments,
    durationSec: config.durationSec,
    fps: config.fps,
    vocalMutes: r.vocalMutes,
    mixNotes: describe(config, r),
  });

  writeWav(files.mix, r.mix);
  for (const stem of names) writeWav(files.stems[stem]!, r.edited[stem]!);
  const pick = (only: readonly string[] | undefined) =>
    record(only ?? names, s => r.edited[s]!);
  writeJsonAtomic(
    files.peaks,
    buildPeaks(r.mix, pick(config.peaks?.stems), config.peaks?.rate ?? 240),
  );
  writeJsonAtomic(
    files.envelopes,
    buildEnvelopes(r.mix, pick(config.envelopes?.stems), config.fps),
  );
  writeJsonAtomic(files.timeline, timeline);

  return {timeline, ...verify(config, r, timeline, files)};
}

const USAGE = `
Usage: node --import tsx scripts/audio/soundtrack.ts --config <soundtrack.config.ts> \\
         --chart <chart folder> --out <dir> [--export default] [--report <file.json>]
`;

async function main(): Promise<void> {
  const {values} = parseFlags({
    config: {type: 'string'},
    export: {type: 'string', default: 'default'},
    chart: {type: 'string'},
    out: {type: 'string'},
    report: {type: 'string'},
  });
  const config = await importExport(
    need(values.config, 'config'),
    values.export,
  );
  assertSoundtrackConfig(config);
  const result = buildSoundtrack(config, {
    chart: need(values.chart, 'chart'),
    out: need(values.out, 'out'),
  });
  console.log(JSON.stringify(result.report, null, 2));
  if (values.report) writeJsonAtomic(values.report, result.report, 2);
  if (result.problems.length) {
    console.error(`Verification failed: ${result.problems.join('; ')}`);
    process.exitCode = 1;
  }
}

if (isMain(import.meta.url)) runCli(USAGE, main);
