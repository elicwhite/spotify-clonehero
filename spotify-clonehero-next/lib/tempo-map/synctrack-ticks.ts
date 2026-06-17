/**
 * ms ↔ tick conversion under a predicted synctrack.
 *
 * The synctrack is a piecewise-constant tempo map: each segment carries
 * (segment_start_tick, segment_start_ms, bpm).
 *
 * Two constraints shape the anchoring:
 *
 * 1. **Audio alignment.** The game integrates the written tempo events from
 *    tick 0 = time 0, so the segment map must satisfy ms(tick=0) = 0. Any
 *    extra tick region before the music would be added as phantom chart
 *    time and shift every note against the audio.
 * 2. **Grid alignment.** The predicted origin (the first downbeat) must
 *    land exactly on a bar boundary of the tick grid — otherwise every
 *    predicted beat sits `origin_beats * resolution` ticks off the grid and
 *    notation renders as offbeat/tuplet soup.
 *
 * Both are satisfied with a lead-in bar: when the origin is after the audio
 * start, ticks [0, barTicks) get their own BPM chosen so that one bar spans
 * exactly `origin_ms` — the standard charter trick for audio that doesn't
 * begin on a downbeat. When the origin is at/before the audio start, the
 * small pre-audio region is compressed into a near-instant high-BPM segment
 * so ms=0 still maps to (almost exactly) tick 0.
 */

import type {Synctrack} from './types';

export interface TempoSegment {
  tick: number;
  ms: number;
  bpm: number;
}

/** Chart time the compressed pre-audio region is allowed to occupy when the
 * predicted origin lies before the audio start. */
const COLLAPSE_MS = 0.5;

/**
 * Build piecewise-constant tempo segments from a predicted synctrack.
 * Guarantees ms(0) ≈ tick 0 (exact for origins after the audio start) and
 * that the origin lands on a bar boundary.
 */
export function buildSegments(
  sync: Synctrack,
  resolution: number,
): TempoSegment[] {
  const tempos = [...sync.tempos].sort((a, b) => a.ms - b.ms);
  if (tempos.length === 0) {
    return [{tick: 0, ms: 0, bpm: 120}];
  }
  const firstBpm = tempos[0].bpm;
  const originMs = tempos[0].ms;

  const numerator = sync.timeSignatures[0]?.numerator ?? 4;
  const barBeats = Math.max(1, numerator);
  const barTicks = barBeats * resolution;
  const originBeats = (originMs / 60000) * firstBpm;

  const segs: TempoSegment[] = [];
  let originTick: number;

  if (originMs > 1) {
    // Lead-in: whole bars from tick 0 spanning exactly originMs, at a BPM
    // chosen to make that true. One bar usually; more if the origin is far
    // enough into the audio that one bar would need an absurdly slow lead.
    const leadBars = Math.max(1, Math.ceil(originBeats / barBeats - 1e-9));
    originTick = leadBars * barTicks;
    const leadBpm = (originTick / resolution) * (60000 / originMs);
    segs.push({tick: 0, ms: 0, bpm: leadBpm});
    segs.push({tick: originTick, ms: originMs, bpm: firstBpm});
  } else if (originMs < -1) {
    // Origin (first downbeat) is before the audio starts. Bars align from
    // tick 0 = the origin, but the pre-audio stretch [origin, 0) has to be
    // compressed so ms=0 lands (within COLLAPSE_MS) at its tick.
    originTick = 0;
    const ms0Tick = -originBeats * resolution; // > 0
    const collapseBpm = (ms0Tick / resolution) * (60000 / COLLAPSE_MS);
    segs.push({tick: 0, ms: -COLLAPSE_MS, bpm: collapseBpm});
    segs.push({tick: ms0Tick, ms: 0, bpm: firstBpm});
  } else {
    // Origin within ±1 ms of the audio start: tick 0 is the origin.
    originTick = 0;
    segs.push({tick: 0, ms: 0, bpm: firstBpm});
  }

  let curTick = originTick;
  for (let i = 1; i < tempos.length; i++) {
    const prev = tempos[i - 1];
    const t = tempos[i];
    const beats = ((t.ms - prev.ms) / 60000) * prev.bpm;
    curTick = curTick + beats * resolution;
    segs.push({tick: curTick, ms: t.ms, bpm: t.bpm});
  }
  return segs;
}

/**
 * Convert wall-clock ms to a (fractional) tick under the segment map.
 * Times before the first segment extrapolate backward using its BPM.
 */
export function msToTick(
  ms: number,
  segs: TempoSegment[],
  resolution: number,
): number {
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
export function tickToMs(
  tick: number,
  segs: TempoSegment[],
  resolution: number,
): number {
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
