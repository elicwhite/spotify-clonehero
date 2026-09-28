/**
 * The pure timing of a kinetic line: its text split into word groups, and
 * when each unit starts, lands, starts leaving and is gone, in film frames.
 * KineticText draws with it, and anything lined up with a line (a caption
 * after a headline, a slate's last frame, a pacing sheet's reading time)
 * reads the same numbers.
 *
 * Node-safe: no React at runtime, no fonts.
 */
import type {CSSProperties} from 'react';
import {staggerIndex, type StaggerFrom} from '../motion';
import {
  resolveEnter,
  resolveExit,
  type EnterPresetName,
  type ExitPresetName,
  type KineticPreset,
  type SplitMode,
} from './presets';

/**
 * One atomic word group: a string, or a string with its own paint (a colour,
 * a gradient, a glow). The style must not change the font metrics.
 */
export type KineticWord = string | {text: string; style?: CSSProperties};

export interface KineticToken {
  text: string;
  style?: CSSProperties;
}

/**
 * Paragraphs of word groups: a string splits on spaces with "\n" breaking
 * a line; in an array every item is one group and a "\n" item breaks a line.
 */
export const tokenize = (
  text: string | readonly KineticWord[],
): KineticToken[][] => {
  const paragraphs: KineticToken[][] = [[]];
  const push = (w: KineticToken) =>
    (paragraphs[paragraphs.length - 1] as KineticToken[]).push(w);
  if (typeof text === 'string') {
    text.split('\n').forEach((para, i) => {
      if (i > 0) paragraphs.push([]);
      para
        .split(/ +/)
        .filter(Boolean)
        .forEach(w => push({text: w}));
    });
  } else {
    for (const item of text) {
      const word = typeof item === 'string' ? {text: item} : item;
      if (word.text === '\n') paragraphs.push([]);
      else if (word.text.trim())
        push({text: word.text.trim(), style: word.style});
    }
  }
  return paragraphs.filter(p => p.length > 0);
};

/** The text's words joined: the default seed of anything random about it. */
export const kineticSeed = (text: string | readonly KineticWord[]): string =>
  typeof text === 'string'
    ? text
    : text.map(w => (typeof w === 'string' ? w : w.text)).join(' ');

/** The split a line animates in: `split`, else characters if either preset prefers them. */
export const resolveSplit = (
  enter: KineticPreset,
  exit: KineticPreset,
  split?: SplitMode,
): SplitMode =>
  split ??
  (enter.split === 'chars' || exit.split === 'chars' ? 'chars' : 'words');

/** One unit's phases, in (fractional) film frames: exactly when each happens. */
export interface UnitTiming {
  /** Word index in the text. */
  word: number;
  /** Character index within its word (chars mode), else -1. */
  char: number;
  /** When the unit starts entering (-Infinity without `enterAt`: at rest). */
  start: number;
  /** When it has landed. */
  land: number;
  /** When it starts leaving (Infinity without `exitAt`). */
  exitStart: number;
  /** When it is gone. */
  exitEnd: number;
}

export interface KineticTiming {
  split: SplitMode;
  enter: KineticPreset;
  exit: KineticPreset;
  /** Frames each unit's enter and exit take. */
  enterFrames: number;
  exitFrames: number;
  wordCount: number;
  /** Every unit in reading order. */
  units: UnitTiming[];
  /** The first unit's start, exact. */
  firstStart: number;
  /** The first whole film frame on which every unit has landed. */
  fullyIn: number;
  /** The first whole film frame on which every unit is gone (Infinity without `exitAt`). */
  gone: number;
}

export interface KineticTimingOptions {
  text: string | readonly KineticWord[];
  fps: number;
  /** Default 'maskUp'. */
  enter?: EnterPresetName | KineticPreset;
  /** Default 'maskUpOut'. */
  exit?: ExitPresetName | KineticPreset;
  split?: SplitMode;
  /** Film frame the first unit starts, or one frame per unit (or per word in chars mode). */
  enterAt?: number | readonly number[];
  /** Frames between units (default: the preset's). */
  stagger?: number;
  /** Frames per unit (default: the preset's). */
  duration?: number;
  order?: StaggerFrom;
  exitAt?: number | readonly number[];
  exitStagger?: number;
  exitDuration?: number;
  exitOrder?: StaggerFrom;
  /** Default: the text itself. */
  seed?: string;
}

