/**
 * The film's music: the timeline every cue reads, and the soundtrack's files.
 * Until the film has a soundtrack it is a steady tempo bed with no files, so
 * the film renders with no song material at all. Once `buildSoundtrack` has
 * written public/generated, both switch to it (see README.md).
 *
 * Pure: the storyboard, the cues, the pacing sheet and Node tools import it.
 */
import {tempoTimeline} from '@musiccharts/video-kit/music';
import {FORMAT} from './format';

/** 120 BPM in 4/4: a beat is half a second and a bar two. Eight bars. */
export const timeline = tempoTimeline({
  bpm: 120,
  beatsPerBar: 4,
  durationSec: 16,
  fps: FORMAT.fps,
});

/** The soundtrack's files, each a path in public/. */
export interface Soundtrack {
  /** The mix the film plays ('generated/audio/mix.wav'). */
  mix?: string;
  /** The curves scenes read (`tl.peaks`, `tl.envelopeAt`). */
  peaks?: string;
  envelopes?: string;
}

/** None on the tempo bed. */
export const soundtrack: Soundtrack = {};
