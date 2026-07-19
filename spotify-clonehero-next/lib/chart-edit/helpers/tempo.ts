/**
 * Tempo and time signature helpers.
 *
 * Manages the tempos and timeSignatures arrays on a ChartDocument.
 * All mutations are in-place, and derived timing (msTime/msLength) is
 * kept correct: a tempo mutation retimes every event at/after its tick
 * (KEEP-TICKS semantics — notes keep their ticks and ride the new map;
 * the class-(a)/(b) note-handling ops of plan 0061 §3a layer on top of
 * this at the command level).
 *
 * BPM values are format-quantized at edit time (plan 0061 §2): the stored
 * BPM is always the exact value a write→parse round trip yields for the
 * document's format, so downstream ms never drifts on serialization.
 */

import type {ChartDocument} from '../types';
import {
  applyEventTiming,
  makeChartTiming,
  quantizeBpm,
  retimeChart,
} from '../retime';

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

export function addTempo(
  doc: ChartDocument,
  tick: number,
  beatsPerMinute: number,
): void {
  const chart = doc.parsedChart;
  const quantized = quantizeBpm(beatsPerMinute, chart.format ?? 'chart');
  chart.tempos = chart.tempos.filter(t => t.tick !== tick);
  chart.tempos.push({tick, beatsPerMinute: quantized, msTime: 0});
  chart.tempos.sort((a, b) => a.tick - b.tick);
  retimeChart(chart, tick);
}

export function removeTempo(doc: ChartDocument, tick: number): void {
  if (tick === 0) {
    throw new Error('Cannot remove the tempo at tick 0');
  }
  const chart = doc.parsedChart;
  chart.tempos = chart.tempos.filter(t => t.tick !== tick);
  retimeChart(chart, tick);
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
  const chart = doc.parsedChart;
  const timeSignature = {tick, numerator, denominator, msTime: 0, msLength: 0};
  applyEventTiming(timeSignature, makeChartTiming(chart));
  chart.timeSignatures = chart.timeSignatures.filter(ts => ts.tick !== tick);
  chart.timeSignatures.push(timeSignature);
  chart.timeSignatures.sort((a, b) => a.tick - b.tick);
}

export function removeTimeSignature(doc: ChartDocument, tick: number): void {
  if (tick === 0) {
    throw new Error('Cannot remove the time signature at tick 0');
  }
  doc.parsedChart.timeSignatures = doc.parsedChart.timeSignatures.filter(
    ts => ts.tick !== tick,
  );
}
