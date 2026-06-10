/**
 * ms ↔ tick conversion under a predicted synctrack.
 *
 * The synctrack is a piecewise-constant tempo map: each segment carries
 * (segment_start_tick, segment_start_ms, bpm). ms=0 is anchored at tick=0
 * using the first predicted BPM, so chart events before the predicted origin
 * still get non-negative ticks.
 */

import type {Synctrack} from './types';

export interface TempoSegment {
  tick: number;
  ms: number;
  bpm: number;
}

/**
 * Build piecewise-constant tempo segments from a predicted synctrack,
 * accumulating ticks from the ms=0 / tick=0 anchor.
 */
export function buildSegments(sync: Synctrack, resolution: number): TempoSegment[] {
  const tempos = [...sync.tempos].sort((a, b) => a.ms - b.ms);
  if (tempos.length === 0) {
    return [{tick: 0, ms: 0, bpm: 120}];
  }
  const firstBpm = tempos[0].bpm;
  const segs: TempoSegment[] = [];
  // Anchor: ms=0 at tick=0, using the first BPM up to the first tempo event.
  segs.push({tick: 0, ms: 0, bpm: firstBpm});
  let curMs = 0;
  let curTick = 0;
  if (Math.abs(tempos[0].ms - 0) > 1e-6) {
    const dMs = tempos[0].ms - curMs;
    const beats = (dMs / 60000) * firstBpm;
    curTick = curTick + beats * resolution;
    curMs = tempos[0].ms;
    segs.push({tick: curTick, ms: curMs, bpm: firstBpm});
  }
  for (let i = 1; i < tempos.length; i++) {
    const prev = tempos[i - 1];
    const t = tempos[i];
    const dMs = t.ms - prev.ms;
    const beats = (dMs / 60000) * prev.bpm;
    curTick = curTick + beats * resolution;
    curMs = t.ms;
    segs.push({tick: curTick, ms: curMs, bpm: t.bpm});
  }
  return segs;
}

/**
 * Convert wall-clock ms to a (fractional) tick under the segment map.
 * Times before the first segment extrapolate backward using its BPM.
 */
export function msToTick(ms: number, segs: TempoSegment[], resolution: number): number {
  let i = 0;
  for (let k = 1; k < segs.length; k++) {
    if (segs[k].ms <= ms) i = k;
    else break;
  }
  const seg = segs[i];
  const deltaMs = ms - seg.ms;
  const beats = (deltaMs / 60000) * seg.bpm;
  return seg.tick + beats * resolution;
}

/** Convert a tick back to wall-clock ms under the segment map. */
export function tickToMs(tick: number, segs: TempoSegment[], resolution: number): number {
  let i = 0;
  for (let k = 1; k < segs.length; k++) {
    if (segs[k].tick <= tick) i = k;
    else break;
  }
  const seg = segs[i];
  const dTick = tick - seg.tick;
  const beats = dTick / resolution;
  return seg.ms + (beats / seg.bpm) * 60000;
}
