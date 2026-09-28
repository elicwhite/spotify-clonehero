/**
 * Design tokens for product videos: the one place a colour, size, duration
 * or curve is written down. Components read these; a film that needs a value
 * that is not here adds a token rather than inlining a literal.
 *
 * Colours the app already names come from its social-card tokens
 * (`lib/og/tokens`), so a video and the product share one palette. The rest
 * are video-only.
 *
 * Units:
 * - Durations are in SECONDS (`toFrames(sec, fps)` converts).
 * - Sizes (type, space, radius) are REFERENCE px: px on a frame whose
 *   short side is 1080. Multiply by `useFormat().unit` for the
 *   composition's own size.
 */
import {OG_COLORS, OG_LANES} from '@product/lib/og/tokens';
import {SAFE_MARGIN} from '../format/format';
import type {SpringConfig} from '../motion/spring';

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/** Brand and neutral colours (dark theme). */
export const color = {
  /** The stage floor: every frame's darkest value. */
  stage: '#08070d',
  /** Top-left end of the stage sweep. */
  stageWarm: '#17091d',
  /** Middle of the stage sweep. */
  stageMid: '#0a0710',

  text: OG_COLORS.text,
  /** Pure white light: sparks, flashes, hot cores. */
  white: '#ffffff',
  muted: OG_COLORS.muted,
  subtle: OG_COLORS.subtle,
  /** Secondary micro labels, ticks, idle grid. */
  faint: 'rgba(255,255,255,0.32)',
  /** Hairlines and dividers. */
  hairline: 'rgba(255,255,255,0.10)',

  /** The logo square, hsl(298 43% 41%). */
  brand: '#933c96',
  /** Glow and accent purple. Use it for light, not for the logo. */
  purple: OG_COLORS.purple,
  /** Brighter purple for the hottest point of a glow. */
  purpleHot: '#d58be2',
  /** Near-white lavender: flashes and the brightest purple highlights. */
  purplePale: '#f4ecff',
  /** Accent for emphasised words. */
  fuchsia: '#e879f9',
  /** Success and "ready" states. */
  emerald: '#34d399',

  /** Product panel border. */
  panelBorder: OG_COLORS.cardBorder,
  /** Translucent glass panel. */
  glass: OG_COLORS.panel,

  /** The app's page background, dark theme (globals.css `--background`). */
  pageBg: '#0c0a09',

  /** Service marks. */
  spotify: OG_COLORS.spotify,
} as const;

/** The brand background: a purple glow over the stage sweep. */
export const stageBackground: string = OG_COLORS.background;

/** The five Clone Hero drum-lane gem colours, dark theme. */
export const lane = OG_LANES;

/** All five lane colours in drum order (kick first, then pads left to right). */
export const LANE_COLORS: readonly string[] = [
  lane.kick,
  lane.red,
  lane.yellow,
  lane.blue,
  lane.green,
];

/**
 * Guitar fret colours by fret index (0 green, 1 red, 2 yellow, 3 blue,
 * 4 orange, 5 open). They match the drum lanes; open notes use the accent
 * purple.
 */
export const FRET_COLORS: readonly string[] = [
  lane.green,
  lane.red,
  lane.yellow,
  lane.blue,
  lane.kick,
  color.purple,
];

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/** The font families `text/fonts` loads, by name. */
export const fontFace = {
  sans: 'Inter Variable',
  mono: 'JetBrains Mono Variable',
} as const;

/** CSS font-family lists. */
export const fontFamily = {
  sans: `"${fontFace.sans}", "Inter", system-ui, sans-serif`,
  mono: `"${fontFace.mono}", "JetBrains Mono", ui-monospace, monospace`,
} as const;

export interface TypeToken {
  family: keyof typeof fontFamily;
  /** Reference px. */
  size: number;
  weight: number;
  /** em */
  tracking: number;
  /** Unitless multiple of size. */
  lineHeight: number;
  uppercase?: boolean;
  color?: string;
}

