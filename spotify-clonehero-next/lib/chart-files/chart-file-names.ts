/**
 * The names a chart file has at rest, and how to derive its autosave
 * sibling.
 *
 * A chart file is `notes.chart` or `notes.mid`. The source chart sets the
 * format, and a project keeps that format for as long as it is stored: a
 * `.chart` file carries vocals as bare lyric text events, so a conversion
 * drops vocal note pitches, phrase lengths and harmony parts. A project
 * holds exactly one of the two names, never both. Export can convert, and
 * tells the user what the conversion costs.
 *
 * Do not write `notes.chart` directly. Get the name from this module. A
 * MIDI-sourced project has no `notes.chart`.
 */

/**
 * The format of the chart file inside a package — `.chart` (text) or `.mid`
 * (binary). Distinct from `SourceFormat`, which is the outer folder/zip/sng
 * container.
 */
export type ChartFileFormat = 'chart' | 'mid';

/** The name a chart file is stored under, per format. */
export const CHART_FILE_BASENAMES = {
  chart: 'notes.chart',
  mid: 'notes.mid',
} as const;

/**
 * Basename -> its "edited" (post-autosave) sibling, with the same extension.
 * `notes.chart` becomes `notes.edited.chart`, `notes.mid` becomes
 * `notes.edited.mid`. An autosave path derives the sibling name from
 * whichever chart file `writeChartFolder` produced, instead of hardcoding
 * `.chart`.
 */
export function editedVariant(baseName: string): string {
  const dot = baseName.lastIndexOf('.');
  if (dot < 0) {
    throw new Error(
      `"${baseName}" has no extension to insert ".edited" before`,
    );
  }
  return `${baseName.slice(0, dot)}.edited${baseName.slice(dot)}`;
}

/** Whether a file name is a chart file, in either format. */
export function isChartFileName(fileName: string): boolean {
  return chartFileFormatOf(fileName) !== null;
}

/**
 * The format a chart file name denotes. `null` for a name that is not a
 * chart file, so a caller can tell "not a chart" from "a chart in the other
 * format".
 *
 * `.midi` is not a chart file here. scan-chart reads and writes `notes.mid`
 * only, and `hasChartExtension` agrees. The export path canonicalizes a
 * user's `.midi` to `notes.mid` before anything stores it.
 */
export function chartFileFormatOf(fileName: string): ChartFileFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.mid')) return 'mid';
  if (lower.endsWith('.chart')) return 'chart';
  return null;
}
