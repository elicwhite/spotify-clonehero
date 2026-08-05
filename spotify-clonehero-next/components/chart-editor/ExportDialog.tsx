'use client';

import {useState, useCallback} from 'react';
import {
  AlertTriangle,
  Download,
  FileArchive,
  Loader2,
  Package,
} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {cn} from '@/lib/utils';

import {
  assembleChartFiles,
  chartPackageFileName,
  packageChartFiles,
  transcodeAudioFilesToOpus,
  type PackageFormat,
} from '@/lib/chart-export';
import {downloadBlob} from '@/lib/download';
import type {ChartDocument} from '@/lib/chart-edit';
import type {DifficultyField} from '@/lib/chart-difficulty';
import type {SongIniMetadataValue} from '@/lib/chart-editor-core';

/**
 * The intensities the chart actually declares. A field the user left unset is
 * omitted rather than sent as the `-1` sentinel, so `assembleChartFiles` keeps
 * whatever the document carried — including the rated-drums default it stamps
 * on a minted chart.
 */
function declaredDifficulties(
  value: SongIniMetadataValue,
): Partial<Record<DifficultyField, number>> {
  const declared: Partial<Record<DifficultyField, number>> = {};
  for (const [field, intensity] of Object.entries(value.difficulties)) {
    if (intensity !== null && intensity !== undefined) {
      declared[field as DifficultyField] = intensity;
    }
  }
  return declared;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A named audio source for export packaging. Any format the browser can
 * decode is accepted; the dialog transcodes non-Opus audio to `.opus` before
 * assembly (see {@link transcodeAudioFilesToOpus}). */
export interface AudioSource {
  /** File name in the output package (e.g. 'drums.opus', 'song.wav'). */
  fileName: string;
  /** Encoded audio file bytes (wav/mp3/ogg/opus/…). */
  data: ArrayBuffer;
}

/** The chart file format inside the package — `.chart` (text) or `.mid`
 * (binary). Distinct from `PackageFormat`, which is the outer zip/sng
 * container. */
export type ChartFileFormat = 'chart' | 'mid';

interface ExportDialogProps {
  /**
   * Song name written into the exported `song.ini` and the download's file
   * name. Read-only here — editing lives in the song-details dialog.
   */
  songName: string;
  /** Artist name written into the exported `song.ini`. Read-only here. */
  artistName?: string | undefined;
  /** Charter credit written into the exported `song.ini`. Read-only here. */
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
    | ((options: {
        format: ChartFileFormat;
      }) => Promise<{fileName: string; data: Uint8Array}>)
    | undefined;
  /**
   * The live document, when the host has one. Preferred over `getChartText`,
   * whose `.chart` text carries no `song.ini` surface at all: assembling from
   * the document keeps `icon`, `loading_phrase`, `album_track`, a keys
   * difficulty, any custom ini key and the chart's assets. `getChartFile`
   * still wins, since only it can honour the chart-file format select.
   */
  chartDoc?: ChartDocument | undefined;
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
   * Marks which of the two package buttons (zip / sng) matches the format
   * the project was originally imported from, so the dialog can badge it as
   * "Recommended" when re-exporting an existing chart. Both buttons stay
   * fully usable either way. Omit when there's no original package to match.
   */
  defaultFormat?: PackageFormat | undefined;
  /**
   * The format an *existing* chart the project was imported from actually
   * used (`ParsedChart.format`). Seeds the "Chart file" select's default and
   * drives the lossy-conversion warning when the user's selection differs
   * from it. Leave undefined for projects with no imported source chart
   * (e.g. built from scratch by this app's own transcription pipeline) —
   * there both `.chart` and `.mid` are equally faithful targets, so no
   * warning should ever show.
   */
  sourceChartFormat?: ChartFileFormat | undefined;
  /**
   * Shows the "Chart file" select (defaulting to `.chart`) even when
   * `sourceChartFormat` is undefined — for projects that can convert but
   * have no "original" format to warn about deviating from. The select
   * renders whenever either this or `sourceChartFormat` is set. Pages that
   * can't convert at all (e.g. /tempo, /add-lyrics) leave both unset.
   */
  chartFormatSelectable?: boolean | undefined;
  /**
   * The rest of the chart's `song.ini` surface — album / genre / year and the
   * per-instrument intensities the song-details dialog authors. Only the
   * identity fields are editable here; these ride along so the exported
   * `song.ini` matches what the editor shows, which a chart file alone can't
   * carry (`.chart` has no `diff_*` fields).
   */
  iniMetadata?: SongIniMetadataValue | undefined;
}

/** A passthrough asset file for package assembly (see {@link getExtraAssets}). */
export interface AssetFile {
  fileName: string;
  data: Uint8Array;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Export dialog for downloading the chart as a .zip or .sng package.
 *
 * The user picks the package format directly by clicking one of two large
 * buttons, each of which packages and downloads immediately. Song / artist /
 * charter and the rest of `song.ini` are read from the document, not edited
 * here — that lives in the song-details dialog.
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
  chartDoc,
  getAudioSources,
  showStemChoice = false,
  getExtraAssets,
  defaultFormat,
  sourceChartFormat,
  chartFormatSelectable = false,
  iniMetadata,
}: ExportDialogProps) {
  const [open, setOpen] = useState(false);
  const [includeStems, setIncludeStems] = useState(true);
  const [exportingFormat, setExportingFormat] = useState<PackageFormat | null>(
    null,
  );
  const [chartFileFormat, setChartFileFormat] = useState<ChartFileFormat>(
    sourceChartFormat ?? 'chart',
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setChartFileFormat(sourceChartFormat ?? 'chart');
      }
      setOpen(next);
    },
    [sourceChartFormat],
  );

  const handleExport = useCallback(
    async (packageFormat: PackageFormat) => {
      setExportingFormat(packageFormat);
      try {
        // 1. Get the chart. getChartFile wins (it is the only source that can
        // honour the chart-file format select), then the live document, then
        // the `.chart` text.
        const chartSource = getChartFile
          ? {chartFile: await getChartFile({format: chartFileFormat})}
          : chartDoc
            ? {chartDoc}
            : getChartText
              ? {chartText: await getChartText()}
              : null;
        if (!chartSource) {
          throw new Error(
            'ExportDialog requires getChartFile, chartDoc or getChartText',
          );
        }

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
        // 3a. Normalize all audio to Opus before assembly. Some pages provide
        //     already-encoded `.opus` (stem path), others provide wav/mp3/ogg
        //     (original-file path, `/chart-editor`) or carry secondary audio in the
        //     passthrough assets — transcode any non-Opus audio and rename it to
        //     `.opus`; non-audio assets pass through untouched. Assembly itself
        //     stays pure/sync; this async step is the seam.
        const {files: opusAudioSources, durationMs: audioDurationMs} =
          await transcodeAudioFilesToOpus(audioFiles);
        const {files: opusExtraAssets, durationMs: extraAssetDurationMs} =
          await transcodeAudioFilesToOpus(extraAssets);
        // Longest decoded stem/track wins — e.g. an instrumental stem can run
        // longer than the drums stem.
        const songLengthMs =
          audioDurationMs != null || extraAssetDurationMs != null
            ? Math.max(audioDurationMs ?? 0, extraAssetDurationMs ?? 0)
            : undefined;

        const cleanMetadata = {
          name: songName.trim() || 'Untitled',
          artist: (artistName ?? '').trim(),
          charter: (charterName ?? '').trim(),
          ...(iniMetadata
            ? {
                album: iniMetadata.album,
                genre: iniMetadata.genre,
                year: iniMetadata.year,
                difficulties: declaredDifficulties(iniMetadata),
              }
            : {}),
        };
        const fileEntries = assembleChartFiles({
          ...chartSource,
          metadata: cleanMetadata,
          audioSources: opusAudioSources,
          extraAssets: opusExtraAssets,
          ...(songLengthMs != null ? {songLengthMs} : {}),
        });

        // 4. Package as ZIP or SNG
        const {blob, extension} = packageChartFiles(fileEntries, packageFormat);

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
        setExportingFormat(null);
      }
    },
    [
      songName,
      artistName,
      charterName,
      iniMetadata,
      chartFileFormat,
      includeStems,
      getChartText,
      getChartFile,
      chartDoc,
      getAudioSources,
      showStemChoice,
      getExtraAssets,
    ],
  );

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
            Pick the package you want. Song details come from the chart itself.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Chart file format selector (notes.chart vs notes.mid) — only
              shown when the page can actually convert between them. The
              lossy-conversion warning only applies when there's a known
              imported source format to deviate from. */}
          {(sourceChartFormat || chartFormatSelectable) && (
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="chart-file-format" className="text-right pt-2">
                Chart file
              </Label>
              <div className="col-span-3 space-y-1">
                <Select
                  value={chartFileFormat}
                  onValueChange={v => setChartFileFormat(v as ChartFileFormat)}>
                  <SelectTrigger id="chart-file-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="chart">.chart (text)</SelectItem>
                    <SelectItem value="mid">.mid (MIDI)</SelectItem>
                  </SelectContent>
                </Select>
                {sourceChartFormat && chartFileFormat !== sourceChartFormat && (
                  <p className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-500">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {sourceChartFormat === 'chart' ? (
                      <span>
                        This chart was made as .chart. Converting to .mid can be
                        lossy, some .chart-only data may not survive.
                      </span>
                    ) : (
                      <span>
                        This chart was made as .mid. Converting to .chart can be
                        lossy, some .mid-only data may not survive.
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          )}

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

          {/* Package format: two equal-weight buttons, each downloads
              immediately on click. */}
          <div className="grid grid-cols-2 gap-3">
            <PackageButton
              icon={FileArchive}
              title=".zip"
              description="A folder of loose files: chart, audio and song.ini."
              recommended={defaultFormat === 'zip'}
              busy={exportingFormat === 'zip'}
              disabled={exportingFormat != null}
              onClick={() => handleExport('zip')}
            />
            <PackageButton
              icon={Package}
              title=".sng"
              description="A single packed file for Clone Hero and YARG."
              recommended={defaultFormat === 'sng'}
              busy={exportingFormat === 'sng'}
              disabled={exportingFormat != null}
              onClick={() => handleExport('sng')}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface PackageButtonProps {
  icon: typeof FileArchive;
  title: string;
  description: string;
  recommended: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}

/** One of the two large, equal-weight export choices. */
function PackageButton({
  icon: Icon,
  title,
  description,
  recommended,
  busy,
  disabled,
  onClick,
}: PackageButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Download ${title} package`}
      className={cn(
        'relative flex h-auto flex-col items-center gap-2 whitespace-normal px-4 py-6 text-center',
        recommended && 'border-primary',
      )}>
      {recommended && (
        <span className="absolute right-2 top-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          Recommended
        </span>
      )}
      {busy ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : (
        <Icon className="h-6 w-6" />
      )}
      <span className="text-base font-semibold">
        {busy ? 'Exporting…' : title}
      </span>
      <span className="text-xs font-normal text-muted-foreground">
        {description}
      </span>
    </Button>
  );
}
