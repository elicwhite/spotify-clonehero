/**
 * Section marker helpers.
 *
 * Manages named section markers (e.g. "Verse 1", "Chorus") on a
 * ChartDocument. All mutations are in-place.
 */

import type { ChartDocument } from '../types';

/**
 * Add or replace a section marker at the given tick.
 */
export function addSection(doc: ChartDocument, tick: number, name: string): void {
  doc.sections = doc.sections.filter((s) => s.tick !== tick);
  doc.sections.push({ tick, name });
  doc.sections.sort((a, b) => a.tick - b.tick);
}

/**
 * Remove the section marker at the given tick.
 */
export function removeSection(doc: ChartDocument, tick: number): void {
  doc.sections = doc.sections.filter((s) => s.tick !== tick);
}
