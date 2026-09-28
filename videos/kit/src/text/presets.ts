/**
 * Enter and exit presets for KineticText and Pop. A preset turns a unit's
 * progress into a style delta from rest. Durations and staggers are SECONDS,
 * so a preset holds at any frame rate; distances are reference px times
 * `u.unit`, or relative to the type. Write your own by making an object of
 * the same shape and passing it as `enter` / `exit`; a time-based one (a
 * spring) reads the seconds since its phase began with `elapsedSec(p, u)`.
 * When each unit runs is `timing.ts`'s.
 *
 * Node-safe: no React at runtime, no fonts.
 */
import {ease} from '../brand/ease';
import {springs, timing} from '../brand/tokens';
import {
  clamp01,
  rand,
  smoothstep,
  springAt,
  type SpringConfig,
} from '../motion';
import type {UnitStyle} from './unitStyle';

export type SplitMode = 'words' | 'chars';

export interface UnitContext {
  /** Reading-order index among all units. */
  index: number;
  count: number;
  line: number;
  lineCount: number;
  /** Word index in the text. */
  word: number;
  /** Character index within its word (chars mode), else -1. */
  char: number;
  /** The unit's text. */
  text: string;
  /** px */
  width: number;
  lineHeight: number;
  fontSize: number;
  /** Mask padding in px (for slides that must clear the mask). */
  padTop: number;
  padBottom: number;
  seed: string;
  /** Current film frame. */
  frame: number;
  /** This unit's phase start, film frame. */
  start: number;
  /** FRAMES this phase lasts (the preset's `duration` is seconds). */
  durationFrames: number;
  fps: number;
  /** The format's size unit: px per reference px. */
  unit: number;
}

export interface KineticPreset {
  /** SECONDS per unit. */
  duration: number;
  /** Seconds between units. */
  stagger: number;
  /** Preferred split. */
  split?: SplitMode;
  /** Clip each word to its line box while this phase runs. */
  mask?: boolean;
  /** Enter: p 0 = hidden -> 1 = rest. Exit: p 0 = rest -> 1 = gone. */
  style: (p: number, u: UnitContext) => UnitStyle;
  /** Draw a caret after the last visible character (typeOn). */
  caret?: boolean;
}

/** Seconds since a unit's phase began, at progress `p`: what a spring preset runs on. */
export const elapsedSec = (p: number, u: UnitContext): number =>
  (p * u.durationFrames) / u.fps;

const SCRAMBLE_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const SCRAMBLE_LOWER = 'abcdefghjkmnpqrstuvwxyz0123456789';
const SCRAMBLE_SYMBOL = '/\\|_-:.#+*';

const scrambleGlyph = (
  original: string,
  seed: string,
  index: number,
  step: number,
): string => {
  if (original.trim() === '') return original;
  const set = /[a-z]/.test(original)
    ? SCRAMBLE_LOWER
    : /[A-Z0-9]/.test(original)
      ? SCRAMBLE_UPPER
      : SCRAMBLE_SYMBOL;
  return set[Math.floor(rand(seed, index, step) * set.length)] as string;
};

// ---------------------------------------------------------------------------
// Blur-rise: copy that rises, un-blurs and fades in on a spring
// ---------------------------------------------------------------------------

export interface BlurRiseOptions {
  /** The spring each word arrives on (default `springs.copy`). */
  spring?: SpringConfig;
  /** Rise, as a fraction of the font size (default 0.36). */
  rise?: number;
  /** Starting blur, reference px (default 18). */
  blur?: number;
  /** Starting scale (default 0.92). */
  scale?: number;
  /** Seconds per word: long enough for the spring to settle (default 0.6). */
  duration?: number;
  /** Seconds between words (default 0.05). */
  stagger?: number;
}

/**
 * Words that rise, un-blur and fade in on a spring, landing on their own
 * start frames: pass `enterAt` one frame per word to set them on beats.
 */
export const blurRise = (o: BlurRiseOptions = {}): KineticPreset => {
  const spring = o.spring ?? springs.copy;
  const rise = o.rise ?? 0.36;
  const blur = o.blur ?? 18;
  const from = o.scale ?? 0.92;
  return {
    duration: o.duration ?? 0.6,
    stagger: o.stagger ?? 0.05,
    split: 'words',
    style: (p, u) => {
      const k = springAt(elapsedSec(p, u), spring);
      return {
        opacity: clamp01(k / 0.6),
        blur: blur * u.unit * (1 - clamp01(k)),
        y: (1 - k) * rise * u.fontSize,
        scale: from + (1 - from) * k,
      };
    },
  };
};

export interface BlurLiftOptions {
  /** Lift, as a fraction of the font size (default 0.22). */
  lift?: number;
  /** Final blur, reference px (default 16). */
  blur?: number;
  /** Seconds per word (default 0.3). */
  duration?: number;
  /** Seconds between words (default 0.03). */
  stagger?: number;
}

