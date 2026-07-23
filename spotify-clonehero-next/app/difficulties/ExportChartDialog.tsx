'use client';

import {useCallback, useState} from 'react';
import {Download, Loader2} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {LoadedFiles} from '@/components/chart-picker/chart-file-readers';
import {readChart} from '@/lib/chart-edit';
import {
  assembleChartFiles,
  chartPackageFileName,
  exportAsSng,
  exportAsZip,
} from '@/lib/chart-export';
import {downloadBlob} from '@/lib/download';
import {mergeOursTiersIntoChart} from '@/lib/drum-difficulty/exportChart';
import type {Tier} from '@/lib/drum-difficulty/toRenderableTrack';
import type {Track} from '@/lib/preview/highway/types';

type PackageFormat = 'zip' | 'sng';

export interface ExportChartDialogProps {
  /** The originally-uploaded files, re-read fresh at export time so the
   * exported chart carries the real, `song.ini`-merged metadata (delay,
   * genre, year, …) rather than a chart-file-only reconstruction. */
  loaded: LoadedFiles;
  /** Ours' three renderable tracks, ready to merge in as the exported
   * chart's Hard/Medium/Easy drums. */
  oursTracks: Record<Tier, Track>;
}

/**
 * "Export" button + a minimal dialog (package format only — no metadata
 * editing) that downloads the uploaded chart with Ours' computed Hard/
 * Medium/Easy drums tracks merged in, so it can be played in Clone Hero
 * with real reduced difficulties instead of Expert-only. Always exports
 * Ours' output — HOPCAT/Onyx are comparison-only on this page.
 */
export default function ExportChartDialog({
  loaded,
  oursTracks,
}: ExportChartDialogProps) {
  const [open, setOpen] = useState(false);
  const [packageFormat, setPackageFormat] = useState<PackageFormat>('zip');
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(() => {
    setIsExporting(true);
    try {
      const chartDoc = readChart(loaded.files, {pro_drums: true});
      const merged = mergeOursTiersIntoChart(chartDoc, oursTracks);
      const metadata = chartDoc.parsedChart.metadata;
      const cleanMetadata = {
        name: metadata.name ?? '',
        artist: metadata.artist ?? '',
        charter: metadata.charter ?? '',
      };

      const fileEntries = assembleChartFiles({
        chartDoc: merged,
        metadata: cleanMetadata,
        ...(metadata.song_length != null
          ? {songLengthMs: metadata.song_length}
          : {}),
      });

      let blob: Blob;
      let extension: string;
      if (packageFormat === 'sng') {
        const sngBytes = exportAsSng(fileEntries);
        blob = new Blob([sngBytes as Uint8Array<ArrayBuffer>], {
          type: 'application/octet-stream',
        });
        extension = 'sng';
      } else {
        blob = exportAsZip(fileEntries);
        extension = 'zip';
      }

      downloadBlob(blob, chartPackageFileName(cleanMetadata, extension));
      toast.success('Chart exported with Ours’ Hard/Medium/Easy tracks');
      setOpen(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Export failed';
      console.error('Export error:', e);
      toast.error(message);
    } finally {
      setIsExporting(false);
    }
  }, [loaded, oursTracks, packageFormat]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export Chart</DialogTitle>
          <DialogDescription>
            Download the uploaded chart with Ours&rsquo; Hard/Medium/Easy drum
            reductions added, ready to play in Clone Hero.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-4 items-center gap-4 py-4">
          <label htmlFor="export-format" className="text-right text-sm">
            Package
          </label>
          <Select
            value={packageFormat}
            onValueChange={v => setPackageFormat(v as PackageFormat)}>
            <SelectTrigger className="col-span-3" id="export-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zip">ZIP (standard)</SelectItem>
              <SelectItem value="sng">SNG (Clone Hero / YARG)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="mr-1 h-4 w-4" />
                Download .{packageFormat}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