/** A kinetic line's timing props, as KineticText takes them (its fps comes from the format). */
export type LineTiming = Omit<KineticTimingOptions, 'fps'>;

/**
 * The first whole film frame at or after `t` (forgiving float error just
 * past a whole frame): when something that ends at `t` is done on screen.
 */
export const wholeFrameAtOrAfter = (t: number): number => Math.ceil(t - 1e-6);

/** A unit's place in its line. */
interface UnitSlot {
  /** Reading-order index. */
  index: number;
  word: number;
  /** Character index within its word (chars mode), else -1. */
  char: number;
}

/** How a phase's start frames are given, for every unit of one line. */
interface StartRule {
  /** One frame (staggered by `each` in `order`), one frame per unit, or one per word in chars mode. */
  at: number | readonly number[];
  /** Frames between units. */
  each: number;
  order: StaggerFrom;
  seed: string;
  unitCount: number;
  wordCount: number;
  splitChars: boolean;
}

/**
 * A unit's phase start: one frame staggered by `each` in `order`, one frame
 * per unit, or one frame per word (characters then follow each other by
 * `each`). A shorter list than units staggers the rest after its last frame.
 */
const unitStart = (slot: UnitSlot, rule: StartRule): number => {
  const {at, each} = rule;
  if (typeof at === 'number')
    return (
      at +
      staggerIndex(slot.index, rule.unitCount, rule.order, rule.seed) * each
    );
  if (at.length === rule.unitCount) return at[slot.index] as number;
  if (rule.splitChars && at.length === rule.wordCount)
    return (at[slot.word] as number) + Math.max(0, slot.char) * each;
  const last = at.length - 1;
  return (
    (at[Math.min(slot.index, last)] as number) +
    Math.max(0, slot.index - last) * each
  );
};

/**
 * When each unit of a kinetic line starts, lands, starts leaving and is
 * gone, in film frames: the timing KineticText draws, for anything that must
 * line up with it (a caption after a headline, a slate's last frame, a
 * pacing sheet's reading time).
 */
export const kineticTimeline = (o: KineticTimingOptions): KineticTiming => {
  const enter = resolveEnter(o.enter);
  const exit = resolveExit(o.exit);
  const split = resolveSplit(enter, exit, o.split);
  const splitChars = split === 'chars';
  const seed = o.seed ?? kineticSeed(o.text);
  const enterFrames = o.duration ?? enter.duration * o.fps;
  const exitFrames = o.exitDuration ?? exit.duration * o.fps;
  const slots: UnitSlot[] = [];
  let wordCount = 0;
  for (const para of tokenize(o.text)) {
    for (const w of para) {
      if (splitChars)
        Array.from(w.text).forEach((_, char) =>
          slots.push({index: slots.length, word: wordCount, char}),
        );
      else slots.push({index: slots.length, word: wordCount, char: -1});
      wordCount++;
    }
  }
  const rule = (
    at: number | readonly number[] | undefined,
    each: number,
    order: StaggerFrom,
  ): StartRule | null =>
    at === undefined
      ? null
      : {
          at,
          each,
          order,
          seed,
          unitCount: slots.length,
          wordCount,
          splitChars,
        };
  const enterRule = rule(
    o.enterAt,
    o.stagger ?? enter.stagger * o.fps,
    o.order ?? 'start',
  );
  const exitRule = rule(
    o.exitAt,
    o.exitStagger ?? exit.stagger * o.fps,
    o.exitOrder ?? 'start',
  );
  const units = slots.map((slot): UnitTiming => {
    const start = enterRule ? unitStart(slot, enterRule) : -Infinity;
    const exitStart = exitRule ? unitStart(slot, exitRule) : Infinity;
    return {
      word: slot.word,
      char: slot.char,
      start,
      land: start + enterFrames,
      exitStart,
      exitEnd: exitStart + exitFrames,
    };
  });
  return {
    split,
    enter,
    exit,
    enterFrames,
    exitFrames,
    wordCount,
    units,
    firstStart: Math.min(...units.map(u => u.start)),
    fullyIn: wholeFrameAtOrAfter(Math.max(...units.map(u => u.land))),
    gone: wholeFrameAtOrAfter(Math.max(...units.map(u => u.exitEnd))),
  };
};

/** The first whole film frame on which every unit of a kinetic line has landed: when it is fully in. */
export const fullyInFrame = (o: KineticTimingOptions): number =>
  kineticTimeline(o).fullyIn;
