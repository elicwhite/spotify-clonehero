/**
 * Tick <-> millisecond conversion utilities.
 *
 * msToTick is the inverse of tickToMs from app/sheet-music/[slug]/chartUtils.ts.
 * buildTimedTempos pre-computes msTime for each tempo event (same algorithm
 * scan-chart uses in getTimedTempos).
 */

import type { TimedTempo } from './chart-types';

interface TempoInput {
  tick: number;
  beatsPerMinute: number;
}

/**
 * Build an array of TimedTempo from tempo events by computing the absolute
 * msTime for each tempo change. This matches scan-chart's getTimedTempos.
 */
export function buildTimedTempos(
  tempos: TempoInput[],
  resolution: number,
): TimedTempo[] {
  const timed: TimedTempo[] = [];

  for (let i = 0; i < tempos.length; i++) {
    if (i === 0) {
      timed.push({
        tick: tempos[0].tick,
        beatsPerMinute: tempos[0].beatsPerMinute,
        msTime: 0,
      });
    } else {
      const prev = timed[i - 1];
      const msTime =
        prev.msTime +
        ((tempos[i].tick - prev.tick) * 60000) /
          (prev.beatsPerMinute * resolution);
      timed.push({
        tick: tempos[i].tick,
        beatsPerMinute: tempos[i].beatsPerMinute,
        msTime,
      });
    }
  }

  return timed;
}

/**
 * Convert a millisecond timestamp to a tick position using the tempo map.
 *
 * Formula (inverse of scan-chart's setEventMsTimes):
 *   msTime = lastTempo.msTime + (tick - lastTempo.tick) * 60000 / (lastTempo.bpm * resolution)
 *
 * Solving for tick:
 *   tick = lastTempo.tick + (msTime - lastTempo.msTime) * lastTempo.bpm * resolution / 60000
 */
export function msToTick(
  msTime: number,
  timedTempos: TimedTempo[],
  resolution: number,
): number {
  // Find the active tempo at this msTime
  let tempoIndex = 0;
  for (let i = 1; i < timedTempos.length; i++) {
    if (timedTempos[i].msTime <= msTime) {
      tempoIndex = i;
    } else {
      break;
    }
  }

  const tempo = timedTempos[tempoIndex];
  const elapsedMs = msTime - tempo.msTime;
  const tickOffset = (elapsedMs * tempo.beatsPerMinute * resolution) / 60000;

  return Math.round(tempo.tick + tickOffset);
}

/**
 * Snap a tick to the nearest grid position.
 *
 * @param tick - The tick value to snap
 * @param resolution - Ticks per quarter note (e.g. 480)
 * @param gridDivision - Number of divisions per quarter note
 *   (e.g. 4 = 16th notes, 8 = 32nd notes)
 *
 * At resolution 480:
 *   1/4  note grid: gridDivision=1  -> gridSize=480
 *   1/8  note grid: gridDivision=2  -> gridSize=240
 *   1/16 note grid: gridDivision=4  -> gridSize=120
 *   1/32 note grid: gridDivision=8  -> gridSize=60
 *   1/48 (triplet 16th): gridDivision=12 -> gridSize=40
 *   1/64 note grid: gridDivision=16 -> gridSize=30
 */
export function snapToGrid(
  tick: number,
  resolution: number,
  gridDivision: number,
): number {
  const gridSize = resolution / gridDivision;
  return Math.round(tick / gridSize) * gridSize;
}
