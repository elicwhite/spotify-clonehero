/**
 * Section marker helpers.
 *
 * Manages named section markers (e.g. "Verse 1", "Chorus") on a
 * ChartDocument. All mutations are in-place.
 */

import type {ChartDocument} from '../types';

export function addSection(
  doc: ChartDocument,
  tick: number,
  name: string,
): void {
  doc.parsedChart.sections = doc.parsedChart.sections.filter(
    s => s.tick !== tick,
  );
  doc.parsedChart.sections.push({tick, name, msTime: 0, msLength: 0});
  doc.parsedChart.sections.sort((a, b) => a.tick - b.tick);
}

export function removeSection(doc: ChartDocument, tick: number): void {
  doc.parsedChart.sections = doc.parsedChart.sections.filter(
    s => s.tick !== tick,
  );
}
