/**
 * Section marker helpers.
 *
 * Manages named section markers (e.g. "Verse 1", "Chorus") on a
 * ChartDocument. All mutations are in-place.
 */

import type {ChartDocument} from '../types';
import {applyEventTiming, makeChartTiming} from '../retime';

export function addSection(
  doc: ChartDocument,
  tick: number,
  name: string,
): void {
  const chart = doc.parsedChart;
  const section = {tick, name, msTime: 0, msLength: 0};
  applyEventTiming(section, makeChartTiming(chart));
  chart.sections = chart.sections.filter(s => s.tick !== tick);
  chart.sections.push(section);
  chart.sections.sort((a, b) => a.tick - b.tick);
}

export function removeSection(doc: ChartDocument, tick: number): void {
  doc.parsedChart.sections = doc.parsedChart.sections.filter(
    s => s.tick !== tick,
  );
}
