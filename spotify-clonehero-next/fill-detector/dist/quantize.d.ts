/**
 * Tick quantization utilities for grid-based analysis
 */
/**
 * Snaps a tick value to the nearest grid division
 *
 * @param tick - The tick value to quantize
 * @param resolution - Ticks per quarter note from chart
 * @param quantDiv - Quantization divisor (4 = 16th notes, 8 = 32nd notes)
 * @returns Quantized tick value
 */
export declare function quantizeTick(tick: number, resolution: number, quantDiv?: number): number;
/**
 * Gets the quantization unit in ticks
 *
 * @param resolution - Ticks per quarter note from chart
 * @param quantDiv - Quantization divisor
 * @returns Number of ticks per quantization unit
 */
export declare function getQuantUnit(resolution: number, quantDiv?: number): number;
/**
 * Quantizes an array of objects with tick properties
 *
 * @param items - Array of objects with tick property
 * @param resolution - Ticks per quarter note from chart
 * @param quantDiv - Quantization divisor
 * @returns Array with quantized tick values
 */
export declare function quantizeItems<T extends {
    tick: number;
}>(items: T[], resolution: number, quantDiv?: number): T[];
/**
 * Creates a quantized grid of tick positions within a range
 *
 * @param startTick - Start of the range
 * @param endTick - End of the range (exclusive)
 * @param resolution - Ticks per quarter note from chart
 * @param quantDiv - Quantization divisor
 * @returns Array of quantized tick positions
 */
export declare function createQuantizedGrid(startTick: number, endTick: number, resolution: number, quantDiv?: number): number[];
/**
 * Gets the number of beats for a given tick duration
 *
 * @param tickDuration - Duration in ticks
 * @param resolution - Ticks per quarter note from chart
 * @returns Duration in beats (quarter notes)
 */
export declare function ticksToBeats(tickDuration: number, resolution: number): number;
/**
 * Converts beats to ticks
 *
 * @param beats - Duration in beats (quarter notes)
 * @param resolution - Ticks per quarter note from chart
 * @returns Duration in ticks
 */
export declare function beatsToTicks(beats: number, resolution: number): number;
/**
 * Gets window boundaries for sliding window analysis
 *
 * @param startTick - Analysis start tick
 * @param endTick - Analysis end tick
 * @param windowBeats - Window size in beats
 * @param strideBeats - Stride size in beats
 * @param resolution - Ticks per quarter note from chart
 * @returns Array of [windowStart, windowEnd] tick pairs
 */
export declare function getWindowBoundaries(startTick: number, endTick: number, windowBeats: number, strideBeats: number, resolution: number): [number, number][];
/**
 * Snaps a tick to the nearest beat boundary
 *
 * @param tick - Tick to snap
 * @param resolution - Ticks per quarter note from chart
 * @returns Tick snapped to nearest beat
 */
export declare function snapToBeat(tick: number, resolution: number): number;
/**
 * Gets the beat position of a tick within a measure
 * Assumes 4/4 time signature
 *
 * @param tick - Tick position
 * @param resolution - Ticks per quarter note from chart
 * @returns Beat position (0-3.99...)
 */
export declare function getBeatInMeasure(tick: number, resolution: number): number;
/**
 * Checks if a tick falls on a strong beat (1 or 3 in 4/4 time)
 *
 * @param tick - Tick position
 * @param resolution - Ticks per quarter note from chart
 * @returns True if on strong beat
 */
export declare function isStrongBeat(tick: number, resolution: number): boolean;
/**
 * Checks if a tick falls on a downbeat (beat 1 of measure)
 *
 * @param tick - Tick position
 * @param resolution - Ticks per quarter note from chart
 * @returns True if on downbeat
 */
export declare function isDownbeat(tick: number, resolution: number): boolean;
//# sourceMappingURL=quantize.d.ts.map