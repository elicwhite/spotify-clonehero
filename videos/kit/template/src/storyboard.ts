/**
 * The film's scenes, each starting on a bar line of the music: every frame
 * comes from the timeline's bars, so the storyboard holds at any frame rate.
 * The film fails to render if a scene drifts off its bar.
 *
 * Keep this module free of components: Node tools (the recorder, the pacing
 * audit) load it.
 */
import {defineStoryboard} from '@musiccharts/video-kit/clock';
import {beatGrid} from '@musiccharts/video-kit/music';
import {timeline} from './music';

const {frameOfBeat: bar} = beatGrid(timeline);

export const board = defineStoryboard([
  {id: 'title', from: bar(0), to: bar(4), bar: 0},
  {id: 'end', from: bar(4), to: bar(8), bar: 4},
]);

export type SceneId = (typeof board.scenes)[number]['id'];
