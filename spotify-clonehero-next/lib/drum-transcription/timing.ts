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
 * Convert a tick position to a millisecond timestamp using the tempo map.
 *
 * Formula (from scan-chart's setEventMsTimes):
 *   msTime = lastTempo.msTime + (tick - lastTempo.tick) * 60000 / (lastTempo.bpm * resolution)
 */
export function tickToMs(
  tick: number,
  timedTempos: TimedTempo[],
  resolution: number,
): number {
  // Find the active tempo at this tick
  let tempoIndex = 0;
  for (let i = 1; i < timedTempos.length; i++) {
    if (timedTempos[i].tick <= tick) {
      tempoIndex = i;
    } else {
      break;
    }
  }

  const tempo = timedTempos[tempoIndex];
  return (
    tempo.msTime +
    ((tick - tempo.tick) * 60000) / (tempo.beatsPerMinute * resolution)
  );
}

// ---------------------------------------------------------------------------
// Time signature type used by grid navigation
// ---------------------------------------------------------------------------

interface TimeSignatureInput {
  tick: number;
  numerator: number;
  denominator: number;
}

// ---------------------------------------------------------------------------
// Grid navigation utilities
// ---------------------------------------------------------------------------

/**
 * Move the cursor by one grid step in the given direction.
 *
 * Grid step in ticks:
 *   gridDivision=4 (1/16th) at resolution=480 -> stepTicks = 480/4 = 120
 *   gridDivision=0 (free) -> move by 1 tick
 *
 * @param currentTick - Current cursor position in ticks
 * @param direction - 1 = forward (later in song), -1 = backward
 * @param gridDivision - Number of divisions per quarter note (0 = free)
 * @param resolution - Ticks per quarter note (e.g. 480)
 * @returns The new cursor tick position (clamped to >= 0)
 */
export function getNextGridTick(
  currentTick: number,
  direction: 1 | -1,
  gridDivision: number,
  resolution: number,
): number {
  if (gridDivision === 0) {
    return Math.max(0, currentTick + direction);
  }

  const stepTicks = resolution / gridDivision;

  if (direction > 0) {
    // Forward: next grid line after current position
    const snapped = snapToGrid(currentTick, resolution, gridDivision);
    // If we're on or past a grid line, go to next one
    if (snapped <= currentTick) {
      return snapped + stepTicks;
    }
    return snapped;
  } else {
    // Backward: previous grid line before current position
    const snapped = snapToGrid(currentTick, resolution, gridDivision);
    if (snapped >= currentTick && currentTick > 0) {
      // On a grid line or snapped forward, go back one step
      return Math.max(0, snapped - stepTicks);
    }
    // Between grid lines, snap to the grid line behind us
    return Math.max(0, snapped);
  }
}

/**
 * Move the cursor by one measure in the given direction.
 *
 * A measure's length depends on the time signature:
 *   4/4 at resolution=480 -> 4 * 480 = 1920 ticks per measure
 *   3/4 at resolution=480 -> 3 * 480 = 1440 ticks per measure
 *   6/8 at resolution=480 -> 6 * (480/2) = 1440 ticks per measure
 *
 * The denominator scales the beat length: denominator=4 means quarter note beats,
 * denominator=8 means eighth note beats, etc.
 *
 * @param currentTick - Current cursor position in ticks
 * @param direction - 1 = forward, -1 = backward
 * @param resolution - Ticks per quarter note (e.g. 480)
 * @param timeSignatures - Sorted array of time signature events
 * @returns The new cursor tick position at the next/previous measure boundary
 */
export function getNextMeasureTick(
  currentTick: number,
  direction: 1 | -1,
  resolution: number,
  timeSignatures: TimeSignatureInput[],
): number {
  if (timeSignatures.length === 0) {
    // Default to 4/4
    const measureTicks = 4 * resolution;
    if (direction > 0) {
      const measureIndex = Math.floor(currentTick / measureTicks);
      return (measureIndex + 1) * measureTicks;
    } else {
      const measureIndex = Math.ceil(currentTick / measureTicks);
      return Math.max(0, (measureIndex - 1) * measureTicks);
    }
  }

  // Build a list of measure boundaries by walking through time signatures
  // We'll find the current measure boundary and then step forward/backward

  // Find the active time signature at currentTick
  let activeTs = timeSignatures[0];
  let activeTsIndex = 0;
  for (let i = 1; i < timeSignatures.length; i++) {
    if (timeSignatures[i].tick <= currentTick) {
      activeTs = timeSignatures[i];
      activeTsIndex = i;
    } else {
      break;
    }
  }

  // Measure length for the active time signature
  // Beat length = resolution * (4 / denominator)
  // Measure length = numerator * beat length
  const beatTicks = resolution * (4 / activeTs.denominator);
  const measureTicks = activeTs.numerator * beatTicks;

  // Distance from the time signature start to current tick
  const ticksSinceTsStart = currentTick - activeTs.tick;
  const measureInTs = Math.floor(ticksSinceTsStart / measureTicks);

  if (direction > 0) {
    // Next measure boundary
    const nextMeasureInTs = (measureInTs + 1) * measureTicks + activeTs.tick;

    // Check if there's a time signature change before the next measure
    const nextTsIndex = activeTsIndex + 1;
    if (nextTsIndex < timeSignatures.length) {
      const nextTs = timeSignatures[nextTsIndex];
      if (nextTs.tick <= nextMeasureInTs) {
        // The next time signature starts before our computed measure boundary
        // Jump to the next time signature's tick (which is a measure boundary)
        return nextTs.tick;
      }
    }

    return nextMeasureInTs;
  } else {
    // Previous measure boundary
    if (measureInTs > 0) {
      // There's a previous measure in this time signature
      const prevMeasureTick = (measureInTs) * measureTicks + activeTs.tick;
      // If we're exactly on a measure boundary, go one more back
      if (prevMeasureTick >= currentTick) {
        const evenEarlier = (measureInTs - 1) * measureTicks + activeTs.tick;
        return Math.max(0, evenEarlier);
      }
      return Math.max(0, prevMeasureTick);
    } else {
      // We're in the first measure of this time signature
      if (currentTick > activeTs.tick) {
        // Go to the start of this time signature
        return activeTs.tick;
      }
      // We're at the start of this TS, go to previous TS
      if (activeTsIndex > 0) {
        const prevTs = timeSignatures[activeTsIndex - 1];
        const prevBeatTicks = resolution * (4 / prevTs.denominator);
        const prevMeasureTicks = prevTs.numerator * prevBeatTicks;
        const ticksInPrevTs = activeTs.tick - prevTs.tick;
        const measuresInPrevTs = Math.floor(ticksInPrevTs / prevMeasureTicks);
        if (measuresInPrevTs > 0) {
          return prevTs.tick + (measuresInPrevTs - 1) * prevMeasureTicks;
        }
        return Math.max(0, prevTs.tick);
      }
      return 0;
    }
  }
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
