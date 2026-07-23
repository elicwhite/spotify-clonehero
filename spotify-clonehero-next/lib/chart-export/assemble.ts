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

import type {
  ChartDocument,
  File as FileEntry,
  ParsedChart,
} from '@eliwhite/scan-chart';

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

/** A named audio source to include in the package. Callers normalize audio to
 * Opus before assembly (see {@link file://./transcode-audio.ts}), so these are
 * typically `drums.opus` / `song.opus`, but assembly appends the bytes
 * verbatim under whatever name it is given. */
export interface PackageAudioSource {
  /** File name in the output folder (e.g. `drums.opus`, `song.opus`). */
  fileName: string;
  /** Encoded audio bytes. */
  data: ArrayBuffer | Uint8Array;
}

/** The project's chart file verbatim — `notes.chart` (text) or `notes.mid`
 * (binary), whichever format the source chart used. `readChart` detects
 * format from `fileName`, so passing either is symmetric. The name is
 * canonicalized to `notes.chart` / `notes.mid` before parsing, so a
 * variant-named input (e.g. autosave's `notes.edited.chart`) is fine. */
export interface ChartPackageFile {
  fileName: string;
  data: Uint8Array;
}

/** True for a chart file (`.chart` / `.mid` / `.midi`) or `song.ini` — the
 * files this module regenerates authoritatively. Used both to canonicalize
 * the incoming chart name and to reject any passthrough that would shadow the
 * assembled chart (e.g. a stray `notes.edited.chart` in `extraAssets`). */
function isChartOrIniFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower === 'song.ini' || /\.(chart|mid|midi)$/.test(lower);
}

/** Canonical chart file name for a (possibly variant-named) input: `.mid` /
 * `.midi` map to `notes.mid` (binary), everything else to `notes.chart`. */
function canonicalChartFileName(fileName: string): string {
  return /\.(mid|midi)$/i.test(fileName) ? 'notes.mid' : 'notes.chart';
}

export interface AssembleChartFilesOptions {
  /**
   * Valid `.chart` text. Mutually exclusive with `chartFile`/`chartDoc` —
   * supply exactly one. Convenience for callers that only ever deal in
   * `.chart` format; `chartFile` is the format-agnostic alternative (needed
   * by the chart-flow feature, where the source chart may be `.mid`).
   */
  chartText?: string;
  /** The format-agnostic alternative to `chartText` — see
   * {@link ChartPackageFile}. */
  chartFile?: ChartPackageFile;
  /**
   * An already-parsed (and possibly modified — e.g. with generated tracks
   * merged into `trackData`) chart document, bypassing the internal parse
   * entirely. Mutually exclusive with `chartText`/`chartFile`. Prefer this
   * when the caller already holds a `ChartDocument` with the real,
   * ini-merged metadata (delay, genre, year, …) — `chartText`/`chartFile`
   * parse the chart file ALONE (no `song.ini`), so fields only `song.ini`
   * carries would be lost.
   */
  chartDoc?: ChartDocument;
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
  /**
   * Song length in milliseconds, stamped as `song.ini`'s `song_length`. Best
   * sourced from the actual (decoded) audio duration. Omitted, `undefined`,
   * or non-positive falls back to the chart's own last event time.
   */
  songLengthMs?: number;
}

/** The chart's own duration, in milliseconds: the latest point any note ends
 * or an end event fires, across every track. Used as the `song_length`
 * fallback when no audio duration is available. */
function chartEndMs(parsedChart: ParsedChart): number {
  let maxMs = 0;
  for (const track of parsedChart.trackData) {
    for (const group of track.noteEventGroups) {
      for (const note of group) {
        const end = note.msTime + note.msLength;
        if (end > maxMs) maxMs = end;
      }
    }
  }
  for (const end of parsedChart.endEvents) {
    if (end.msTime > maxMs) maxMs = end.msTime;
  }
  return Math.round(maxMs);
}

/**
 * Assemble the flat file list for a chart package.
 *
 * Parses the chart (`chartText` as `.chart`, or `chartFile` in whichever
 * format it names), stamps the supplied metadata (name/artist/charter, plus
 * `pro_drums`), and runs it back through `writeChartFolder` so the chart file
 * and `song.ini` are regenerated consistently — in the SAME format it was
 * given (a `.mid`-sourced chart-flow project stays `.mid`; `writeChartFolder`
 * doesn't convert). Audio sources are appended verbatim.
 */
export function assembleChartFiles({
  chartText,
  chartFile,
  chartDoc: suppliedChartDoc,
  metadata,
  audioSources = [],
  extraAssets = [],
  songLengthMs,
}: AssembleChartFilesOptions): FileEntry[] {
  const chartDoc: ChartDocument =
    suppliedChartDoc ??
    (() => {
      const rawInputFile: ChartPackageFile =
        chartFile ??
        (chartText !== undefined
          ? {
              fileName: 'notes.chart',
              data: new TextEncoder().encode(chartText),
            }
          : (() => {
              throw new Error(
                'assembleChartFiles requires chartText, chartFile, or chartDoc',
              );
            })());
      // Canonicalize the chart file name before parsing. Callers (e.g. the
      // editor's autosave) may hand us a variant name like
      // `notes.edited.chart`; parsing and re-emitting under that name would
      // ship a chart file Clone Hero won't recognize. `readChart` detects
      // format from the extension, so the canonical `notes.chart` /
      // `notes.mid` round-trips identically.
      const inputFile: ChartPackageFile = {
        fileName: canonicalChartFileName(rawInputFile.fileName),
        data: rawInputFile.data,
      };
      return readChart([inputFile]);
    })();
  const existing = chartDoc.parsedChart.metadata;
  // Declare a drums difficulty so scan-chart / chart managers see a rated
  // chart. The chart file alone carries this; any diff_drums the pipeline
  // set in song.ini separately is gone by here; default to 0 when absent.
  const diffDrums =
    existing.diff_drums != null && existing.diff_drums >= 0
      ? existing.diff_drums
      : 0;
  // Shallow-clone rather than mutate `chartDoc.parsedChart` in place — a
  // caller-supplied `chartDoc` (the `chartDoc` option) may be reused
  // elsewhere and shouldn't be silently modified by this call.
  const stampedParsedChart: ParsedChart = {
    ...chartDoc.parsedChart,
    metadata: {
      ...existing,
      name: metadata.name,
      artist: metadata.artist,
      charter: metadata.charter.trim() || 'MusicCharts.tools',
      pro_drums: true,
      diff_drums: diffDrums,
      // Phase Shift "real drums" difficulty — kept equal to diff_drums since
      // this pipeline doesn't distinguish a separate real-drums chart.
      diff_drums_real: diffDrums,
      song_length:
        songLengthMs != null && songLengthMs > 0
          ? Math.round(songLengthMs)
          : chartEndMs(chartDoc.parsedChart),
    },
  };

  const entries: FileEntry[] = writeChartFolder({
    parsedChart: stampedParsedChart,
    assets: chartDoc.assets,
  }).map(f => ({
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
    // The assembled chart + song.ini are authoritative. Reject any passthrough
    // that is itself a chart/ini file (e.g. a stray `notes.edited.chart`),
    // even under a name that wouldn't collide with the canonical output.
    if (isChartOrIniFileName(asset.fileName)) continue;
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
