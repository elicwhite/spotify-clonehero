/**
 * The timeline writer: the video-time data every scene syncs to.
 * timeline.json is the contract in src/music/contract.ts; peaks.json and
 * envelopes.json carry one curve per stem plus the mix.
 */
import type {
  Bar,
  Beat,
  Envelopes,
  Peaks,
  Segment,
  StemCurves,
  Syllable,
  Tempo,
  Timeline,
} from '../../src/music/contract';
import {makeTimeline} from '../../src/music/make';
import {segmentIndexOfSong, videoTimeOfSong} from '../../src/music/songTime';
import type {SongChart} from './chart';
import type {TimeRange} from './edit';
import {SAMPLE_RATE, type Stereo} from './pcm';

export interface TimelineInput {
  song: SongChart;
  segments: readonly Segment[];
  durationSec: number;
  fps: number;
  /** Video-time ranges where the vocal stem is muted: no lyric phrase is kept in them. */
  vocalMutes: readonly TimeRange[];
  /** What was done to the mix, in words. */
  mixNotes: string;
}

/** Microsecond rounding keeps the JSON readable and stable. */
const us = (t: number): number => Math.round(t * 1e6) / 1e6;

/** Whether a video time is inside a film of `durationSec` (its end excluded). */
const inVideo = (t: number, durationSec: number): boolean =>
  t >= 0 && t < durationSec - 1e-9;

/** Where song second `songT` plays in the edit (video seconds, rounded), or null when the edit skips it. */
function songToVideo(
  segments: readonly Segment[],
  songT: number,
): {t: number; segment: number} | null {
  const segment = segmentIndexOfSong(songT, segments);
  if (segment === null) return null;
  return {t: us(videoTimeOfSong(songT, segments, segment)), segment};
}

/** The film's bar and beat grid, before frames are placed. */
interface VideoGrid {
  tempo: Tempo;
  beats: Omit<Beat, 'frame'>[];
  bars: Omit<Bar, 'frame' | 'index'>[];
}

/** The video's bar/beat grid: the song's own beats carried through the edit. */
function videoGrid(
  song: SongChart,
  segments: readonly Segment[],
  durationSec: number,
): VideoGrid {
  const beats: VideoGrid['beats'] = [];
  const bars: VideoGrid['bars'] = [];
  const beatsOfBar = new Map<number, SongChart['beats']>();
  for (const b of song.beats) {
    const list = beatsOfBar.get(b.bar) ?? [];
    list.push(b);
    beatsOfBar.set(b.bar, list);
  }
  // Segment by segment: an edit may play a song bar more than once.
  for (const [si, seg] of segments.entries()) {
    const video = (songT: number) => us(videoTimeOfSong(songT, segments, si));
    for (const bar of song.bars) {
      if (bar.t < seg.songStart - 1e-9 || bar.t >= seg.songEnd - 1e-9) continue;
      const vt = video(bar.t);
      if (!inVideo(vt, durationSec)) continue;
      const index = bars.length;
      bars.push({t: vt, songBar: bar.index, section: bar.section});
      for (const b of beatsOfBar.get(bar.index) ?? []) {
        const bt = video(b.t);
        if (!inVideo(bt, durationSec)) continue;
        beats.push({t: bt, bar: index, beat: b.beat, downbeat: b.downbeat});
      }
    }
  }
  const firstBar = bars[0];
  if (!firstBar) throw new Error('The edit contains no bar line of the chart');
  const firstSongBar = song.bars[firstBar.songBar]!;
  let tempoAt = song.tempos[0]!;
  for (const tp of song.tempos) if (tp.tick <= firstSongBar.tick) tempoAt = tp;
  const beatSec = 60 / tempoAt.bpm;
  const tempo = {
    bpm: tempoAt.bpm,
    beatSec: us(beatSec),
    barSec: us(beatSec * firstSongBar.beats),
  };
  return {tempo, beats, bars};
}

/** The edit's segments, rounded as the timeline stores them. */
const roundedSegments = (segments: readonly Segment[]): Segment[] =>
  segments.map(s => ({
    videoStart: us(s.videoStart),
    videoEnd: us(s.videoEnd),
    songStart: us(s.songStart),
    songEnd: us(s.songEnd),
  }));

/** A timeline of just the film's grid (for placing automation before the notes are needed). */
export const gridTimeline = (
  song: SongChart,
  segments: readonly Segment[],
  durationSec: number,
  fps: number,
): Timeline =>
  makeTimeline({
    fps,
    durationSec,
    meta: song.meta,
    ...videoGrid(song, segments, durationSec),
    segments: roundedSegments(segments),
  });