/** The type scale. Every on-screen string uses one of these. */
export const type = {
  /** A product name as the hero of a title or end card. */
  display: {
    family: 'sans',
    size: 160,
    weight: 760,
    tracking: -0.03,
    lineHeight: 1.0,
  },
  /** Scene headlines: at most two lines, at most `space.headlineMaxWidth` wide. */
  h1: {
    family: 'sans',
    size: 86,
    weight: 760,
    tracking: -0.03,
    lineHeight: 1.06,
  },
  /** Secondary statements. */
  h2: {
    family: 'sans',
    size: 64,
    weight: 720,
    tracking: -0.025,
    lineHeight: 1.1,
  },
  /** Captions under a headline. */
  caption: {
    family: 'sans',
    size: 32,
    weight: 450,
    tracking: -0.005,
    lineHeight: 1.38,
    color: color.muted,
  },
  /** The brand wordmark "Music Charts Tools". */
  wordmark: {
    family: 'sans',
    size: 44,
    weight: 600,
    tracking: -0.01,
    lineHeight: 1.1,
  },
  /** Chapter eyebrow: mono, uppercase, wide tracking. */
  eyebrow: {
    family: 'mono',
    size: 23,
    weight: 520,
    tracking: 0.18,
    lineHeight: 1.2,
    uppercase: true,
  },
  /** Micro labels: bar.beat, BPM, lane and tier names, timestamps. */
  micro: {
    family: 'mono',
    size: 20,
    weight: 520,
    tracking: 0.02,
    lineHeight: 1.2,
  },
  /** Small micro labels under dense markers. */
  microSmall: {
    family: 'mono',
    size: 18,
    weight: 520,
    tracking: 0.02,
    lineHeight: 1.2,
  },
  /** A URL on an end card. */
  url: {family: 'mono', size: 40, weight: 500, tracking: 0, lineHeight: 1.2},
  /** A callout's label card. */
  callout: {
    family: 'sans',
    size: 30,
    weight: 620,
    tracking: -0.015,
    lineHeight: 1.2,
  },
  /** Chip labels (the small and large chips override the size). */
  chip: {family: 'mono', size: 20, weight: 560, tracking: 0.02, lineHeight: 1},
  /** Credits and trust lines. */
  small: {
    family: 'sans',
    size: 24,
    weight: 460,
    tracking: 0,
    lineHeight: 1.35,
    color: color.subtle,
  },
} as const satisfies Record<string, TypeToken>;

export type TypeName = keyof typeof type;

// ---------------------------------------------------------------------------
// Space and shape (reference px)
// ---------------------------------------------------------------------------

export const space = {
  /** Title-safe margin (`useFormat().safe` is the box it leaves). Nothing important crosses it. */
  safe: SAFE_MARGIN,
  /** A chapter slate's position (eyebrow row, top left). */
  slateX: 120,
  slateY: 118,
  /** Eyebrow row to headline top. */
  slateEyebrowGap: 30,
  /** Headline bottom to caption top. */
  slateCaptionGap: 28,
  /** Widest headline measure. */
  headlineMaxWidth: 1100,
  /** Widest caption measure. */
  captionMaxWidth: 960,
  /** The eyebrow's accent bar. */
  eyebrowBarWidth: 40,
  eyebrowBarHeight: 4,
  eyebrowBarGap: 20,
} as const;

export const radius = {
  chip: 10,
  pill: 999,
} as const;

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/**
 * The three cubic-bezier curves, as data. `ease.enter`, `ease.exit` and
 * `ease.camera` in ./ease.ts are the functions.
 */
export const curves = {
  /** Entrances: expo-out. */
  enter: [0.16, 1, 0.3, 1],
  /** Exits: ease-in. */
  exit: [0.7, 0, 0.84, 0],
  /** Camera moves: in-out. */
  camera: [0.83, 0, 0.17, 1],
} as const;

/**
 * Spring presets: configs for motion's spring functions. Overshoot is the
 * peak past the target for a 0 -> 1 move; the settle time is
 * `settle(springs.pop, fps)`, when the spring stays within 0.5% of its
 * target.
 */
export const springs = {
  /** 16% overshoot. Pops, chips, gems landing. */
  pop: {damping: 12, stiffness: 200, mass: 0.7},
  /** 9% overshoot. Logo and hero marks. */
  hero: {damping: 13.5, stiffness: 200, mass: 0.6},
  /** 9% overshoot, quicker. A dragged thing settling onto the grid. */
  snap: {damping: 14, stiffness: 220, mass: 0.6},
  /** 16% overshoot, slower and heavier. Panels and big cards. */
  soft: {damping: 13, stiffness: 180, mass: 0.9},
  /** 23% overshoot: the follow-through wobble after UI snaps into place. */
  wobble: {damping: 12, stiffness: 220, mass: 0.9},
  /**
   * 14% under critical damping, so its 0.5% overshoot never shows: copy
   * rising into place. Within 1.5% of rest a third of a second after it
   * starts, so a line reads that long after its last word starts.
   */
  copy: {damping: 20, stiffness: 170, mass: 0.8},
} as const satisfies Record<string, SpringConfig>;

export type SpringName = keyof typeof springs;

/** Standard durations and staggers, in seconds. */
export const timing = {
  /** A headline word's reveal. */
  wordEnter: 0.5,
  wordStagger: 0.06,
  /** A headline word's exit. */
  wordExit: 0.25,
  wordExitStagger: 0.03,
  /** Title letters. */
  charStagger: 0.025,
  /** Typing speed for eyebrows, per character. */
  typeStagger: 1 / 30,
  /** A full-frame flash's decay. */
  flash: 0.1,
  /** A kick punch's decay. */
  kickDecay: 0.12,
  /** Camera shake on a final hit. */
  shake: 0.1,
} as const;

/** Accent strengths, for the hero layer only. */
export const accent = {
  /** Flash peak opacity on hero downbeats. */
  flashPeak: 0.4,
} as const;
