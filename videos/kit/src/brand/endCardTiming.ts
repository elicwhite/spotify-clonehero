/**
 * The end card's copy timing, in film frames: when its title, URL and
 * tagline start and are fully in, and when the credit arrives, exactly as
 * `EndCard` draws them, for a pacing sheet or a cue timed against the card.
 * Node-safe: no React at runtime, no fonts.
 */
import {
  kineticTimeline,
  type KineticTiming,
  type LineTiming,
} from '../text/timing';

/** When each part starts after the card's `at` (or after the URL), seconds. */
export const END_CARD_TIMING = {
  titleDelaySec: 0.4,
  urlDelaySec: 1,
  /** After the URL starts. */
  taglineAfterUrlSec: 0.1,
  /** After the URL starts. */
  creditAfterUrlSec: 0.9,
} as const;

/** What the card's timing depends on: its copy and its film frames. */
export interface EndCardTimingProps {
  /** Film frame the card starts building (the logo lands here). */
  at: number;
  /** The product's name, set large under the logo. */
  title: string;
  /** The address, in mono under the title. */
  url: string;
  /** A trust line or tagline under the URL. */
  tagline?: string;
  /** Start frames per part (default: a staggered build from `at`). */
  titleAt?: number;
  urlAt?: number;
  taglineAt?: number;
  creditAt?: number;
}

export interface EndCardTiming {
  /** Each line's kinetic timing props and timeline, as the card draws it. */
  titleOptions: LineTiming;
  title: KineticTiming;
  urlOptions: LineTiming;
  url: KineticTiming;
  taglineOptions: LineTiming | null;
  tagline: KineticTiming | null;
  /** Film frame the music credit starts fading in. */
  creditAt: number;
}

/**
 * When the end card's copy arrives: the title flips up, the URL decodes and
 * the tagline fades up, each `fullyIn` on its timeline.
 */
export const endCardTiming = (
  p: EndCardTimingProps,
  fps: number,
): EndCardTiming => {
  const t = END_CARD_TIMING;
  const urlAt = p.urlAt ?? p.at + t.urlDelaySec * fps;
  const titleOptions: LineTiming = {
    text: p.title,
    enter: 'flipUp',
    enterAt: p.titleAt ?? p.at + t.titleDelaySec * fps,
  };
  const urlOptions: LineTiming = {text: p.url, enter: 'decode', enterAt: urlAt};
  const taglineOptions: LineTiming | null = p.tagline
    ? {
        text: p.tagline,
        enter: 'fadeUp',
        enterAt: p.taglineAt ?? urlAt + t.taglineAfterUrlSec * fps,
      }
    : null;
  return {
    titleOptions,
    title: kineticTimeline({...titleOptions, fps}),
    urlOptions,
    url: kineticTimeline({...urlOptions, fps}),
    taglineOptions,
    tagline: taglineOptions ? kineticTimeline({...taglineOptions, fps}) : null,
    creditAt: p.creditAt ?? urlAt + t.creditAfterUrlSec * fps,
  };
};
