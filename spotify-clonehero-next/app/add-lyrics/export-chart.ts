/**
 * Packaging for /add-lyrics' "Download" button.
 *
 * The doc handed in must be the chart editor's live document
 * (`state.chartDoc`) — the aligner seeds it, and every highway edit the user
 * makes (lyric drags, phrase resizes, text changes) is dispatched onto it.
 * Serializing anything else — the doc as loaded, or a snapshot captured when
 * the editor was prepared — silently drops the user's manual timing fixes.
 */

import type {ChartDocument} from '@/lib/chart-edit';
import {
  assembleChartFiles,
  packageChartFiles,
  type PackageFormat,
} from '@/lib/chart-export';
import type {SourceFormat} from '@/components/chart-picker/chart-file-readers';

export interface ChartExport {
  blob: Blob;
  fileName: string;
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
 * Assembles in round-trip mode (no `metadata`), so the chart's own identity
 * and ratings survive: this page edits somebody else's chart rather than
 * minting one. The name is likewise the user's own file name rather than
 * `chartPackageFileName`'s `Artist - Song (Charter)` convention — this is the
 * file they handed us, coming back with lyrics in it, and renaming it would
 * strip whatever organization their library already has.
 */
export function buildChartExport(
  doc: ChartDocument,
  sourceFormat: SourceFormat,
  originalName: string,
): ChartExport {
  const {blob, extension} = packageChartFiles(
    assembleChartFiles({chartDoc: doc}),
    packageFormatFor(sourceFormat),
  );

  return {blob, fileName: `${originalName}.${extension}`};
}
