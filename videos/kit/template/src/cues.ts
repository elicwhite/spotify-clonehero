/**
 * The film's copy and every cue, read from the timeline: bars and beats
 * count from each scene's first bar (`sceneBeat`), never typed seconds.
 * Pure, so the scenes (React) and the pacing sheet (Node) share one set of
 * frames.
 */
import type {EndCardTimingProps} from '@musiccharts/video-kit/brand/endCardTiming';
import type {TimelineApi} from '@musiccharts/video-kit/music';
import {board} from './storyboard';

export const TITLE = {
  headline: 'Your next product film',
  caption: 'Every scene lands on the beat.',
} as const;

export const END = {
  title: '{{FILM_TITLE}}',
  url: 'musiccharts.tools',
} as const;

export interface TitleCues {
  /** One headline word per beat, from the first bar's second beat. */
  words: number[];
  /** The caption, on the second bar's second beat. */
  captionAt: number;
  /** Headline and caption leave on the third bar's last beat. */
  out: number;
  /** Every beat of the scene, and its downbeats. */
  beats: number[];
  downbeats: number[];
}

export const titleCues = (tl: TimelineApi): TitleCues => {
  const beat = board.sceneBeat(tl.frameOfBeat, 'title');
  const {from, to} = board.scene('title');
  const inScene = tl.beats.filter(b => b.frame >= from && b.frame < to);
  return {
    words: TITLE.headline.split(' ').map((_, i) => beat(0, 1 + i)),
    captionAt: beat(1, 1),
    out: beat(2, 3),
    beats: inScene.map(b => b.frame),
    downbeats: inScene.filter(b => b.downbeat).map(b => b.frame),
  };
};

/**
 * The end card's copy and cues: the logo lands on the scene's first
 * downbeat, the title on its second beat, the address on its fourth. The
 * scene draws `EndCard` from this and the pacing sheet times it with
 * `endCardTiming`, so both read the card's own timing.
 */
export const endCard = (tl: TimelineApi): EndCardTimingProps => {
  const beat = board.sceneBeat(tl.frameOfBeat, 'end');
  return {
    at: beat(0),
    titleAt: beat(0, 1),
    urlAt: beat(0, 3),
    title: END.title,
    url: END.url,
  };
};
