/**
 * ms ↔ tick conversion under a predicted synctrack.
 *
 * The synctrack is a piecewise-constant tempo map: each segment carries
 * (segment_start_tick, segment_start_ms, bpm).
 *
 * Anchoring: the predicted origin (the first downbeat) must land exactly on
 * a bar boundary of the tick grid — bars start at tick 0 because the time
 * signature is written there. Anchoring ms=0 at tick 0 instead would put
 * every predicted beat `origin_beats * resolution` ticks off the grid, so
 * notes sitting perfectly on predicted beats would get off-grid ticks and
 * notation would render as offbeat/tuplet soup. We pick the smallest
 * whole-bar tick ≥ the origin's beat distance from ms=0, which also keeps
 * every event at ms ≥ 0 on a non-negative tick.
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

  // Place the origin (= first tempo event = first predicted downbeat) on a
  // bar boundary, then extrapolate backward at the first BPM to find the
  // tick of ms=0.
  const numerator = sync.timeSignatures[0]?.numerator ?? 4;
  const barBeats = Math.max(1, numerator);
  const originBeats = (tempos[0].ms / 60000) * firstBpm;
  const originBarIndex =
    tempos[0].ms > 0 ? Math.ceil(originBeats / barBeats - 1e-9) : 0;
  const originTick = originBarIndex * barBeats * resolution;
  const ms0Tick = originTick - originBeats * resolution;

  const segs: TempoSegment[] = [];
  segs.push({tick: ms0Tick, ms: 0, bpm: firstBpm});
  let curMs = 0;
  let curTick = ms0Tick;
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
