/**
 * Packaging for /add-lyrics' "Download" button.
 *
 * The doc handed in must be the chart editor's live document
 * (`state.chartDoc`) — the aligner seeds it, and every highway edit the user
 * makes (lyric drags, phrase resizes, text changes) is dispatched onto it.
 * Serializing anything else — the doc as loaded, or a snapshot captured when
 * the editor was prepared — silently drops the user's manual timing fixes.
 */

import {writeChartFolder, type ChartDocument} from '@/lib/chart-edit';
import {exportAsZip, exportAsSng} from '@/lib/chart-export';
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

/**
 * Package the chart document in the format it was loaded from, keeping the
 * original name. `.sng` sources round-trip as `.sng`; folders and `.zip`
 * sources both come back as `.zip`.
 */
export function buildChartExport(
  doc: ChartDocument,
  sourceFormat: SourceFormat,
  originalName: string,
): ChartExport {
  const files = buildExportFiles(doc);

  if (sourceFormat === 'sng') {
    const sngBytes = exportAsSng(files);
    return {
      blob: new Blob([sngBytes as Uint8Array<ArrayBuffer>], {
        type: 'application/octet-stream',
      }),
      fileName: `${originalName}.sng`,
    };
  }

  return {blob: exportAsZip(files), fileName: `${originalName}.zip`};
}