/** The blur-rise exit: words drift up a little, blur out and fade, quick to start and soft to end. */
export const blurLift = (o: BlurLiftOptions = {}): KineticPreset => {
  const lift = o.lift ?? 0.22;
  const blur = o.blur ?? 16;
  return {
    duration: o.duration ?? 0.3,
    stagger: o.stagger ?? 0.03,
    split: 'words',
    style: (p, u) => {
      const e = ease.enter(p);
      return {
        opacity: 1 - e,
        blur: blur * u.unit * e,
        y: -lift * u.fontSize * e,
      };
    },
  };
};

// ---------------------------------------------------------------------------
// Enter presets
// ---------------------------------------------------------------------------

export const enterPresets = {
  /** The headline reveal: slides up from behind the line mask, 8 px blur to 0. */
  maskUp: {
    duration: timing.wordEnter,
    stagger: timing.wordStagger,
    split: 'words',
    mask: true,
    style: (p, u) => {
      const e = ease.enter(p);
      // Invisible until it starts: a blurred word parked under the mask would
      // bleed a faint smudge above the mask edge.
      return {
        y: (1 - e) * (u.lineHeight + u.padBottom),
        blur: 8 * u.unit * (1 - e),
        opacity: p > 0 ? 1 : 0,
      };
    },
  },
  /** The title reveal: letters rise from the mask while tipping forward from rotateX 60. */
  flipUp: {
    duration: 2 / 3,
    stagger: timing.charStagger,
    split: 'chars',
    mask: true,
    style: (p, u) => {
      const e = ease.enter(p);
      return {
        y: (1 - e) * (u.lineHeight + u.padBottom),
        rotateX: 60 * (1 - e),
        origin: '50% 100%',
        blur: 5 * u.unit * (1 - e),
        opacity: p > 0 ? 1 : 0,
      };
    },
  },
  /** Focus pull: fades in from a soft blur with a slight settle in scale. */
  blurIn: {
    duration: 2 / 3,
    stagger: 0.05,
    split: 'words',
    style: (p, u) => {
      const e = ease.enter(p);
      return {
        opacity: smoothstep(0, 0.45, p),
        blur: 16 * u.unit * (1 - e),
        scale: 1 + 0.05 * (1 - e),
      };
    },
  },
  /** Words rise, un-blur and fade in on a spring (the blur-rise copy look). */
  blurRise: blurRise(),
  /** Small rise and fade: captions and secondary lines. */
  fadeUp: {
    duration: 0.53,
    stagger: 0.04,
    split: 'words',
    style: (p, u) => {
      const e = ease.enter(p);
      return {
        y: 26 * u.unit * (1 - e),
        opacity: smoothstep(0, 0.6, p),
        blur: 5 * u.unit * (1 - e),
      };
    },
  },
  /** Spring scale from 0 with overshoot: chips, tagline word groups landing on beats. */
  scalePop: {
    duration: 0.8,
    stagger: 0.05,
    split: 'words',
    style: (p, u) => {
      const s = springAt(elapsedSec(p, u), springs.pop);
      return {
        scale: Math.max(0, s),
        opacity: clamp01(p * 6),
        y: (1 - Math.min(1, s)) * u.lineHeight * 0.18,
        origin: '50% 75%',
      };
    },
  },
  /** Typewriter: characters appear one per `stagger` behind a caret. */
  typeOn: {
    duration: 0,
    stagger: timing.typeStagger,
    split: 'chars',
    caret: true,
    style: p => ({opacity: p >= 1 ? 1 : 0}),
  },
  /** Decode: each character cycles through glyphs (30 a second), then locks. Best in mono. */
  decode: {
    duration: 0.27,
    stagger: 0.02,
    split: 'chars',
    style: (p, u) => {
      if (p >= 1) return {};
      const step = Math.floor((u.frame / u.fps) * 30);
      return {
        opacity: smoothstep(0, 0.25, p) * 0.75,
        glyph: scrambleGlyph(u.text, u.seed, u.index, step),
      };
    },
  },
  /** A fast horizontal arrival from the right with directional blur. */
  whipIn: {
    duration: 0.4,
    stagger: 1 / 30,
    split: 'words',
    style: (p, u) => {
      const e = ease.enter(p);
      return {
        x: 180 * u.unit * (1 - e),
        blurX: 26 * u.unit * Math.pow(1 - e, 1.5),
        opacity: clamp01(p * 4),
      };
    },
  },
  /** A plain fade in. */
  fadeIn: {
    duration: 0.47,
    stagger: 0.04,
    split: 'words',
    style: p => ({opacity: ease.enter(p)}),
  },
  /** Springs down into place from one line height above. */
  dropIn: {
    duration: 0.6,
    stagger: 0.05,
    split: 'words',
    style: (p, u) => {
      const k = springAt(elapsedSec(p, u), springs.pop);
      return {y: -(1 - k) * u.lineHeight, opacity: clamp01(p * 6)};
    },
  },
  none: {duration: 0, stagger: 0, style: () => ({})},
} satisfies Record<string, KineticPreset>;

