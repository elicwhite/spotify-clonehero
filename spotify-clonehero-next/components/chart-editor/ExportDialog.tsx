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

import {
  exportAsZip,
  exportAsSng,
  assembleChartFiles,
  chartPackageFileName,
} from '@/lib/chart-export';
import {downloadBlob} from '@/lib/download';

import SongMetadataFields from './SongMetadataFields';

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
  /** Default song name, pre-filled into the export form. */
  songName: string;
  /** Default artist name, pre-filled into the export form. */
  artistName?: string | undefined;
  /** Default charter credit, pre-filled into the export form. */
  charterName?: string | undefined;
  /**
   * Provides the chart text to export. Must return a valid .chart string.
   * This decouples the dialog from any specific storage backend. Ignored
   * when `getChartFile` is also supplied — that one wins, since it can
   * represent a `.mid`-sourced chart too (see `getChartFile`).
   */
  getChartText?: (() => Promise<string>) | undefined;
  /**
   * Format-agnostic alternative to `getChartText`: provides the chart file's
   * raw bytes and its own filename (`notes.chart` or `notes.mid`), whichever
   * format the source chart used. Needed by pages (chart-flow) whose
   * project's persisted chart may be `.mid` — `getChartText`'s `string`
   * return can't carry binary MIDI data without corrupting it. Preferred
   * over `getChartText` when both are supplied.
   */
  getChartFile?:
    | (() => Promise<{fileName: string; data: Uint8Array}>)
    | undefined;
  /**
   * Provides audio sources to include in the package.
   *
   * Receives the user's stem preference: when `includeStems` is true the page
   * should return separated stems (e.g. `drums.wav` + accompaniment
   * `song.wav`); when false it should return the original un-separated audio as
   * a single `song.wav`. Pages without separated stems may ignore the flag.
   */
  getAudioSources?:
    | ((options: {includeStems: boolean}) => Promise<AudioSource[]>)
    | undefined;
  /**
   * Whether the audio can be exported either as separated stems or as the
   * original file. When true the dialog shows an "Include stems?" toggle;
   * when false the audio is always included as-is. Default: false.
   */
  showStemChoice?: boolean | undefined;
  /**
   * Provides passthrough asset files (e.g. album art, video, secondary
   * audio) to append verbatim to the package — used by the chart-flow
   * feature to round-trip an existing chart package's non-audio assets.
   * Omitted (or empty) by pages that have none.
   */
  getExtraAssets?: (() => Promise<AssetFile[]>) | undefined;
  /**
   * Preselects the package format select (e.g. to match the original
   * package's format when re-exporting an existing chart). Defaults to
   * 'zip' when omitted.
   */
  defaultFormat?: PackageFormat | undefined;
}

/** A passthrough asset file for package assembly (see {@link getExtraAssets}). */
export interface AssetFile {
  fileName: string;
  data: Uint8Array;
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
  charterName,
  getChartText,
  getChartFile,
  getAudioSources,
  showStemChoice = false,
  getExtraAssets,
  defaultFormat = 'zip',
}: ExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [packageFormat, setPackageFormat] =
    useState<PackageFormat>(defaultFormat);
  const [includeStems, setIncludeStems] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Editable metadata, (re)seeded from the props each time the dialog opens.
  const [metadata, setMetadata] = useState({
    name: songName,
    artist: artistName ?? '',
    charter: charterName ?? '',
  });

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setMetadata({
          name: songName,
          artist: artistName ?? '',
          charter: charterName ?? '',
        });
      }
      setOpen(next);
    },
    [songName, artistName, charterName],
  );

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      // 1. Get the chart — prefer the format-agnostic getChartFile (handles
      // .mid-sourced chart-flow projects) over getChartText.
      if (!getChartFile && !getChartText) {
        throw new Error(
          'ExportDialog requires getChartFile or getChartText',
        );
      }
      const chartFile = getChartFile ? await getChartFile() : undefined;
      const chartText = chartFile || !getChartText
        ? undefined
        : await getChartText();

      // 2. Collect audio sources. When the page offers a stem choice, honor
      //    the toggle; otherwise include whatever audio it provides.
      let audioFiles: AudioSource[] = [];
      if (getAudioSources) {
        try {
          audioFiles = await getAudioSources({
            includeStems: showStemChoice ? includeStems : true,
          });
        } catch (err) {
          console.warn('Failed to get audio sources:', err);
        }
      }

      // 3. Assemble notes.chart + song.ini + audio (+ any passthrough
      //    assets from an existing chart package) into a flat file list.
      let extraAssets: AssetFile[] = [];
      if (getExtraAssets) {
        try {
          extraAssets = await getExtraAssets();
        } catch (err) {
          console.warn('Failed to get extra assets:', err);
        }
      }
      const cleanMetadata = {
        name: metadata.name.trim() || 'Untitled',
        artist: metadata.artist.trim(),
        charter: metadata.charter.trim(),
      };
      const fileEntries = assembleChartFiles({
        ...(chartFile ? {chartFile} : {}),
        ...(chartText !== undefined ? {chartText} : {}),
        metadata: cleanMetadata,
        audioSources: audioFiles,
        extraAssets,
      });

      // 4. Package as ZIP or SNG
      let blob: Blob;
      let extension: string;

      if (packageFormat === 'sng') {
        // exportAsSng extracts song.ini into SNG header metadata automatically
        const sngBytes = exportAsSng(fileEntries);
        blob = new Blob([sngBytes as Uint8Array<ArrayBuffer>], {
          type: 'application/octet-stream',
        });
        extension = 'sng';
      } else {
        blob = exportAsZip(fileEntries);
        extension = 'zip';
      }

      // 5. Trigger browser download, named `Artist - Song (Charter)`
      downloadBlob(blob, chartPackageFileName(cleanMetadata, extension));

      const audioNote =
        audioFiles.length > 0
          ? ` with ${audioFiles.length} audio file${audioFiles.length === 1 ? '' : 's'}`
          : ' (no audio included)';
      toast.success(`Chart exported${audioNote}`);
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      console.error('Export error:', err);
      toast.error(msg);
    } finally {
      setIsExporting(false);
    }
  }, [
    metadata,
    packageFormat,
    includeStems,
    getChartText,
    getChartFile,
    getAudioSources,
    showStemChoice,
    getExtraAssets,
  ]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
            Confirm the song details and download the packaged chart.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Song / artist / charter metadata */}
          <SongMetadataFields
            value={metadata}
            onChange={setMetadata}
            idPrefix="export"
          />

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

          {/* Stems vs. original audio */}
          {getAudioSources && showStemChoice && (
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="include-stems" className="text-right pt-1">
                Include stems?
              </Label>
              <div className="col-span-3 space-y-1">
                <Switch
                  id="include-stems"
                  checked={includeStems}
                  onCheckedChange={setIncludeStems}
                />
                <p className="text-xs text-muted-foreground">
                  {includeStems
                    ? 'Separated drums and accompaniment stems are included.'
                    : 'The original uploaded audio is included instead.'}
                </p>
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
