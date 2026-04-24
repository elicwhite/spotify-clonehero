'use client';

import {useState, useCallback} from 'react';
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
import {Label} from '@/components/ui/label';
import {Switch} from '@/components/ui/switch';

import {readChart, writeChartFolder} from '@/lib/chart-edit';
import {exportAsZip, exportAsSng} from '@/lib/chart-export';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A named audio source for export packaging. */
export interface AudioSource {
  /** File name in the output package (e.g. 'drums.wav', 'song.wav'). */
  fileName: string;
  /** Raw audio data (WAV-encoded). */
  data: ArrayBuffer;
}

interface ExportDialogProps {
  /** Song name for display and metadata. */
  songName: string;
  /** Artist name for metadata. */
  artistName?: string;
  /**
   * Provides the chart text to export. Must return a valid .chart string.
   * This decouples the dialog from any specific storage backend.
   */
  getChartText: () => Promise<string>;
  /**
   * Provides audio sources to include in the package.
   * Returns an array of AudioSource objects with named WAV data.
   */
  getAudioSources?: () => Promise<AudioSource[]>;
  /** Whether to show stem inclusion toggles (default: true if getAudioSources is provided). */
  showStemToggles?: boolean;
}

type PackageFormat = 'zip' | 'sng';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Export dialog for downloading the chart as a .zip or .sng package.
 *
 * Allows the user to select package format (ZIP or SNG) and
 * triggers a browser download with the packaged chart and audio.
 *
 * Chart and audio data are provided via callback props, making
 * this component independent of any storage backend.
 */
export default function ExportDialog({
  songName,
  artistName,
  getChartText,
  getAudioSources,
  showStemToggles = true,
}: ExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [packageFormat, setPackageFormat] = useState<PackageFormat>('zip');
  const [includeDrumStem, setIncludeDrumStem] = useState(true);
  const [includeAccompaniment, setIncludeAccompaniment] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      // 1. Get the chart text
      const chartText = await getChartText();

      // 2. Parse chart into a ChartDocument, set metadata, and use
      //    writeChartFolder to produce both notes.chart and song.ini
      const chartBytes = new TextEncoder().encode(chartText);
      const chartDoc = readChart([{fileName: 'notes.chart', data: chartBytes}]);
      chartDoc.parsedChart.metadata = {
        ...chartDoc.parsedChart.metadata,
        name: songName,
        artist: artistName ?? '',
        pro_drums: true,
        charter: chartDoc.parsedChart.metadata.charter ?? 'AutoDrums',
      };
      const chartFiles = writeChartFolder(chartDoc);

      // 3. Get audio sources
      const audioFiles: AudioSource[] = [];
      if (getAudioSources) {
        try {
          const sources = await getAudioSources();
          for (const source of sources) {
            // Apply stem inclusion filters if toggles are shown
            if (showStemToggles) {
              if (source.fileName.startsWith('drums') && !includeDrumStem) continue;
              if (source.fileName.startsWith('song') && !includeAccompaniment) continue;
            }
            audioFiles.push(source);
          }
        } catch (err) {
          console.warn('Failed to get audio sources:', err);
        }
      }

      // 4. Build file entries and package as ZIP or SNG
      const fileEntries = chartFiles.map(f => ({
        filename: f.fileName,
        data: f.data,
      }));
      for (const audio of audioFiles) {
        fileEntries.push({filename: audio.fileName, data: new Uint8Array(audio.data)});
      }

      let blob: Blob;
      let extension: string;

      if (packageFormat === 'sng') {
        // exportAsSng extracts song.ini into SNG header metadata automatically
        const sngBytes = exportAsSng(fileEntries);
        blob = new Blob([sngBytes as Uint8Array<ArrayBuffer>], {type: 'application/octet-stream'});
        extension = 'sng';
      } else {
        blob = exportAsZip(fileEntries);
        extension = 'zip';
      }

      // 5. Trigger browser download
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${songName.replace(/[^a-zA-Z0-9_-]/g, '_')}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      toast.success('Chart exported successfully');
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      console.error('Export error:', err);
      toast.error(msg);
    } finally {
      setIsExporting(false);
    }
  }, [
    songName,
    artistName,
    packageFormat,
    includeDrumStem,
    includeAccompaniment,
    getChartText,
    getAudioSources,
    showStemToggles,
  ]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-1" />
          Export
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export Chart</DialogTitle>
          <DialogDescription>
            {songName}
            {artistName ? ` - ${artistName}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Package format selector */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="package-format" className="text-right">
              Format
            </Label>
            <Select
              value={packageFormat}
              onValueChange={v => setPackageFormat(v as PackageFormat)}>
              <SelectTrigger className="col-span-3" id="package-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zip">ZIP (standard)</SelectItem>
                <SelectItem value="sng">SNG (Clone Hero / YARG)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Audio format display */}
          {getAudioSources && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="audio-format" className="text-right">
                Audio
              </Label>
              <Select value="wav" disabled>
                <SelectTrigger className="col-span-3" id="audio-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wav">WAV (lossless)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Include checkboxes */}
          {getAudioSources && showStemToggles && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Include</Label>
              <div className="col-span-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id="include-drums"
                    checked={includeDrumStem}
                    onCheckedChange={setIncludeDrumStem}
                  />
                  <Label htmlFor="include-drums" className="font-normal">
                    Drum stem (drums.wav)
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="include-accompaniment"
                    checked={includeAccompaniment}
                    onCheckedChange={setIncludeAccompaniment}
                  />
                  <Label htmlFor="include-accompaniment" className="font-normal">
                    Accompaniment (song.wav)
                  </Label>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-1" />
                Download .{packageFormat}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