// ---------------------------------------------------------------------------
// Exit presets
// ---------------------------------------------------------------------------

export const exitPresets = {
  /** Up and out through the line mask. */
  maskUpOut: {
    duration: timing.wordExit,
    stagger: timing.wordExitStagger,
    split: 'words',
    mask: true,
    style: (p, u) => {
      const e = ease.exit(p);
      return {
        y: -(u.lineHeight + u.padTop) * e,
        blur: 6 * u.unit * e,
        opacity: p < 1 ? 1 : 0,
      };
    },
  },
  /** Down and out through the mask. */
  maskDownOut: {
    duration: timing.wordExit,
    stagger: timing.wordExitStagger,
    split: 'words',
    mask: true,
    style: (p, u) => {
      const e = ease.exit(p);
      return {
        y: (u.lineHeight + u.padBottom) * e,
        blur: 6 * u.unit * e,
        opacity: p < 1 ? 1 : 0,
      };
    },
  },
  /** Whip upward with a vertical smear. */
  whipUp: {
    duration: 0.23,
    stagger: 0.023,
    split: 'words',
    style: (p, u) => {
      const e = ease.exit(p);
      return {
        y: -260 * u.unit * e,
        blurY: 34 * u.unit * e,
        scaleY: 1 + 0.3 * e,
        opacity: 1 - smoothstep(0.55, 1, p),
      };
    },
  },
  /** Letters peel off upward, tumbling slightly, with a vertical smear. */
  peelUp: {
    duration: 0.37,
    stagger: 0.023,
    split: 'chars',
    style: (p, u) => {
      const e = ease.exit(p);
      const spin = (rand(u.seed, 'peel', u.index) * 2 - 1) * 16;
      return {
        y: -1.7 * u.lineHeight * e,
        rotate: spin * e,
        rotateX: -50 * e,
        blurY: 18 * u.unit * e,
        opacity: 1 - smoothstep(0.5, 1, p),
        origin: '50% 100%',
      };
    },
  },
  /** Defocus and fade. */
  blurOut: {
    duration: 1 / 3,
    stagger: 0.025,
    split: 'words',
    style: (p, u) => {
      const e = ease.exit(p);
      return {opacity: 1 - e, blur: 14 * u.unit * e, scale: 1 + 0.04 * e};
    },
  },
  /** The blur-rise exit: a small lift, blur and fade, quick to start. */
  blurLift: blurLift(),
  /** Small drop and fade. */
  fadeDown: {
    duration: 0.27,
    stagger: 0.025,
    split: 'words',
    style: (p, u) => {
      const e = ease.exit(p);
      return {y: 18 * u.unit * e, opacity: 1 - e};
    },
  },
  /** A plain fade out. */
  fadeOut: {
    duration: 0.23,
    stagger: 0.025,
    split: 'words',
    style: p => ({opacity: 1 - ease.exit(p)}),
  },
  /** Shrinks to 60% and fades. */
  shrinkOut: {
    duration: 0.23,
    stagger: 0.025,
    split: 'words',
    style: p => {
      const e = ease.exit(p);
      return {scale: 1 - 0.4 * e, opacity: 1 - e};
    },
  },
  /** Drops away a line and a half, tipping over, and fades. */
  fallOut: {
    duration: 0.23,
    stagger: 0.025,
    split: 'words',
    style: (p, u) => {
      const e = ease.exit(p);
      return {y: 1.5 * u.lineHeight * e, rotate: 8 * e, opacity: 1 - e};
    },
  },
  /** Lifts a line height and fades. */
  riseOut: {
    duration: 0.23,
    stagger: 0.025,
    split: 'words',
    style: (p, u) => {
      const e = ease.exit(p);
      return {y: -u.lineHeight * e, opacity: 1 - e};
    },
  },
  none: {duration: 0, stagger: 0, style: () => ({})},
} satisfies Record<string, KineticPreset>;

export type EnterPresetName = keyof typeof enterPresets;
export type ExitPresetName = keyof typeof exitPresets;

export const resolveEnter = (
  p: EnterPresetName | KineticPreset | undefined,
): KineticPreset =>
  p === undefined
    ? enterPresets.maskUp
    : typeof p === 'string'
      ? enterPresets[p]
      : p;

export const resolveExit = (
  p: ExitPresetName | KineticPreset | undefined,
): KineticPreset =>
  p === undefined
    ? exitPresets.maskUpOut
    : typeof p === 'string'
      ? exitPresets[p]
      : p;
