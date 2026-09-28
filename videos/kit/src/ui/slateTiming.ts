/**
 * The timing of an eyebrow and a chapter slate, in film frames: what
 * `Eyebrow` and `ChapterSlate` draw, for a pacing sheet or a cue timed
 * against them. Node-safe: no React at runtime, no fonts.
 */
import type {ExitPresetName, KineticPreset} from '../text/presets';
import {
  kineticTimeline,
  wholeFrameAtOrAfter,
  type KineticTiming,
  type LineTiming,
} from '../text/timing';

// ---------------------------------------------------------------------------
// Eyebrow
// ---------------------------------------------------------------------------

/** The eyebrow's accent bar and label timing, seconds. */
export const EYEBROW_TIMING = {
  /** The bar grows in over this long from `enterAt`. */
  barInSec: 0.3,
  /** The label starts this long after `enterAt`. */
  labelDelaySec: 0.1,
  /** Between letters sliding up, when the label enters with 'mask'. */
  maskStaggerSec: 1 / 75,
  /** Between letters leaving. */
  exitStaggerSec: 0.01,
  /** The bar starts shrinking this long after `exitAt`... */
  barOutDelaySec: 0.05,
  /** ...and takes this long. */
  barOutSec: 0.2,
} as const;

export type EyebrowEnter = 'type' | 'decode' | 'mask';

export interface EyebrowTiming {
  /** Film frame the bar starts growing (the label follows 0.1 s later). */
  enterAt?: number;
  /** Film frame the eyebrow starts leaving. */
  exitAt?: number;
  /** How the label arrives: typed behind a caret (default), decoded, or slid up. */
  enter?: EyebrowEnter;
}

/** The eyebrow label's kinetic timing props, as the eyebrow draws it. */
export const eyebrowLabelTiming = (
  text: string,
  {enterAt, exitAt, enter = 'type'}: EyebrowTiming,
  fps: number,
): LineTiming => ({
  text,
  split: 'chars',
  enter: enter === 'type' ? 'typeOn' : enter === 'decode' ? 'decode' : 'maskUp',
  enterAt:
    enterAt === undefined
      ? undefined
      : enterAt + EYEBROW_TIMING.labelDelaySec * fps,
  stagger: enter === 'mask' ? EYEBROW_TIMING.maskStaggerSec * fps : undefined,
  exit: 'maskUpOut',
  exitAt,
  exitStagger: EYEBROW_TIMING.exitStaggerSec * fps,
});

/**
 * The first whole film frame on which an eyebrow is gone, bar and label
 * (Infinity without `exitAt`).
 */
export const eyebrowGone = (
  text: string,
  timing: EyebrowTiming,
  fps: number,
): number =>
  timing.exitAt === undefined
    ? Infinity
    : wholeFrameAtOrAfter(
        Math.max(
          timing.exitAt +
            (EYEBROW_TIMING.barOutDelaySec + EYEBROW_TIMING.barOutSec) * fps,
          kineticTimeline({...eyebrowLabelTiming(text, timing, fps), fps}).gone,
        ),
      );

// ---------------------------------------------------------------------------
// Chapter slate
// ---------------------------------------------------------------------------

/** How the headline and caption leave, relative to the slate's `exitAt`. */
export interface SlateExit {
  headline: ExitPresetName | KineticPreset;
  caption: ExitPresetName | KineticPreset;
  /** Seconds after `exitAt` each part starts leaving. */
  headlineDelaySec: number;
  captionDelaySec: number;
  /** Seconds between units leaving (default: the preset's own). */
  headlineStaggerSec?: number;
  captionStaggerSec?: number;
}

/**
 * The standard exits: the headline leaves just after the eyebrow and the
 * caption just after that, each as one line (a word-by-word stagger strands
 * its last words alone on screen).
 */
export const SLATE_EXITS = {
  maskUp: {
    headline: 'maskUpOut',
    caption: 'blurOut',
    headlineDelaySec: 1 / 30,
    captionDelaySec: 1 / 15,
    captionStaggerSec: 1 / 120,
  },
  whip: {
    headline: 'whipUp',
    caption: 'whipUp',
    headlineDelaySec: 1 / 30,
    captionDelaySec: 1 / 15,
    captionStaggerSec: 1 / 120,
  },
} as const satisfies Record<string, SlateExit>;

/** The slate's scrim fades out over this long from `exitAt`. */
export const SLATE_SCRIM_OUT_SEC = 0.27;

/** What a slate's timing depends on: its text and its film frames. */
export interface SlateTimingProps {
  eyebrow: string;
  headline: string | readonly string[];
  caption?: string;
  /** Film frame the slate starts (the eyebrow bar). */
  enterAt: number;
  /** Headline start (default 1/6 s after `enterAt`), or one frame per word to land words on beats. */
  headlineAt?: number | readonly number[];
  /** Caption start (default: once the headline's last word reads as landed, 60% into its enter). */
  captionAt?: number;
  /** Film frame the slate starts leaving: the eyebrow, then the headline and caption as `exit` times them. */
  exitAt: number;
  /** When the eyebrow leaves, if not at `exitAt`. */
  eyebrowExitAt?: number;
  /** A standard exit (default 'maskUp') or your own. */
  exit?: keyof typeof SLATE_EXITS | SlateExit;
  /** A soft dark wash behind the slate for legibility over busy visuals (0..1, default 0). */
  scrim?: number;
}

export interface SlateTiming {
  /** The headline's and caption's kinetic timing props and timelines, as the slate draws them. */
  headlineOptions: LineTiming;
  headline: KineticTiming;
  captionOptions: LineTiming | null;
  caption: KineticTiming | null;
  /** The first whole film frame on which every part (eyebrow, headline, caption, scrim) is gone. */
  gone: number;
}

/** When every part of a chapter slate enters and leaves, in film frames. */
export const chapterSlateTiming = (
  p: SlateTimingProps,
  fps: number,
): SlateTiming => {
  const exit = p.exit ?? 'maskUp';
  const out: SlateExit = typeof exit === 'string' ? SLATE_EXITS[exit] : exit;
  const frames = (sec: number | undefined) =>
    sec === undefined ? undefined : sec * fps;
  const headlineOptions: LineTiming = {
    text: p.headline,
    enterAt: p.headlineAt ?? p.enterAt + fps / 6,
    exit: out.headline,
    exitAt: p.exitAt + out.headlineDelaySec * fps,
    exitStagger: frames(out.headlineStaggerSec),
  };
  const headline = kineticTimeline({...headlineOptions, fps});
  const lastStart = Math.max(...headline.units.map(u => u.start));
  const captionOptions: LineTiming | null = p.caption
    ? {
        text: p.caption,
        enter: 'fadeUp',
        enterAt: p.captionAt ?? lastStart + 0.6 * headline.enterFrames,
        exit: out.caption,
        exitAt: p.exitAt + out.captionDelaySec * fps,
        exitStagger: frames(out.captionStaggerSec),
      }
    : null;
  const caption = captionOptions
    ? kineticTimeline({...captionOptions, fps})
    : null;
  const gone = wholeFrameAtOrAfter(
    Math.max(
      eyebrowGone(
        p.eyebrow,
        {enterAt: p.enterAt, exitAt: p.eyebrowExitAt ?? p.exitAt},
        fps,
      ),
      headline.gone,
      caption?.gone ?? -Infinity,
      (p.scrim ?? 0) > 0 ? p.exitAt + SLATE_SCRIM_OUT_SEC * fps : -Infinity,
    ),
  );
  return {headlineOptions, headline, captionOptions, caption, gone};
};
