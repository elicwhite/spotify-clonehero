/**
 * Song-time view of a chart folder, built on the project's own parser
 * (@eliwhite/scan-chart). Everything here is in SONG seconds; the edit and
 * timeline modules map it to video time.
 *
 * Lyric text is read in memory only, to find word boundaries from the
 * syllable flags. It never leaves this module: the returned data carries
 * timing and flags, not text.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  lyricFlags,
  noteFlags,
  noteTypes,
  parseChartAndIni,
  type File as ChartFile,
} from '@eliwhite/scan-chart';
import type {
  Beat,
  DrumKit,
  DrumLane,
  DrumNote,
  GuitarNote,
  Meta,
  Syllable,
} from '../../src/music/contract';
import {maxOf} from '../lib/numbers';

/** A note or syllable in SONG seconds: the contract's shape without the video frame. */
export type SongDrumNote = Omit<DrumNote, 'frame'>;
export type SongGuitarNote = Omit<GuitarNote, 'frame'>;
/** `end` is the next syllable's onset in the same phrase, or the phrase end; `phrase` indexes SongChart.phrases. */
export type SongSyllable = Omit<Syllable, 'frame'> & {tick: number};

export interface SongPhrase {
  tick: number;
  t: number;
  end: number;
}

export interface SongSection {
  tick: number;
  t: number;
  bar: number;
  name: string;
}

/** A beat of the song; `bar` is the song bar. */
export type SongBeat = Omit<Beat, 'frame'> & {tick: number};

export interface SongBar {
  index: number;
  tick: number;
  t: number;
  beats: number;
  section: string;
}

export interface SongChart {
  resolution: number;
  tempos: {tick: number; bpm: number; t: number}[];
  timeSignatures: {tick: number; numerator: number; denominator: number}[];
  beats: SongBeat[];
  bars: SongBar[];
  sections: SongSection[];
  drums: SongDrumNote[];
  guitar: SongGuitarNote[];
  syllables: SongSyllable[];
  phrases: SongPhrase[];
  /** The credits (timeline.json `meta`). */
  meta: Meta;
  tickToSec: (tick: number) => number;
}

const DRUM_LANES: Partial<Record<number, DrumLane>> = {
  [noteTypes.kick]: 'kick',
  [noteTypes.redDrum]: 'red',
  [noteTypes.yellowDrum]: 'yellow',
  [noteTypes.blueDrum]: 'blue',
  [noteTypes.greenDrum]: 'green',
};

const FRET_INDEX: Partial<Record<number, number>> = {
  [noteTypes.green]: 0,
  [noteTypes.red]: 1,
  [noteTypes.yellow]: 2,
  [noteTypes.blue]: 3,
  [noteTypes.orange]: 4,
  [noteTypes.open]: 5,
};

function drumKit(lane: DrumLane, cymbal: boolean): DrumKit {
  switch (lane) {
    case 'kick':
      return 'kick';
    case 'red':
      return 'snare';
    case 'yellow':
      return cymbal ? 'hihat' : 'tom1';
    case 'blue':
      return cymbal ? 'ride' : 'tom2';
    case 'green':
      return cymbal ? 'crash' : 'tom3';
  }
}

/** Rounds away float noise from tick -> ms -> s conversions. */
function sec(ms: number): number {
  return Math.round(ms * 1000) / 1e6;
}

/**
 * The last tick any note (with its sustain) reaches, over every track. Loops
 * rather than spreading into Math.max, which overflows the call stack on
 * charts with very many notes.
 */
export function lastNoteTick(
  tracks: readonly {
    noteEventGroups: readonly (readonly {tick: number; length: number}[])[];
  }[],
): number {
  let last = 0;
  for (const track of tracks) {
    for (const group of track.noteEventGroups) {
      const first = group[0];
      if (!first) continue;
      last = Math.max(
        last,
        first.tick +
          maxOf(
            group.map(n => n.length),
            0,
          ),
      );
    }
  }
  return last;
}

