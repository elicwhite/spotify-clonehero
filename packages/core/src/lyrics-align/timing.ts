/**
 * Tick ↔ millisecond conversion for RawChartData tempos (beatsPerMinute).
 *
 * Same algorithm as lib/drum-transcription/chart-io/timing.ts, adapted
 * for scan-chart's { tick, beatsPerMinute } tempo shape.
 */

/** A tempo event with its pre-computed absolute millisecond time. */
export interface TimedTempo {
  tick: number;
  beatsPerMinute: number;
  msTime: number;
}

/**
 * Build a timed tempo map by computing the absolute msTime for each tempo.
 * Input tempos must be sorted by tick ascending.
 */
export function buildTimedTempoMap(
  tempos: {tick: number; beatsPerMinute: number}[],
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
 *   tick = tempo.tick + (msTime - tempo.msTime) * tempo.bpm * resolution / 60000
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
