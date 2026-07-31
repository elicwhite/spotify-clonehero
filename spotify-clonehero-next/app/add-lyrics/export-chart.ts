/**
 * Packaging for /add-lyrics' "Download" button.
 *
 * The doc handed in must be the chart editor's live document
 * (`state.chartDoc`) — the aligner seeds it, and every highway edit the user
 * makes (lyric drags, phrase resizes, text changes) is dispatched onto it.
 * Serializing anything else — the doc as loaded, or a snapshot captured when
 * the editor was prepared — silently drops the user's manual timing fixes.
 *
 * Deliberately not built on `assembleChartFiles`: that helper exists for
 * flows that MINT a chart (drum transcription, /difficulties), so it stamps
 * `pro_drums`/`diff_drums` and rewrites name/artist/charter/song_length from
 * caller-supplied metadata. This page round-trips somebody else's chart —
 * a guitar-only chart must not come back advertising rated pro drums — so it
 * writes the document as-is and reuses only the container step.
 */

import {writeChartFolder, type ChartDocument} from '@/lib/chart-edit';
import {packageChartFiles, type PackageFormat} from '@/lib/chart-export';
import type {SourceFormat} from '@/components/chart-picker/chart-file-readers';
import type {File as FileEntry} from '@eliwhite/scan-chart';

export interface ChartExport {
  blob: Blob;
  fileName: string;
}

/**
 * Serialize the chart document to the file list that goes into the package.
 *
 * `writeChartFolder` emits notes.{chart,mid} + song.ini + every asset from
 * `doc.assets` (audio stems, album art, etc.) and skips any chart-like file
 * in the asset list, so this covers the full export on its own.
 */
export function buildExportFiles(doc: ChartDocument): FileEntry[] {
  return writeChartFolder(doc).map(f => ({
    fileName: f.fileName,
    data: f.data,
  }));
}

/** The container a chart loaded from `sourceFormat` is handed back in. A
 *  `.sng` round-trips as `.sng`; folders and `.zip` both leave as `.zip`. */
function packageFormatFor(sourceFormat: SourceFormat): PackageFormat {
  return sourceFormat === 'sng' ? 'sng' : 'zip';
}

/**
 * Package the chart document in the format it was loaded from, keeping the
 * original name.
 *
 * The name is the user's own file name rather than `chartPackageFileName`'s
 * `Artist - Song (Charter)` convention: this is the file they handed us,
 * coming back with lyrics in it, and renaming it would strip whatever
 * organization their library already has.
 */
export function buildChartExport(
  doc: ChartDocument,
  sourceFormat: SourceFormat,
  originalName: string,
): ChartExport {
  const {blob, extension} = packageChartFiles(
    buildExportFiles(doc),
    packageFormatFor(sourceFormat),
  );

  return {blob, fileName: `${originalName}.${extension}`};
}
