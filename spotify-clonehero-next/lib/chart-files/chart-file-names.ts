/**
 * The names a chart file has at rest, and how to derive its autosave
 * sibling. Both OPFS layouts store a chart under these names, so neither one
 * owns them.
 *
 * A chart is `.chart` or `.mid`, and which one it is belongs to the user, not
 * to the storage layer. Code that hardcodes `notes.chart` breaks a
 * MIDI-sourced project, so resolve the name from here instead.
 */

/** The extension a chart file is stored in. */
export type ChartFileFormat = 'chart' | 'mid';

/** The at-rest name of a chart file, per format. */
export const CHART_FILE_BASENAMES = {
  chart: 'notes.chart',
  mid: 'notes.mid',
} as const;

/**
 * Basename -> its "edited" (post-autosave) sibling, same extension —
 * `notes.chart` -> `notes.edited.chart`, `notes.mid` -> `notes.edited.mid`.
 * An autosave path derives the sibling name from whichever chart file
 * `writeChartFolder` produced, instead of hardcoding `.chart`.
 */
export function editedVariant(baseName: string): string {
  const dot = baseName.lastIndexOf('.');
  return `${baseName.slice(0, dot)}.edited${baseName.slice(dot)}`;
}

/** The at-rest name for a format, and its autosave sibling. */
export function chartFileNamesFor(format: ChartFileFormat): {
  original: string;
  edited: string;
} {
  const original = CHART_FILE_BASENAMES[format];
  return {original, edited: editedVariant(original)};
}

/**
 * The format a chart file name denotes. `null` for a name that is not a
 * chart file, so a caller can tell "not a chart" from "a chart in the other
 * format".
 */
export function chartFileFormatOf(fileName: string): ChartFileFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.mid') || lower.endsWith('.midi')) return 'mid';
  if (lower.endsWith('.chart')) return 'chart';
  return null;
}
