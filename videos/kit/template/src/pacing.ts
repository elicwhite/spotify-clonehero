/**
 * The film's pacing sheet: each block of copy with the frame it is fully on
 * screen and the frame it starts to leave, from the same cues and text
 * presets the scenes draw with. `pnpm pacing` audits it against the kit's
 * pacing rules (kit/scripts/qa/pacing.ts).
 */
import {endCardTiming} from '@musiccharts/video-kit/brand/endCardTiming';
import {buildTimelineApi} from '@musiccharts/video-kit/music';
import type {PacingSheet} from '@musiccharts/video-kit/scripts/qa/pacing.ts';
import {fullyInFrame} from '@musiccharts/video-kit/text/timing';
import {END, endCard, TITLE, titleCues} from './cues';
import {timeline} from './music';
import {board} from './storyboard';

const tl = buildTimelineApi(timeline);
const {fps} = tl;
const title = titleCues(tl);
const card = endCardTiming(endCard(tl), fps);
const endOut = board.scene('end').to;

export const pacing: PacingSheet = {
  fps,
  text: [
    {
      id: 'title-headline',
      kind: 'headline',
      words: TITLE.headline,
      fullyIn: fullyInFrame({text: TITLE.headline, fps, enterAt: title.words}),
      out: title.out,
    },
    {
      id: 'title-caption',
      kind: 'callout',
      words: TITLE.caption,
      fullyIn: fullyInFrame({
        text: TITLE.caption,
        fps,
        enter: 'fadeUp',
        enterAt: title.captionAt,
      }),
      out: title.out,
    },
    // The end card's own timing: its presets and delays live in the kit.
    {
      id: 'end-title',
      kind: 'headline',
      words: END.title,
      fullyIn: card.title.fullyIn,
      out: endOut,
    },
    {
      id: 'end-url',
      kind: 'callout',
      words: END.url,
      fullyIn: card.url.fullyIn,
      out: endOut,
    },
  ],
  actions: [],
  camera: [],
};
