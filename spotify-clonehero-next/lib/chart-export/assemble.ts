/**
 * Chart package assembly.
 *
 * Turns a `.chart` text string plus user-supplied metadata and audio stems
 * into the flat list of `{fileName, data}` entries that make up a Clone Hero
 * song folder (notes.chart + song.ini + audio). The result is what gets fed
 * into {@link exportAsZip} / {@link exportAsSng}.
 *
 * Kept as a pure, storage-agnostic function so it can be exercised directly in
 * tests (round-trip the output back through scan-chart to prove validity)
 * without going through the React export dialog.
 */

import type {File as FileEntry} from '@eliwhite/scan-chart';

import {readChart, writeChartFolder} from '@/lib/chart-edit';

/** Metadata the user supplies (or confirms) at export time. */
export interface ChartPackageMetadata {
  /** Song title. */
  name: string;
  /** Artist name. */
  artist: string;
  /** Charter credit. Blank falls back to `MusicCharts.tools`. */
  charter: string;
}

/** A named audio source to include in the package. */
export interface PackageAudioSource {
  /** File name in the output folder (e.g. `drums.wav`, `song.wav`). */
  fileName: string;
  /** WAV-encoded audio bytes. */
  data: ArrayBuffer | Uint8Array;
}

export interface AssembleChartFilesOptions {
  /** Valid `.chart` text. */
  chartText: string;
  /** Metadata to stamp into song.ini. */
  metadata: ChartPackageMetadata;
  /** Audio stems to bundle alongside the chart. */
  audioSources?: PackageAudioSource[];
  /**
   * Passthrough files to append verbatim (e.g. album art, video, secondary
   * audio) — typically assets recovered from an original chart package that
   * this export is round-tripping (chart-flow feature). Any entry whose
   * `fileName` collides with `notes.chart`/`song.ini` or an `audioSources`
   * entry is skipped, since those are already authoritative above.
   */
  extraAssets?: FileEntry[];
}

/**
 * Assemble the flat file list for a chart package.
 *
 * Parses `chartText`, stamps the supplied metadata (name/artist/charter, plus
 * `pro_drums`), and runs it back through `writeChartFolder` so both
 * `notes.chart` and `song.ini` are regenerated consistently. Audio sources are
 * appended verbatim.
 */
export function assembleChartFiles({
  chartText,
  metadata,
  audioSources = [],
  extraAssets = [],
}: AssembleChartFilesOptions): FileEntry[] {
  const chartBytes = new TextEncoder().encode(chartText);
  const chartDoc = readChart([{fileName: 'notes.chart', data: chartBytes}]);
  const existing = chartDoc.parsedChart.metadata;
  chartDoc.parsedChart.metadata = {
    ...existing,
    name: metadata.name,
    artist: metadata.artist,
    charter: metadata.charter.trim() || 'MusicCharts.tools',
    pro_drums: true,
    // Declare a drums difficulty so scan-chart / chart managers see a rated
    // chart. `getChartText` only carries notes.chart, so any diff_drums the
    // pipeline set in song.ini is gone by here; default to 0 when absent.
    diff_drums:
      existing.diff_drums != null && existing.diff_drums >= 0
        ? existing.diff_drums
        : 0,
  };

  const entries: FileEntry[] = writeChartFolder(chartDoc).map(f => ({
    fileName: f.fileName,
    data: f.data,
  }));

  for (const audio of audioSources) {
    entries.push({
      fileName: audio.fileName,
      data:
        audio.data instanceof Uint8Array
          ? audio.data
          : new Uint8Array(audio.data),
    });
  }

  const taken = new Set(entries.map(e => e.fileName.toLowerCase()));
  for (const asset of extraAssets) {
    if (taken.has(asset.fileName.toLowerCase())) continue;
    entries.push(asset);
    taken.add(asset.fileName.toLowerCase());
  }

  return entries;
}

/**
 * Build the download file name for a chart package following the Clone Hero
 * convention `Artist - Song (Charter)`, with characters unsafe for a file name
 * replaced by underscores.
 */
export function chartPackageFileName(
  metadata: ChartPackageMetadata,
  extension: string,
): string {
  const artist = metadata.artist.trim() || 'Unknown Artist';
  const song = metadata.name.trim() || 'Untitled';
  const charter = metadata.charter.trim() || 'MusicCharts.tools';
  const base = `${artist} - ${song} (${charter})`;
  return `${base.replace(/[^a-zA-Z0-9 _().-]/g, '_')}.${extension}`;
}
