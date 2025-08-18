/**
 * Utilities for converting between ticks and milliseconds with tempo changes
 */

import {TempoEvent} from '../types';

/**
 * Converts a tick position to milliseconds using tempo map
 *
 * @param tick - Tick position to convert
 * @param tempos - Array of tempo events sorted by tick
 * @param resolution - Ticks per quarter note from chart
 * @returns Time in milliseconds
 */
export function tickToMs(
  tick: number,
  tempos: TempoEvent[],
  resolution: number,
): number {
  if (tempos.length === 0) {
    throw new Error('No tempo events provided');
  }

  // Sort tempos by tick to ensure correct order
  const sortedTempos = [...tempos].sort((a, b) => a.tick - b.tick);

  // Find the last tempo event at or before the target tick
  let currentTempo = sortedTempos[0];
  for (const tempo of sortedTempos) {
    if (tempo.tick <= tick) {
      currentTempo = tempo;
    } else {
      break;
    }
  }

  // If tick is at or before the first tempo event, use its msTime
  if (tick <= currentTempo.tick) {
    if (currentTempo.tick === 0) {
      return 0;
    }
    // Calculate backwards from first tempo event
    const tickDelta = currentTempo.tick - tick;
    const msDelta = ticksToMsDuration(
      tickDelta,
      currentTempo.beatsPerMinute,
      resolution,
    );
    return Math.max(0, currentTempo.msTime - msDelta);
  }

  // Calculate time from current tempo event to target tick
  const tickDelta = tick - currentTempo.tick;
  const msDelta = ticksToMsDuration(
    tickDelta,
    currentTempo.beatsPerMinute,
    resolution,
  );

  return currentTempo.msTime + msDelta;
}

/**
 * Converts a duration in ticks to milliseconds at a specific BPM
 *
 * @param ticks - Duration in ticks
 * @param bpm - Beats per minute
 * @param resolution - Ticks per quarter note from chart
 * @returns Duration in milliseconds
 */
export function ticksToMsDuration(
  ticks: number,
  bpm: number,
  resolution: number,
): number {
  // Convert ticks to quarter notes (beats)
  const beats = ticks / resolution;

  // Convert beats to milliseconds
  // 1 beat = 60000ms / BPM
  const msPerBeat = 60000 / bpm;

  return beats * msPerBeat;
}

/**
 * Converts milliseconds to ticks at a specific BPM
 *
 * @param ms - Time in milliseconds
 * @param bpm - Beats per minute
 * @param resolution - Ticks per quarter note from chart
 * @returns Duration in ticks
 */
export function msToDurationTicks(
  ms: number,
  bpm: number,
  resolution: number,
): number {
  const msPerBeat = 60000 / bpm;
  const beats = ms / msPerBeat;
  return beats * resolution;
}

/**
 * Finds the tempo at a specific tick position
 *
 * @param tick - Tick position
 * @param tempos - Array of tempo events sorted by tick
 * @returns Tempo event active at the given tick
 */
export function getTempoAtTick(tick: number, tempos: TempoEvent[]): TempoEvent {
  if (tempos.length === 0) {
    throw new Error('No tempo events provided');
  }

  const sortedTempos = [...tempos].sort((a, b) => a.tick - b.tick);

  let currentTempo = sortedTempos[0];
  for (const tempo of sortedTempos) {
    if (tempo.tick <= tick) {
      currentTempo = tempo;
    } else {
      break;
    }
  }

  return currentTempo;
}

/**
 * Gets the BPM at a specific tick position
 *
 * @param tick - Tick position
 * @param tempos - Array of tempo events
 * @returns BPM value at the given tick
 */
export function getBpmAtTick(tick: number, tempos: TempoEvent[]): number {
  return getTempoAtTick(tick, tempos).beatsPerMinute;
}

/**
 * Converts a range of ticks to start/end milliseconds
 *
 * @param startTick - Start tick
 * @param endTick - End tick
 * @param tempos - Array of tempo events
 * @param resolution - Ticks per quarter note from chart
 * @returns Object with startMs and endMs
 */
export function tickRangeToMs(
  startTick: number,
  endTick: number,
  tempos: TempoEvent[],
  resolution: number,
): {startMs: number; endMs: number} {
  return {
    startMs: tickToMs(startTick, tempos, resolution),
    endMs: tickToMs(endTick, tempos, resolution),
  };
}

/**
 * Calculates the duration in milliseconds for a tick range
 *
 * @param startTick - Start tick
 * @param endTick - End tick
 * @param tempos - Array of tempo events
 * @param resolution - Ticks per quarter note from chart
 * @returns Duration in milliseconds
 */
export function getTickRangeDurationMs(
  startTick: number,
  endTick: number,
  tempos: TempoEvent[],
  resolution: number,
): number {
  const {startMs, endMs} = tickRangeToMs(
    startTick,
    endTick,
    tempos,
    resolution,
  );
  return endMs - startMs;
}

/**
 * Creates a tempo map with pre-calculated ms times for faster lookups
 * This is useful when doing many tick-to-ms conversions
 *
 * @param tempos - Array of tempo events
 * @param resolution - Ticks per quarter note from chart
 * @returns Array of tempo events with accurate msTime values
 */
export function buildTempoMap(
  tempos: TempoEvent[],
  resolution: number,
): TempoEvent[] {
  if (tempos.length === 0) {
    return [];
  }

  const sortedTempos = [...tempos].sort((a, b) => a.tick - b.tick);
  const tempoMap: TempoEvent[] = [];

  // First tempo event - use its msTime as-is (should be 0 or start time)
  tempoMap.push({...sortedTempos[0]});

  // Calculate accurate msTime for subsequent tempo events
  for (let i = 1; i < sortedTempos.length; i++) {
    const prevTempo = tempoMap[i - 1];
    const currentTempo = sortedTempos[i];

    const tickDelta = currentTempo.tick - prevTempo.tick;
    const msDelta = ticksToMsDuration(
      tickDelta,
      prevTempo.beatsPerMinute,
      resolution,
    );

    tempoMap.push({
      ...currentTempo,
      msTime: prevTempo.msTime + msDelta,
    });
  }

  return tempoMap;
}

/**
 * Validates that tempo events are properly formatted
 *
 * @param tempos - Array of tempo events to validate
 * @throws Error if validation fails
 */
export function validateTempos(tempos: TempoEvent[]): void {
  if (!Array.isArray(tempos)) {
    throw new Error('Tempos must be an array');
  }

  if (tempos.length === 0) {
    throw new Error('At least one tempo event is required');
  }

  for (let i = 0; i < tempos.length; i++) {
    const tempo = tempos[i];

    if (typeof tempo.tick !== 'number' || tempo.tick < 0) {
      throw new Error(`Invalid tick at tempo event ${i}: ${tempo.tick}`);
    }

    if (typeof tempo.beatsPerMinute !== 'number' || tempo.beatsPerMinute <= 0) {
      throw new Error(
        `Invalid BPM at tempo event ${i}: ${tempo.beatsPerMinute}`,
      );
    }

    if (typeof tempo.msTime !== 'number' || tempo.msTime < 0) {
      throw new Error(`Invalid msTime at tempo event ${i}: ${tempo.msTime}`);
    }
  }

  // Check for duplicate ticks
  const ticks = tempos.map(t => t.tick);
  const uniqueTicks = new Set(ticks);
  if (uniqueTicks.size !== ticks.length) {
    throw new Error('Duplicate tempo events at same tick position');
  }
}