export function buildTimeline(input: TimelineInput): Timeline {
  const {song, segments, durationSec, fps} = input;
  const drums = song.drums.flatMap(n => {
    const m = songToVideo(segments, n.t);
    return m && inVideo(m.t, durationSec) ? [{...n, t: m.t}] : [];
  });
  const guitar = song.guitar.flatMap(n => {
    const m = songToVideo(segments, n.t);
    if (!m || !inVideo(m.t, durationSec)) return [];
    const segEnd = Math.min(segments[m.segment]!.videoEnd, durationSec);
    const sustain = us(Math.max(0, Math.min(n.sustain, segEnd - m.t)));
    return [{...n, t: m.t, sustain}];
  });

  // Vocals: a phrase is kept only if every syllable of it plays, unmuted,
  // inside one segment, so no phrase ever starts or ends mid-way.
  const muted = (t: number) =>
    input.vocalMutes.some(r => t >= r.startSec && t < r.endSec);
  const sylsOfPhrase = new Map<number, SongChart['syllables']>();
  for (const s of song.syllables) {
    const list = sylsOfPhrase.get(s.phrase) ?? [];
    list.push(s);
    sylsOfPhrase.set(s.phrase, list);
  }
  const syllables: Omit<Syllable, 'frame'>[] = [];
  const phrases: Timeline['vocals']['phrases'] = [];
  song.phrases.forEach((p, pi) => {
    const syls = sylsOfPhrase.get(pi) ?? [];
    if (!syls.length) return;
    const start = songToVideo(segments, p.t);
    const mapped = syls.map(s => songToVideo(segments, s.t));
    if (!start || mapped.some(m => !m || m.segment !== start.segment)) return;
    const seg = segments[start.segment]!;
    const video = (songT: number) =>
      videoTimeOfSong(songT, segments, start.segment);
    const endT = us(Math.min(seg.videoEnd, video(p.end)));
    if (!inVideo(start.t, durationSec) || endT > durationSec) return;
    if (mapped.some(m => muted(m!.t)) || muted(start.t)) return;
    const index = phrases.length;
    phrases.push({start: start.t, end: endT});
    syls.forEach((s, k) => {
      const t = mapped[k]!.t;
      const end = us(Math.min(endT, video(s.end)));
      syllables.push({
        t,
        end,
        phrase: index,
        wordStart: s.wordStart,
        wordEnd: s.wordEnd,
      });
    });
  });

  // makeTimeline places the frames and takes the hits from the audible drums.
  return makeTimeline({
    fps,
    durationSec,
    meta: song.meta,
    ...videoGrid(song, segments, durationSec),
    segments: roundedSegments(segments),
    drums,
    guitar,
    syllables,
    phrases,
    mixNotes: input.mixNotes,
  });
}

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** Absolute peak per 1/rate s bin, both channels, 0..1. */
function peakCurve(s: Stereo, rate: number): number[] {
  const bin = SAMPLE_RATE / rate;
  const bins = Math.round(s.l.length / bin);
  const out: number[] = [];
  for (let b = 0; b < bins; b++) {
    let m = 0;
    const end = Math.min(s.l.length, Math.round((b + 1) * bin));
    for (let i = Math.round(b * bin); i < end; i++) {
      m = Math.max(m, Math.abs(s.l[i]!), Math.abs(s.r[i]!));
    }
    out.push(r4(Math.min(1, m)));
  }
  return out;
}

/** RMS of the audio that plays during each video frame, 0..1. */
function envelopeCurve(s: Stereo, fps: number): number[] {
  const hop = SAMPLE_RATE / fps;
  const frames = Math.round(s.l.length / hop);
  const out: number[] = [];
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    const a = Math.round(f * hop);
    const b = Math.min(s.l.length, Math.round((f + 1) * hop));
    for (let i = a; i < b; i++) acc += 0.5 * (s.l[i]! ** 2 + s.r[i]! ** 2);
    out.push(r4(Math.min(1, Math.sqrt(acc / Math.max(1, b - a)))));
  }
  return out;
}

/** One curve for the mix and one per named stem. */
function stemCurves(
  mix: Stereo,
  stems: Readonly<Record<string, Stereo>>,
  curve: (s: Stereo) => number[],
): StemCurves {
  const out: StemCurves = {mix: curve(mix)};
  for (const [name, audio] of Object.entries(stems)) {
    if (name === 'mix') throw new Error('A stem cannot be called "mix"');
    out[name] = curve(audio);
  }
  return out;
}

/** peaks.json: absolute peaks per 1/rate s bin. */
export const buildPeaks = (
  mix: Stereo,
  stems: Readonly<Record<string, Stereo>>,
  rate: number,
): Peaks => ({rate, stems: stemCurves(mix, stems, s => peakCurve(s, rate))});

/** envelopes.json: per-frame RMS. */
export const buildEnvelopes = (
  mix: Stereo,
  stems: Readonly<Record<string, Stereo>>,
  fps: number,
): Envelopes => ({
  fps,
  stems: stemCurves(mix, stems, s => envelopeCurve(s, fps)),
});
