/**
 * Turn a canonical groove fingerprint into per-cell voice lists for rendering a
 * small single-bar VexFlow stave on groove cards. Pure + deterministic.
 *
 * Builds on `buildGrooveSketch` (which folds the 48/bar fingerprint onto a
 * 16th-note grid). If no onset lands on an odd 16th (i.e. the groove is purely
 * 8th-note based) the grid is collapsed to 8 cells so straight grooves render
 * as cleaner eighth-note notation.
 */

import {buildGrooveSketch} from './rhythmSketch';

export type StaveVoice = 'kick' | 'snare' | 'hat' | 'tom' | 'crash';

export interface GrooveStaveData {
  /** 0 (empty), 8, or 16. */
  cellsPerBar: number;
  /** One entry per cell; the voices struck on that cell (empty = rest). */
  cells: StaveVoice[][];
}

export function grooveStaveCells(fingerprint: string): GrooveStaveData {
  const sketch = buildGrooveSketch(fingerprint);
  if (sketch.lanes.length === 0) return {cellsPerBar: 0, cells: []};

  const cols = sketch.columns; // 16
  const perCell: StaveVoice[][] = Array.from({length: cols}, () => []);
  for (const lane of sketch.lanes) {
    lane.cells.forEach((on, i) => {
      if (on) perCell[i].push(lane.voice as StaveVoice);
    });
  }

  // Collapse to an 8th-note grid when nothing falls on an odd 16th.
  const onOddCell = perCell.some((vs, i) => vs.length > 0 && i % 2 === 1);
  if (!onOddCell) {
    const eighths = Array.from({length: cols / 2}, (_, i) => perCell[i * 2]);
    return {cellsPerBar: eighths.length, cells: eighths};
  }
  return {cellsPerBar: cols, cells: perCell};
}