/** A chart folder's chart and ini files, as scan-chart takes them. */
export function readChartFolder(folder: string): ChartFile[] {
  return fs
    .readdirSync(folder)
    .filter(name => /\.(chart|mid|ini)$/i.test(name))
    .map(name => ({
      fileName: name,
      data: new Uint8Array(fs.readFileSync(path.join(folder, name))),
    }));
}

export function loadSongChart(folder: string): SongChart {
  const result = parseChartAndIni(readChartFolder(folder));
  const pc = result.parsedChart;
  if (!pc) {
    throw new Error(
      `Could not parse a chart in the chart folder: ${JSON.stringify(result.chartFolderIssues)}`,
    );
  }
  // Everything downstream assumes chart time == audio time.
  if ((pc.metadata.delay ?? 0) !== 0 || (pc.metadata.chart_offset ?? 0) !== 0) {
    throw new Error(
      'Charts with a song.ini delay or a .chart [Song] Offset are not supported: chart time must equal audio time.',
    );
  }
  const resolution = pc.resolution;

  // Tempo map (tick -> seconds), generic over tempo changes.
  const tempos = pc.tempos.map(t => ({
    tick: t.tick,
    bpm: t.beatsPerMinute,
    t: sec(t.msTime),
  }));
  const tickToSec = (tick: number): number => {
    let seg = tempos[0]!;
    for (const tp of tempos) {
      if (tp.tick <= tick) seg = tp;
      else break;
    }
    const ms =
      seg.t * 1000 + ((tick - seg.tick) / resolution) * (60000 / seg.bpm);
    return sec(ms);
  };

  const timeSignatures = pc.timeSignatures.map(ts => ({
    tick: ts.tick,
    numerator: ts.numerator,
    denominator: ts.denominator,
  }));

  const sectionsRaw = pc.sections.map(s => ({tick: s.tick, name: s.name}));

  // Beats and bars from the time signatures, to the end of the audio.
  const songLengthSec =
    (pc.iniChartModifiers.song_length > 0
      ? pc.iniChartModifiers.song_length
      : 0) / 1000;
  const lastTick = lastNoteTick(pc.trackData);
  const beats: SongBeat[] = [];
  const bars: SongBar[] = [];
  let tick = 0;
  let barIndex = 0;
  for (;;) {
    const ts = [...timeSignatures].reverse().find(s => s.tick <= tick) ?? {
      tick: 0,
      numerator: 4,
      denominator: 4,
    };
    const ticksPerBeat = (resolution * 4) / ts.denominator;
    const barStartSec = tickToSec(tick);
    // Keep a few bars past the audio so the video's ring-out has a grid.
    if (barStartSec > Math.max(songLengthSec, tickToSec(lastTick)) + 8) break;
    const section =
      [...sectionsRaw].reverse().find(s => s.tick <= tick)?.name ?? '';
    bars.push({
      index: barIndex,
      tick,
      t: barStartSec,
      beats: ts.numerator,
      section,
    });
    for (let b = 0; b < ts.numerator; b++) {
      const bt = tick + b * ticksPerBeat;
      beats.push({
        tick: bt,
        t: tickToSec(bt),
        bar: barIndex,
        beat: b,
        downbeat: b === 0,
      });
    }
    tick += ts.numerator * ticksPerBeat;
    barIndex++;
  }
  const barOfTick = (tk: number): number => {
    let found = 0;
    for (const b of bars) {
      if (b.tick <= tk) found = b.index;
      else break;
    }
    return found;
  };

  const sections: SongSection[] = sectionsRaw.map(s => ({
    tick: s.tick,
    t: tickToSec(s.tick),
    bar: barOfTick(s.tick),
    name: s.name,
  }));

  // Expert drums.
  const drumTrack = pc.trackData.find(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  );
  const drums: SongDrumNote[] = [];
  for (const group of drumTrack?.noteEventGroups ?? []) {
    for (const n of group) {
      const lane = DRUM_LANES[n.type];
      if (!lane) continue;
      if (n.flags & (noteFlags.disco | noteFlags.discoNoflip)) {
        // Disco flip swaps red and yellow on the kit; guessing the mapping
        // would mislabel lanes.
        throw new Error('Disco-flip drum notes are not supported.');
      }
      const cymbal =
        lane !== 'kick' && lane !== 'red' && !!(n.flags & noteFlags.cymbal);
      drums.push({
        tick: n.tick,
        t: sec(n.msTime),
        lane,
        cymbal,
        accent: !!(n.flags & noteFlags.accent),
        ghost: !!(n.flags & noteFlags.ghost),
        doubleKick: lane === 'kick' && !!(n.flags & noteFlags.doubleKick),
        kit: drumKit(lane, cymbal),
      });
    }
  }
  const laneOrder: DrumLane[] = ['kick', 'red', 'yellow', 'blue', 'green'];
  drums.sort(
    (a, b) =>
      a.tick - b.tick || laneOrder.indexOf(a.lane) - laneOrder.indexOf(b.lane),
  );

  // Expert guitar.
  const guitarTrack = pc.trackData.find(
    t => t.instrument === 'guitar' && t.difficulty === 'expert',
  );
  const guitar: SongGuitarNote[] = [];
  for (const group of guitarTrack?.noteEventGroups ?? []) {
    const frets = group
      .map(n => FRET_INDEX[n.type])
      .filter((f): f is number => f !== undefined)
      .sort((a, b) => a - b);
    if (!frets.length) continue;
    const first = group[0]!;
    guitar.push({
      tick: first.tick,
      t: sec(first.msTime),
      frets,
      sustain: sec(
        maxOf(
          group.map(n => n.msLength),
          0,
        ),
      ),
      hopo: !!(first.flags & noteFlags.hopo),
      tap: !!(first.flags & noteFlags.tap),
    });
  }
  guitar.sort((a, b) => a.tick - b.tick);

  // Vocals: syllable timing and word boundaries (text stays in memory).
  const vocalPart =
    pc.vocalTracks.parts['vocals'] ?? Object.values(pc.vocalTracks.parts)[0];
  const phrases: SongPhrase[] = [];
  const syllables: SongSyllable[] = [];
  const joins = lyricFlags.joinWithNext | lyricFlags.hyphenateWithNext;
  // Pitch-slide markers and symbol-only events continue the previous
  // syllable; they are not sung onsets of their own.
  const isContinuation = (l: {text: string; flags: number}) =>
    !!(l.flags & lyricFlags.pitchSlide) ||
    l.text.replace(/[-+=#^*%$/_§]/g, '').trim() === '';
  for (const p of vocalPart?.notePhrases ?? []) {
    const phraseStart = sec(p.msTime);
    const phraseEnd = sec(p.msTime + p.msLength);
    const onsets: {tick: number; t: number; joined: boolean}[] = [];
    for (const l of p.lyrics) {
      const joined = !!(l.flags & joins);
      const prev = onsets[onsets.length - 1];
      if (isContinuation(l)) {
        if (prev) prev.joined = joined;
      } else {
        onsets.push({tick: l.tick, t: sec(l.msTime), joined});
      }
    }
    if (!onsets.length) continue;
    const phraseIndex = phrases.length;
    phrases.push({tick: p.tick, t: phraseStart, end: phraseEnd});
    onsets.forEach((o, i) => {
      const next = onsets[i + 1];
      syllables.push({
        tick: o.tick,
        t: o.t,
        end: next ? next.t : Math.max(phraseEnd, o.t),
        phrase: phraseIndex,
        // A word never spans two phrases.
        wordStart: i === 0 || !onsets[i - 1]!.joined,
        wordEnd: !next || !o.joined,
      });
    });
  }

  const md = pc.metadata;
  const meta: Meta = {title: md.name ?? '', artist: md.artist ?? ''};

  return {
    resolution,
    tempos,
    timeSignatures,
    beats,
    bars,
    sections,
    drums,
    guitar,
    syllables,
    phrases,
    meta,
    tickToSec,
  };
}
