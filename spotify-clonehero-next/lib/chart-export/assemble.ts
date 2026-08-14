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
import type {ChartFileFormat} from '@/lib/chart-files/chart-file-names';
import {DIFFICULTY_FIELDS, type DifficultyField} from '@/lib/chart-difficulty';

/** Metadata the user supplies (or confirms) at export time. */
export interface ChartPackageMetadata {
  /** Song title. */
  name: string;
  /** Artist name. */
  artist: string;
  /** Charter credit. Blank falls back to `MusicCharts.tools`. */
  charter: string;
  /** `song.ini`'s `album`. Omitted leaves whatever the document carried. */
  album?: string | undefined;
  /** `song.ini`'s `genre`. Omitted leaves whatever the document carried. */
  genre?: string | undefined;
  /** `song.ini`'s `year`. A string, per the ini spec — charts in the wild
   *  carry `2004`, `, 2004` and plain prose alike. */
  year?: string | undefined;
  /**
   * Per-instrument `diff_*` intensities on the 0-6 scale, keyed by canonical
   * `song.ini` field name. `-1` is the spec's "not set" sentinel and is
   * written through as-is; a field left out of this record keeps the
   * document's existing value.
   */
  difficulties?: Readonly<Partial<Record<DifficultyField, number>>> | undefined;
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

/** Options common to both assembly modes — see {@link AssembleChartFilesOptions}. */
interface ChartSourceOptions {
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
  /**
   * The format to write the chart file in, when it differs from the
   * document's own. Set by the export dialog's chart-file select.
   *
   * Applied here rather than by the caller pre-serializing, so a host can
   * offer the choice and still pass `chartDoc` — the only source that keeps
   * the fields `song.ini` alone carries.
   */
  chartFileFormat?: ChartFileFormat;
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
 * MINT mode: the caller is creating a chart (drum transcription).
 * Its name/artist/charter replace whatever the document
 * carried, the chart is declared `pro_drums` with a drums difficulty, and
 * `song_length` is (re)computed.
 */
interface MintedChartOptions extends ChartSourceOptions {
  metadata: ChartPackageMetadata;
  /**
   * Song length in milliseconds, stamped as `song.ini`'s `song_length`. Best
   * sourced from the actual (decoded) audio duration. Omitted, `undefined`,
   * or non-positive falls back to the chart's own last event time.
   */
  songLengthMs?: number;
}

/**
 * ROUND-TRIP mode: the caller is editing somebody else's chart and handing it
 * back (/add-lyrics). The document's own metadata ships untouched — a
 * guitar-only chart must not come back advertising rated pro drums, and the
 * original charter keeps their credit.
 *
 * `metadata` and `songLengthMs` are typed away rather than merely ignored, so
 * a caller that means to stamp can't half-configure it and silently ship an
 * unstamped chart.
 */
interface RoundTripChartOptions extends ChartSourceOptions {
  metadata?: undefined;
  songLengthMs?: undefined;
}

/** Assembly is either a mint or a round trip; the presence of `metadata`
 *  picks the mode. See {@link MintedChartOptions} / {@link RoundTripChartOptions}. */
export type AssembleChartFilesOptions =
  | MintedChartOptions
  | RoundTripChartOptions;

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
 * Apply a minting flow's identity + ratings to a chart's metadata, or hand
 * the chart back untouched when no metadata was supplied (round-trip export).
 *
 * Every field the caller did not name rides through verbatim, unrecognised
 * `song.ini` keys (`metadata.extraIniFields`) included, so a chart that
 * declared `icon`, `loading_phrase`, `album_track`, a keys difficulty or a
 * custom key comes back out declaring exactly the same thing.
 */
function stampMetadata(
  parsedChart: ParsedChart,
  metadata: ChartPackageMetadata | undefined,
  songLengthMs: number | undefined,
): ParsedChart {
  if (!metadata) return parsedChart;

  const existing = parsedChart.metadata;
  // The drum defaults below describe a drums arrangement, so they are only
  // applied to a chart that has one. Stamping them on a guitar-only chart
  // would advertise rated Pro Drums the package does not contain.
  const hasDrums = parsedChart.trackData.some(
    track => track.instrument === 'drums',
  );
  // Declare a drums difficulty so scan-chart / chart managers see a rated
  // chart. The chart file alone carries this; any diff_drums the pipeline
  // set in song.ini separately is gone by here; default to 0 when absent.
  const diffDrums =
    existing.diff_drums != null && existing.diff_drums >= 0
      ? existing.diff_drums
      : 0;
  // A five-lane chart is the one drum layout Pro Drums cannot describe, and
  // scan-chart rejects a chart declaring both.
  const drumDefaults =
    hasDrums && !existing.five_lane_drums
      ? {
          pro_drums: true,
          diff_drums: diffDrums,
          // Phase Shift "real drums" difficulty. The default mirrors
          // diff_drums: a four-lane Pro Drums chart declares the same
          // intensity in both, and `difficulties` below can still set them
          // apart if the user did.
          diff_drums_real: diffDrums,
        }
      : {};
  // Whatever the user set in the song-details editor is authoritative over
  // both the document's value and the `diff_drums` fallback above. Only the
  // fields actually present in the record are overwritten, so an unedited
  // instrument keeps whatever the chart already declared.
  const difficulties: Partial<Record<DifficultyField, number>> = {};
  for (const field of DIFFICULTY_FIELDS) {
    const value = metadata.difficulties?.[field];
    if (value !== undefined) difficulties[field] = value;
  }
  // Shallow-clone rather than mutate `parsedChart` in place — a
  // caller-supplied `chartDoc` (the `chartDoc` option) may be reused
  // elsewhere and shouldn't be silently modified by this call.
  return {
    ...parsedChart,
    metadata: {
      ...existing,
      name: metadata.name,
      artist: metadata.artist,
      charter: metadata.charter.trim() || 'MusicCharts.tools',
      ...(metadata.album !== undefined ? {album: metadata.album} : {}),
      ...(metadata.genre !== undefined ? {genre: metadata.genre} : {}),
      ...(metadata.year !== undefined ? {year: metadata.year} : {}),
      ...drumDefaults,
      ...difficulties,
      song_length:
        songLengthMs != null && songLengthMs > 0
          ? Math.round(songLengthMs)
          : chartEndMs(parsedChart),
    },
  };
}

/**
 * Assemble the flat file list for a chart package.
 *
 * Parses the chart (`chartText` as `.chart`, or `chartFile` in whichever
 * format it names), stamps `metadata` when the caller is minting a chart (see
 * the option's doc for the two modes), and runs it back through
 * `writeChartFolder` so the chart file and `song.ini` are regenerated
 * consistently — in the SAME format it was given (a `.mid`-sourced chart-flow
 * project stays `.mid`; `writeChartFolder` doesn't convert). Audio sources are
 * appended verbatim.
 */
export function assembleChartFiles({
  chartText,
  chartFile,
  chartDoc: suppliedChartDoc,
  chartFileFormat,
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
  const stamped: ParsedChart = stampMetadata(
    chartDoc.parsedChart,
    metadata,
    songLengthMs,
  );
  const stampedParsedChart: ParsedChart =
    chartFileFormat && chartFileFormat !== stamped.format
      ? {...stamped, format: chartFileFormat}
      : stamped;

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
 * convention `Artist - Song (Charter)`. Preserve punctuation and symbols from
 * the metadata; only remove characters that are unsafe in a cross-platform
 * file name.
 */
export function chartPackageFileName(
  metadata: ChartPackageMetadata,
  extension: string,
): string {
  const artist = metadata.artist.trim() || 'Unknown Artist';
  const song = metadata.name.trim() || 'Untitled';
  const charter = metadata.charter.trim() || 'MusicCharts.tools';
  const base = `${artist} - ${song} (${charter})`;
  return `${base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')}.${extension}`;
}
