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
import type {
  LoadedFiles,
  SourceFormat,
} from '@/components/chart-picker/chart-file-readers';
import {readChart} from '@/lib/chart-edit';
import {
  assembleChartFiles,
  packageChartFiles,
  type PackageFormat,
} from '@/lib/chart-export';
import {downloadBlob} from '@/lib/download';
import {mergeGuitarTiersIntoChart} from '@/lib/guitar-difficulty/exportChart';
import type {ReducedGuitarTracks} from '@/lib/guitar-difficulty/reduce';

export default function ExportChartDialog({
  loaded,
  tracks,
}: {
  loaded: LoadedFiles;
  tracks: ReducedGuitarTracks;
}) {
  const [open, setOpen] = useState(false);
  const [packageFormat, setPackageFormat] = useState<PackageFormat>(
    packageFormatFor(loaded.sourceFormat),
  );
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(() => {
    setIsExporting(true);
    try {
      // Re-read the original package so export always starts from the source
      // document and its assets, not from a renderer-only representation.
      const chartDoc = readChart(loaded.files);
      const merged = mergeGuitarTiersIntoChart(chartDoc, tracks);
      const entries = assembleChartFiles({chartDoc: merged});
      const {blob, extension} = packageChartFiles(entries, packageFormat);

      downloadBlob(blob, `${loaded.originalName}.${extension}`);
      toast.success(
        `Chart exported with reduced Hard/Medium/Easy guitar tracks`,
      );
      setOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed';
      console.error('Guitar export error:', error);
      toast.error(message);
    } finally {
      setIsExporting(false);
    }
  }, [loaded, packageFormat, tracks]);

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
            Download the original chart with reduced Hard, Medium, and Easy
            guitar tracks added. The original .chart/.mid format and package
            assets are preserved.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-4 items-center gap-4 py-4">
          <label htmlFor="guitar-export-format" className="text-right text-sm">
            Package
          </label>
          <Select
            value={packageFormat}
            onValueChange={value => setPackageFormat(value as PackageFormat)}>
            <SelectTrigger className="col-span-3" id="guitar-export-format">
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

function packageFormatFor(sourceFormat: SourceFormat): PackageFormat {
  return sourceFormat === 'sng' ? 'sng' : 'zip';
}
