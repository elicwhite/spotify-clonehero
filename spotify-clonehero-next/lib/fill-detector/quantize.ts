/**
 * Tick quantization utilities for grid-based analysis
 */

import {Config} from './types';

/**
 * Snaps a tick value to the nearest grid division
 *
 * @param tick - The tick value to quantize
 * @param resolution - Ticks per quarter note from chart
 * @param quantDiv - Quantization divisor (4 = 16th notes, 8 = 32nd notes)
 * @returns Quantized tick value
 */
export function quantizeTick(
  tick: number,
  resolution: number,
  quantDiv: number = 4,
): number {
  const quantUnit = resolution / quantDiv;
  return Math.round(tick / quantUnit) * quantUnit;
}

/**
 * Gets the quantization unit in ticks
 *
 * @param resolution - Ticks per quarter note from chart
 * @param quantDiv - Quantization divisor
 * @returns Number of ticks per quantization unit
 */
export function getQuantUnit(resolution: number, quantDiv: number = 4): number {
  return resolution / quantDiv;
}

/**
 * Quantizes an array of objects with tick properties
 *
 * @param items - Array of objects with tick property
 * @param resolution - Ticks per quarter note from chart
 * @param quantDiv - Quantization divisor
 * @returns Array with quantized tick values
 */
export function quantizeItems<T extends {tick: number}>(
  items: T[],
  resolution: number,
  quantDiv: number = 4,
): T[] {
  return items.map(item => ({
    ...item,
    tick: quantizeTick(item.tick, resolution, quantDiv),
  }));
}

/**
 * Creates a quantized grid of tick positions within a range
 *
 * @param startTick - Start of the range
 * @param endTick - End of the range (exclusive)
 * @param resolution - Ticks per quarter note from chart
 * @param quantDiv - Quantization divisor
 * @returns Array of quantized tick positions
 */
export function createQuantizedGrid(
  startTick: number,
  endTick: number,
  resolution: number,
  quantDiv: number = 4,
): number[] {
  const quantUnit = getQuantUnit(resolution, quantDiv);
  const startQuantized = quantizeTick(startTick, resolution, quantDiv);
  const grid: number[] = [];

  for (let tick = startQuantized; tick < endTick; tick += quantUnit) {
    grid.push(tick);
  }

  return grid;
}

/**
 * Gets the number of beats for a given tick duration
 *
 * @param tickDuration - Duration in ticks
 * @param resolution - Ticks per quarter note from chart
 * @returns Duration in beats (quarter notes)
 */
export function ticksToBeats(tickDuration: number, resolution: number): number {
  return tickDuration / resolution;
}

/**
 * Converts beats to ticks
 *
 * @param beats - Duration in beats (quarter notes)
 * @param resolution - Ticks per quarter note from chart
 * @returns Duration in ticks
 */
export function beatsToTicks(beats: number, resolution: number): number {
  return beats * resolution;
}

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
export function getWindowBoundaries(
  startTick: number,
  endTick: number,
  windowBeats: number,
  strideBeats: number,
  resolution: number,
): [number, number][] {
  const windowTicks = beatsToTicks(windowBeats, resolution);
  const strideTicks = beatsToTicks(strideBeats, resolution);
  const boundaries: [number, number][] = [];

  for (
    let windowStart = startTick;
    windowStart + windowTicks <= endTick;
    windowStart += strideTicks
  ) {
    boundaries.push([windowStart, windowStart + windowTicks]);
  }

  return boundaries;
}

/**
 * Snaps a tick to the nearest beat boundary
 *
 * @param tick - Tick to snap
 * @param resolution - Ticks per quarter note from chart
 * @returns Tick snapped to nearest beat
 */
export function snapToBeat(tick: number, resolution: number): number {
  return Math.round(tick / resolution) * resolution;
}

/**
 * Gets the beat position of a tick within a measure
 * Assumes 4/4 time signature
 *
 * @param tick - Tick position
 * @param resolution - Ticks per quarter note from chart
 * @returns Beat position (0-3.99...)
 */
export function getBeatInMeasure(tick: number, resolution: number): number {
  const beatsPerMeasure = 4;
  const ticksPerMeasure = resolution * beatsPerMeasure;
  const tickInMeasure = tick % ticksPerMeasure;
  return tickInMeasure / resolution;
}

/**
 * Checks if a tick falls on a strong beat (1 or 3 in 4/4 time)
 *
 * @param tick - Tick position
 * @param resolution - Ticks per quarter note from chart
 * @returns True if on strong beat
 */
export function isStrongBeat(tick: number, resolution: number): boolean {
  const beatInMeasure = getBeatInMeasure(tick, resolution);
  const beatNumber = Math.floor(beatInMeasure);
  return beatNumber === 0 || beatNumber === 2; // beats 1 and 3 (0-indexed)
}

/**
 * Checks if a tick falls on a downbeat (beat 1 of measure)
 *
 * @param tick - Tick position
 * @param resolution - Ticks per quarter note from chart
 * @returns True if on downbeat
 */
export function isDownbeat(tick: number, resolution: number): boolean {
  const beatsPerMeasure = 4;
  const ticksPerMeasure = resolution * beatsPerMeasure;
  return tick % ticksPerMeasure === 0;
}
