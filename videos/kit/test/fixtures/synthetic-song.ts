/**
 * A synthetic chart folder for exercising the soundtrack tools without song
 * material: notes.chart and song.ini with invented metadata, and one
 * synthesized stem per part whose every hit lands exactly on its chart note.
 *
 *   node --import tsx test/fixtures/synthetic-song.ts --out <dir> [--bars 40] [--bpm 120]
 *
 * The chart: 4/4, a section every 8 bars, Expert pro drums (kick on 1 and 3,
 * snare on 2 and 4, hi-hat eighths, a crash on each section's downbeat, a tom
 * fill closing each section), Expert guitar eighths with a sustain on every
 * downbeat, and a two-bar lyric phrase every other bar pair from bar 8.
 * Deterministic: the same flags give the same bytes.
 */
import path from 'node:path';
import {int, isMain, need, parseFlags, runCli} from '../../scripts/lib/cli';
import {writeFileAtomic} from '../../scripts/lib/files';
import {
  SAMPLE_RATE,
  allocStereo,
  writeWav,
  type Stereo,
} from '../../scripts/audio/pcm';
import {mulberry32} from '../../src/motion/random';

const RESOLUTION = 192;
const SECTIONS = ['Intro', 'Verse', 'Chorus', 'Bridge', 'Outro'];
const SYLLABLES = [
  'syn-',
  'the-',
  'tic',
  'words',
  'are',
  'on',
  'ly',
  'tim-',
  'ing',
];

export interface SyntheticSong {
  folder: string;
  bpm: number;
  bars: number;
  /** Seconds of each drum hit, by kind. */
  drumTimes: {
    kick: number[];
    snare: number[];
    hihat: number[];
    crash: number[];
    tom: number[];
  };
}

interface ChartNote {
  tick: number;
  lines: string[];
}

