/**
 * Tempo and time signature helpers.
 *
 * Manages the tempos and timeSignatures arrays on a ChartDocument.
 * All mutations are in-place.
 */

import type { ChartDocument } from '../types';

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

/**
 * Add or replace a tempo marker at the given tick.
 */
export function addTempo(doc: ChartDocument, tick: number, beatsPerMinute: number): void {
  // Remove any existing tempo at this tick
  doc.tempos = doc.tempos.filter((t) => t.tick !== tick);
  doc.tempos.push({ tick, beatsPerMinute });
  doc.tempos.sort((a, b) => a.tick - b.tick);
}

/**
 * Remove the tempo marker at the given tick.
 *
 * Throws if attempting to remove the tempo at tick 0 (there must always
 * be an initial tempo).
 */
export function removeTempo(doc: ChartDocument, tick: number): void {
  if (tick === 0) {
    throw new Error('Cannot remove the tempo at tick 0');
  }
  doc.tempos = doc.tempos.filter((t) => t.tick !== tick);
}

// ---------------------------------------------------------------------------
// Time Signature
// ---------------------------------------------------------------------------

/**
 * Add or replace a time signature at the given tick.
 */
export function addTimeSignature(
  doc: ChartDocument,
  tick: number,
  numerator: number,
  denominator: number,
): void {
  doc.timeSignatures = doc.timeSignatures.filter((ts) => ts.tick !== tick);
  doc.timeSignatures.push({ tick, numerator, denominator });
  doc.timeSignatures.sort((a, b) => a.tick - b.tick);
}

/**
 * Remove the time signature at the given tick.
 *
 * Throws if attempting to remove the time signature at tick 0 (there must
 * always be an initial time signature).
 */
export function removeTimeSignature(doc: ChartDocument, tick: number): void {
  if (tick === 0) {
    throw new Error('Cannot remove the time signature at tick 0');
  }
  doc.timeSignatures = doc.timeSignatures.filter((ts) => ts.tick !== tick);
}
