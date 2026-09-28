/**
 * The one way a timeline is built: from its times in video seconds, with
 * every frame placed (`Math.round(t * fps)`), lists sorted, defaults filled
 * and the contract checked. The tempo builder and the soundtrack writer both
 * build through it.
 */
import {sortedUnique} from '../motion/sorted';
import type {
  Bar,
  Beat,
  DrumNote,
  GuitarNote,
  Hits,
  Meta,
  Phrase,
  Segment,
  Syllable,
  Tempo,
  Timeline,
} from './contract';
import {assertTimeline, TIMELINE_VERSION} from './validate';

type Timed<T> = Omit<T, 'frame'>;

/** A timeline's data before frames are placed. */
export interface TimelineParts {
  fps: number;
  durationSec: number;
  meta: Meta;
  tempo: Tempo;
  beats: readonly Timed<Beat>[];
  /** In order; each bar's `index` is its position. */
  bars: readonly Omit<Bar, 'frame' | 'index'>[];
  /** Default: the film plays the song from its start, one segment. */
  segments?: readonly Segment[];
  drums?: readonly Timed<DrumNote>[];
  guitar?: readonly Timed<GuitarNote>[];
  syllables?: readonly Timed<Syllable>[];
  phrases?: readonly Phrase[];
  /** Default: the audible drum notes (every non-ghost note; kick, snare = red lane, crash). */
  hits?: Hits;
  mixNotes?: string;
}

const byTime = <T extends {t: number}>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => a.t - b.t);

/** Hits heard in the drum part: every note that is not a ghost note. */
const hitsOf = (drums: readonly Timed<DrumNote>[]): Hits => {
  const audible = drums.filter(d => !d.ghost);
  const times = (keep: (d: Timed<DrumNote>) => boolean) =>
    sortedUnique(audible.filter(keep).map(d => d.t));
  return {
    kick: times(d => d.lane === 'kick'),
    snare: times(d => d.lane === 'red'),
    crash: times(d => d.kit === 'crash'),
    any: times(() => true),
  };
};

export const makeTimeline = (parts: TimelineParts): Timeline => {
  const {fps, durationSec} = parts;
  const frameOf = (t: number) => Math.round(t * fps);
  const placed = <T extends {t: number}>(items: readonly T[] = []) =>
    byTime(items).map(item => ({...item, frame: frameOf(item.t)}));
  const drums = parts.drums ?? [];
  const timeline: Timeline = {
    version: TIMELINE_VERSION,
    fps,
    durationSec,
    durationFrames: frameOf(durationSec),
    meta: parts.meta,
    tempo: parts.tempo,
    beats: placed(parts.beats),
    bars: parts.bars.map((bar, index) => ({
      ...bar,
      index,
      frame: frameOf(bar.t),
    })),
    segments: [
      ...(parts.segments ?? [
        {
          videoStart: 0,
          videoEnd: durationSec,
          songStart: 0,
          songEnd: durationSec,
        },
      ]),
    ],
    notes: {drums: placed(drums), guitar: placed(parts.guitar)},
    vocals: {
      syllables: placed(parts.syllables),
      phrases: [...(parts.phrases ?? [])],
    },
    hits: parts.hits ?? hitsOf(drums),
    ...(parts.mixNotes === undefined ? {} : {mix: {notes: parts.mixNotes}}),
  };
  return assertTimeline(timeline, 'makeTimeline');
};
