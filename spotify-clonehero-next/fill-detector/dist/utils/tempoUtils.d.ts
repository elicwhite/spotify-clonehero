/**
 * Utilities for converting between ticks and milliseconds with tempo changes
 */
import { TempoEvent } from '../types.js';
/**
 * Converts a tick position to milliseconds using tempo map
 *
 * @param tick - Tick position to convert
 * @param tempos - Array of tempo events sorted by tick
 * @param resolution - Ticks per quarter note from chart
 * @returns Time in milliseconds
 */
export declare function tickToMs(tick: number, tempos: TempoEvent[], resolution: number): number;
/**
 * Converts a duration in ticks to milliseconds at a specific BPM
 *
 * @param ticks - Duration in ticks
 * @param bpm - Beats per minute
 * @param resolution - Ticks per quarter note from chart
 * @returns Duration in milliseconds
 */
export declare function ticksToMsDuration(ticks: number, bpm: number, resolution: number): number;
/**
 * Converts milliseconds to ticks at a specific BPM
 *
 * @param ms - Time in milliseconds
 * @param bpm - Beats per minute
 * @param resolution - Ticks per quarter note from chart
 * @returns Duration in ticks
 */
export declare function msToDurationTicks(ms: number, bpm: number, resolution: number): number;
/**
 * Finds the tempo at a specific tick position
 *
 * @param tick - Tick position
 * @param tempos - Array of tempo events sorted by tick
 * @returns Tempo event active at the given tick
 */
export declare function getTempoAtTick(tick: number, tempos: TempoEvent[]): TempoEvent;
/**
 * Gets the BPM at a specific tick position
 *
 * @param tick - Tick position
 * @param tempos - Array of tempo events
 * @returns BPM value at the given tick
 */
export declare function getBpmAtTick(tick: number, tempos: TempoEvent[]): number;
/**
 * Converts a range of ticks to start/end milliseconds
 *
 * @param startTick - Start tick
 * @param endTick - End tick
 * @param tempos - Array of tempo events
 * @param resolution - Ticks per quarter note from chart
 * @returns Object with startMs and endMs
 */
export declare function tickRangeToMs(startTick: number, endTick: number, tempos: TempoEvent[], resolution: number): {
    startMs: number;
    endMs: number;
};
/**
 * Calculates the duration in milliseconds for a tick range
 *
 * @param startTick - Start tick
 * @param endTick - End tick
 * @param tempos - Array of tempo events
 * @param resolution - Ticks per quarter note from chart
 * @returns Duration in milliseconds
 */
export declare function getTickRangeDurationMs(startTick: number, endTick: number, tempos: TempoEvent[], resolution: number): number;
/**
 * Creates a tempo map with pre-calculated ms times for faster lookups
 * This is useful when doing many tick-to-ms conversions
 *
 * @param tempos - Array of tempo events
 * @param resolution - Ticks per quarter note from chart
 * @returns Array of tempo events with accurate msTime values
 */
export declare function buildTempoMap(tempos: TempoEvent[], resolution: number): TempoEvent[];
/**
 * Validates that tempo events are properly formatted
 *
 * @param tempos - Array of tempo events to validate
 * @throws Error if validation fails
 */
export declare function validateTempos(tempos: TempoEvent[]): void;
//# sourceMappingURL=tempoUtils.d.ts.map