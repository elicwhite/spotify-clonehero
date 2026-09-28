/**
 * A timeline built from a tempo alone, for films cut to a music bed with a
 * steady tempo: beats and bars, one segment, and no notes or hits.
 */
import type {Bar, Beat, Meta, Timeline} from './contract';
import {makeTimeline} from './make';

export interface TempoTimelineOptions {
  bpm: number;
  /** Default 4. */
  beatsPerBar?: number;
  durationSec: number;
  fps: number;
  /** Video seconds of the first downbeat (bar 0). Default 0. */
  firstBeatSec?: number;
  /** Default empty strings. */
  meta?: Meta;
}

export const tempoTimeline = ({
  bpm,
  beatsPerBar = 4,
  durationSec,
  fps,
  firstBeatSec = 0,
  meta = {title: '', artist: ''},
}: TempoTimelineOptions): Timeline => {
  if (!(bpm > 0) || !(fps > 0) || !(durationSec > 0)) {
    throw new Error('[tempoTimeline] bpm, fps and durationSec must be > 0');
  }
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1) {
    throw new Error('[tempoTimeline] beatsPerBar must be a whole number >= 1');
  }
  if (!(firstBeatSec >= 0) || firstBeatSec >= durationSec) {
    throw new Error('[tempoTimeline] firstBeatSec must be in [0, durationSec)');
  }
  const beatSec = 60 / bpm;
  const beats: Omit<Beat, 'frame'>[] = [];
  const bars: Omit<Bar, 'frame' | 'index'>[] = [];
  // Each time is computed from its index, so no rounding error accumulates.
  for (let k = 0; firstBeatSec + k * beatSec < durationSec; k++) {
    const t = firstBeatSec + k * beatSec;
    const bar = Math.floor(k / beatsPerBar);
    const beat = k % beatsPerBar;
    beats.push({t, bar, beat, downbeat: beat === 0});
    if (beat === 0) bars.push({t, songBar: bar, section: ''});
  }
  return makeTimeline({
    fps,
    durationSec,
    meta,
    tempo: {bpm, beatSec, barSec: beatSec * beatsPerBar},
    beats,
    bars,
  });
};
