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

export function addTempo(doc: ChartDocument, tick: number, beatsPerMinute: number): void {
  doc.parsedChart.tempos = doc.parsedChart.tempos.filter((t) => t.tick !== tick);
  doc.parsedChart.tempos.push({ tick, beatsPerMinute, msTime: 0 });
  doc.parsedChart.tempos.sort((a, b) => a.tick - b.tick);
}

export function removeTempo(doc: ChartDocument, tick: number): void {
  if (tick === 0) {
    throw new Error('Cannot remove the tempo at tick 0');
  }
  doc.parsedChart.tempos = doc.parsedChart.tempos.filter((t) => t.tick !== tick);
}

// ---------------------------------------------------------------------------
// Time Signature
// ---------------------------------------------------------------------------

export function addTimeSignature(
  doc: ChartDocument,
  tick: number,
  numerator: number,
  denominator: number,
): void {
  doc.parsedChart.timeSignatures = doc.parsedChart.timeSignatures.filter((ts) => ts.tick !== tick);
  doc.parsedChart.timeSignatures.push({ tick, numerator, denominator, msTime: 0, msLength: 0 });
  doc.parsedChart.timeSignatures.sort((a, b) => a.tick - b.tick);
}

export function removeTimeSignature(doc: ChartDocument, tick: number): void {
  if (tick === 0) {
    throw new Error('Cannot remove the time signature at tick 0');
  }
  doc.parsedChart.timeSignatures = doc.parsedChart.timeSignatures.filter((ts) => ts.tick !== tick);
}