export function writeSyntheticSong(
  folder: string,
  bars = 40,
  bpm = 120,
): SyntheticSong {
  const beat = RESOLUTION;
  const bar = 4 * beat;
  const secOf = (tick: number) => (tick / RESOLUTION) * (60 / bpm);
  const events: string[] = [];
  const drums: ChartNote[] = [];
  const guitar: ChartNote[] = [];
  const drumTimes: SyntheticSong['drumTimes'] = {
    kick: [],
    snare: [],
    hihat: [],
    crash: [],
    tom: [],
  };

  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    if (b % 8 === 0)
      events.push(
        `  ${t0} = E "section ${SECTIONS[(b / 8) % SECTIONS.length]}"`,
      );
    const fill = b % 8 === 7;
    for (let e = 0; e < 8; e++) {
      const tick = t0 + (e * beat) / 2;
      const lines: string[] = [];
      const onBeat = e % 2 === 0;
      const beatIndex = e / 2;
      if (onBeat && (beatIndex === 0 || beatIndex === 2)) {
        lines.push('N 0 0');
        drumTimes.kick.push(secOf(tick));
      }
      if (
        onBeat &&
        (beatIndex === 1 || beatIndex === 3) &&
        !(fill && beatIndex === 3)
      ) {
        lines.push('N 1 0');
        drumTimes.snare.push(secOf(tick));
      }
      if (fill && e >= 6) {
        // Toms on the last beat of a section: yellow, then blue.
        lines.push(e === 6 ? 'N 2 0' : 'N 3 0');
        drumTimes.tom.push(secOf(tick));
      } else if (e === 0 && b % 8 === 0) {
        lines.push('N 4 0', 'N 68 0');
        drumTimes.crash.push(secOf(tick));
      } else {
        lines.push('N 2 0', 'N 66 0');
        drumTimes.hihat.push(secOf(tick));
      }
      drums.push({tick, lines});
      const fret = (b + e) % 5;
      guitar.push({tick, lines: [`N ${fret} ${e === 0 ? beat : 0}`]});
    }
    // A two-bar phrase on every other bar pair from bar 8, leaving the last bars clear.
    if (b >= 8 && b % 4 === 0 && b + 2 < bars - 4) {
      events.push(`  ${t0} = E "phrase_start"`);
      for (let k = 0; k < 6; k++) {
        events.push(
          `  ${t0 + k * beat} = E "lyric ${SYLLABLES[(b + k) % SYLLABLES.length]}"`,
        );
      }
      events.push(`  ${t0 + 7 * beat} = E "phrase_end"`);
    }
  }

  const section = (name: string, lines: string[]) =>
    `[${name}]\n{\n${lines.join('\n')}\n}\n`;
  const noteLines = (notes: ChartNote[]) =>
    notes.flatMap(n => n.lines.map(l => `  ${n.tick} = ${l}`));
  const chart =
    section('Song', [
      '  Name = "Synthetic Test Song"',
      '  Artist = "Test Artist"',
      '  Charter = "Test Charter"',
      `  Resolution = ${RESOLUTION}`,
      '  Offset = 0',
    ]) +
    section('SyncTrack', ['  0 = TS 4', `  0 = B ${Math.round(bpm * 1000)}`]) +
    section('Events', events) +
    section('ExpertDrums', noteLines(drums)) +
    section('ExpertSingle', noteLines(guitar));
  const lengthSec = secOf(bars * bar);
  writeFileAtomic(path.join(folder, 'notes.chart'), chart);
  writeFileAtomic(
    path.join(folder, 'song.ini'),
    [
      '[song]',
      'name = Synthetic Test Song',
      'artist = Test Artist',
      'charter = Test Charter',
      `song_length = ${Math.round(lengthSec * 1000)}`,
      'delay = 0',
      'pro_drums = True',
      '',
    ].join('\n'),
  );

  const total = Math.round((lengthSec + 1) * SAMPLE_RATE);
  const rnd = mulberry32(7);
  const add = (
    s: Stereo,
    t: number,
    len: number,
    f: (u: number, i: number) => number,
  ) => {
    const start = Math.round(t * SAMPLE_RATE);
    for (let i = 0; i < len && start + i < s.l.length; i++) {
      const v = f(i / SAMPLE_RATE, i);
      s.l[start + i] = s.l[start + i]! + v;
      s.r[start + i] = s.r[start + i]! + v;
    }
  };
  const drumStem = allocStereo(total);
  const n = (sec: number) => Math.round(sec * SAMPLE_RATE);
  for (const t of drumTimes.kick)
    add(
      drumStem,
      t,
      n(0.15),
      u =>
        0.8 *
        Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-u * 30)) * u) *
        Math.exp(-u * 18),
    );
  for (const t of drumTimes.snare)
    add(
      drumStem,
      t,
      n(0.2),
      u =>
        (0.5 * (rnd() * 2 - 1) + 0.3 * Math.sin(2 * Math.PI * 190 * u)) *
        Math.exp(-u * 22),
    );
  for (const t of drumTimes.hihat)
    add(drumStem, t, n(0.05), u => 0.18 * (rnd() * 2 - 1) * Math.exp(-u * 90));
  for (const t of drumTimes.crash)
    add(drumStem, t, n(1.2), u => 0.3 * (rnd() * 2 - 1) * Math.exp(-u * 3));
  for (const t of drumTimes.tom)
    add(
      drumStem,
      t,
      n(0.25),
      u => 0.6 * Math.sin(2 * Math.PI * 110 * u) * Math.exp(-u * 14),
    );

  const tone = (hz: number, amp: number) => (u: number) =>
    amp * Math.sin(2 * Math.PI * hz * u) * Math.min(1, u / 0.005);
  const bass = allocStereo(total);
  const guitarStem = allocStereo(total);
  const rhythm = allocStereo(total);
  const vocals = allocStereo(total);
  const roots = [55, 73.42, 61.74, 82.41];
  for (let b = 0; b < bars; b++) {
    const root = roots[b % roots.length]!;
    for (let k = 0; k < 4; k++) {
      add(
        bass,
        secOf(b * bar + k * beat),
        n(0.45),
        u => tone(root, 0.35)(u) * Math.exp(-u * 4),
      );
    }
    add(
      rhythm,
      secOf(b * bar),
      n((60 / bpm) * 4),
      u =>
        [1, 1.25, 1.5].reduce(
          (acc, r) => acc + tone(root * 4 * r, 0.06)(u),
          0,
        ) * Math.min(1, ((60 / bpm) * 4 - u) / 0.01),
    );
  }
  for (const note of guitar) {
    const fret = Number(note.lines[0]!.split(' ')[1]);
    const hz = 330 * 2 ** ((fret * 2) / 12);
    add(
      guitarStem,
      secOf(note.tick),
      n(0.22),
      u => (tone(hz, 0.15)(u) + tone(hz * 2, 0.05)(u)) * Math.exp(-u * 9),
    );
  }
  const lyricTicks = events
    .map(line => /^\s*(\d+) = E "lyric /.exec(line)?.[1])
    .filter((x): x is string => x !== undefined)
    .map(Number);
  for (const tick of lyricTicks) {
    add(
      vocals,
      secOf(tick),
      n(0.9 * (60 / bpm)),
      u =>
        tone(440 * (1 + 0.004 * Math.sin(2 * Math.PI * 5 * u)), 0.2)(u) *
        Math.min(1, (0.9 * (60 / bpm) - u) / 0.02),
    );
  }

  const stems: Record<string, Stereo> = {
    drums: drumStem,
    bass,
    guitar: guitarStem,
    rhythm,
    vocals,
  };
  for (const [name, audio] of Object.entries(stems))
    writeWav(path.join(folder, `${name}.wav`), audio);
  return {folder, bpm, bars, drumTimes};
}

const USAGE = `
Usage: node --import tsx test/fixtures/synthetic-song.ts --out <dir> [--bars 40] [--bpm 120]
`;

if (isMain(import.meta.url)) {
  runCli(USAGE, () => {
    const {values} = parseFlags({
      out: {type: 'string'},
      bars: {type: 'string'},
      bpm: {type: 'string'},
    });
    const song = writeSyntheticSong(
      path.resolve(need(values.out, 'out')),
      int(values.bars, 'bars', 40, 12),
      int(values.bpm, 'bpm', 120, 40),
    );
    console.log(
      `synthetic song: ${song.bars} bars at ${song.bpm} BPM -> ${song.folder}`,
    );
  });
}
