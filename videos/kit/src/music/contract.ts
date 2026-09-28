/**
 * The timeline contract: what a soundtrack build writes and a film reads.
 * Types only, so Node scripts and the film share one definition.
 *
 * Files (names are the writer's choice; the film passes their URLs):
 * - timeline.json: `Timeline`
 * - peaks.json: `Peaks` (optional)
 * - envelopes.json: `Envelopes` (optional)
 *
 * All times are VIDEO seconds from the film's first frame, and every `frame`
 * is `Math.round(t * fps)` at the timeline's `fps`. Song seconds (chart
 * time) appear only in `segments`, which map between the two.
 */

/** Bumped whenever a field changes meaning; readers reject other versions. */
export type TimelineVersion = 2;

/** Credits only. Read at render time; never hard-code these strings. */
export interface Meta {
  title: string;
  artist: string;
}

export interface Tempo {
  /** Nominal tempo; `beats` hold the real grid. */
  bpm: number;
  beatSec: number;
  barSec: number;
}

export interface Beat {
  t: number;
  frame: number;
  /** Video bar, counted from 0. */
  bar: number;
  /** Beat within the bar, 0..beatsPerBar-1. */
  beat: number;
  downbeat: boolean;
}

export interface Bar {
  index: number;
  t: number;
  frame: number;
  /** The bar of the song this video bar plays. */
  songBar: number;
  /** The song section's name, or '' when unknown. */
  section: string;
}

/** One stretch of the song the film plays: the edit is a list of these. */
export interface Segment {
  videoStart: number;
  videoEnd: number;
  songStart: number;
  songEnd: number;
}

/** Clone Hero 4-lane pro drums plus kick. */
export type DrumLane = 'kick' | 'red' | 'yellow' | 'blue' | 'green';

/** The 8-lane drum class of a note. */
export type DrumKit =
  | 'kick'
  | 'snare'
  | 'hihat'
  | 'crash'
  | 'ride'
  | 'tom1'
  | 'tom2'
  | 'tom3';

export interface DrumNote {
  t: number;
  frame: number;
  /** The note's tick in the song's chart. */
  tick: number;
  lane: DrumLane;
  cymbal: boolean;
  accent: boolean;
  ghost: boolean;
  doubleKick: boolean;
  kit: DrumKit;
}

export interface GuitarNote {
  t: number;
  frame: number;
  tick: number;
  /** 0 green, 1 red, 2 yellow, 3 blue, 4 orange, 5 open. */
  frets: number[];
  /** Seconds, 0 if none. */
  sustain: number;
  hopo: boolean;
  tap: boolean;
}

/** A sung syllable: timing only, never text. */
export interface Syllable {
  t: number;
  frame: number;
  /** Release, video seconds. */
  end: number;
  /** Index into `vocals.phrases`. */
  phrase: number;
  wordStart: boolean;
  wordEnd: boolean;
}

export interface Phrase {
  start: number;
  end: number;
}

export type HitKind = 'kick' | 'snare' | 'crash' | 'any';

/** Drum hit times in video seconds, from the drum chart. */
export type Hits = Record<HitKind, number[]>;

export interface Timeline {
  version: TimelineVersion;
  fps: number;
  durationSec: number;
  durationFrames: number;
  meta: Meta;
  tempo: Tempo;
  /** Sorted by time; at least one. */
  beats: Beat[];
  /** At least one. */
  bars: Bar[];
  /** The edit. */
  segments: Segment[];
  notes: {drums: DrumNote[]; guitar: GuitarNote[]};
  vocals: {syllables: Syllable[]; phrases: Phrase[]};
  hits: Hits;
  /** What the soundtrack build did to the mix, in words. */
  mix?: {notes: string};
}

/** One curve per stem, by the stem's name. `mix` is always present. */
export interface StemCurves {
  mix: number[];
  [stem: string]: number[];
}

/** Absolute peak per 1/rate s bin, 0..1, video time. */
export interface Peaks {
  /** Bins per second. */
  rate: number;
  stems: StemCurves;
}

/** RMS per bin, 0..1, video time; `fps` bins per second. */
export interface Envelopes {
  fps: number;
  stems: StemCurves;
}
