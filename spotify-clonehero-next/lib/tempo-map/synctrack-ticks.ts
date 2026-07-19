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
 *    land exactly on a bar line of the tick grid — otherwise every
 *    predicted beat sits `origin_beats * resolution` ticks off the grid and
 *    notation renders as offbeat/tuplet soup.
 *
 * The lead-in policy is fit to 15.5k human charts (drum-to-chart
 * autoresearch-tempo/analysis/lead_in_imitation_eval.py, 2026-07-02).
 * Human charters bound the lead-in tempo to within ~1.5x of the real tempo
 * (median stretch 19%, p90 50%) and otherwise shorten the FIRST bar via a
 * time-signature change (numerators 1..3 observed in the wild) rather than
 * warp BPM. Tiers, in order:
 *
 *   a. Whole lead-in bars at a stretched BPM when the nearest whole-bar
 *      count keeps the stretch within MAX_STRETCH_DEV (the dominant human
 *      mechanism; matches held-out charters 74% on beat count).
 *   b. Partial first bar: round the lead-in to whole BEATS; the remainder
 *      bar is written as an r/4 time signature at tick 0 with the real TS
 *      starting where the remainder ends. BPM stays near the real tempo.
 *   c. Sub-beat lead-in (audio starts almost on the downbeat): put the
 *      origin's bar line one full bar BEFORE the audio start — the audible
 *      lead-in plays at the real tempo and only the pre-audio remainder is
 *      compressed into a near-instant segment (same shape as the
 *      negative-origin case).
 *
 * When the origin is at/before the audio start, the small pre-audio region
 * is compressed into a near-instant high-BPM segment so ms=0 still maps to
 * (almost exactly) tick 0.
 */

import type {Synctrack} from './types';

export interface TempoSegment {
  tick: number;
  ms: number;
  bpm: number;
}

export interface SyncLayout {
  segs: TempoSegment[];
  /** Partial lead-in bar (the charter "shortened first measure" trick).
   * When present, the written chart opens with `numerator/denominator` at
   * tick 0 and the real time signature starts at `endTick`. */
  leadInTs: {numerator: number; denominator: number; endTick: number} | null;
}

/** Chart time the compressed pre-audio region is allowed to occupy when the
 * predicted origin lies before the audio start. */
const COLLAPSE_MS = 0.5;

/** Max lead-in BPM deviation from the real tempo before switching from
 * whole stretched bars to a partial first bar (human median stretch is
 * ~19%, p90 ~50%). */
const MAX_STRETCH_DEV = 0.25;

/** Max whole-beat rounding deviation for the partial-bar tier; beyond this
 * (lead-in shorter than ~2/3 beat) fall back to the pre-audio bar. */
const MAX_BEAT_DEV = 0.5;

/**
 * Build the tick layout (tempo segments + optional partial lead-in bar)
 * from a predicted synctrack. Guarantees ms(0) ≈ tick 0 (exact for origins
 * after the audio start) and that the origin lands on a bar line.
 */
export function buildSyncLayout(
  sync: Synctrack,
  resolution: number,
): SyncLayout {
  const tempos = [...sync.tempos].sort((a, b) => a.ms - b.ms);
  if (tempos.length === 0) {
    return {segs: [{tick: 0, ms: 0, bpm: 120}], leadInTs: null};
  }
  const firstBpm = tempos[0].bpm;
  const originMs = tempos[0].ms;

  const ts0 = sync.timeSignatures[0];
  const numerator = ts0?.numerator ?? 4;
  const denominator = ts0?.denominator ?? 4;
  // Beats here are quarter notes (chart convention): a bar spans
  // numerator * 4/denominator quarter beats.
  const barBeats = Math.max(1, (numerator * 4) / denominator);
  const barTicks = barBeats * resolution;
  const originBeats = (originMs / 60000) * firstBpm;

  const segs: TempoSegment[] = [];
  let leadInTs: SyncLayout['leadInTs'] = null;
  let originTick: number;

  const leadBeats = Math.round(originBeats);
  const intBar = Number.isInteger(barBeats) && barBeats >= 2;

  if (originMs > 1) {
    const barsCnt = Math.max(1, Math.round(originBeats / barBeats));
    const barsDev = Math.abs((barsCnt * barBeats) / originBeats - 1);
    const beatsDev =
      leadBeats >= 1 ? Math.abs(leadBeats / originBeats - 1) : Infinity;
    const trickOk = intBar && beatsDev <= MAX_BEAT_DEV;

    if (barsDev <= MAX_STRETCH_DEV || (!trickOk && barsDev <= MAX_BEAT_DEV)) {
      // (a) whole stretched bars
      originTick = barsCnt * barTicks;
      segs.push({
        tick: 0,
        ms: 0,
        bpm: (originTick / resolution) * (60000 / originMs),
      });
      segs.push({tick: originTick, ms: originMs, bpm: firstBpm});
    } else if (trickOk) {
      // (b) whole beats; non-whole-bar remainder becomes a partial first bar
      originTick = leadBeats * resolution;
      segs.push({tick: 0, ms: 0, bpm: (60000 * leadBeats) / originMs});
      segs.push({tick: originTick, ms: originMs, bpm: firstBpm});
      const r = leadBeats % barBeats;
      if (r > 0) {
        leadInTs = {numerator: r, denominator: 4, endTick: r * resolution};
      }
    } else {
      // (c) sub-beat lead-in: origin's bar line one bar before the audio
      // start; audible lead-in at the real tempo, pre-audio compressed.
      const preBeats = barBeats - originBeats; // grid beats before ms=0
      const ms0Tick = preBeats * resolution;
      segs.push({
        tick: 0,
        ms: -COLLAPSE_MS,
        bpm: (ms0Tick / resolution) * (60000 / COLLAPSE_MS),
      });
      segs.push({tick: ms0Tick, ms: 0, bpm: firstBpm});
      originTick = barTicks;
    }
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
  return {segs, leadInTs};
}

/** Tempo segments only (see buildSyncLayout). */
export function buildSegments(
  sync: Synctrack,
  resolution: number,
): TempoSegment[] {
  return buildSyncLayout(sync, resolution).segs;
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
