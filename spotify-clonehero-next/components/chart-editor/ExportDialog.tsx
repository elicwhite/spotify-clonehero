'use client';

import {useState, useCallback, useEffect, useRef} from 'react';
import {
  AlertTriangle,
  Download,
  FileArchive,
  Loader2,
  Package,
} from 'lucide-react';
import {toast} from 'sonner';
import {
  parseChartAndIni,
  scanChart,
  type FolderIssueType,
  type ScannedChart,
} from '@eliwhite/scan-chart';

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
  type ChartPackageMetadata,
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

/** The `ChartPackageMetadata` `assembleChartFiles` stamps onto the exported
 * chart, built from the read-only identity props plus the song-details
 * dialog's `iniMetadata`. Shared by the actual export and the issue-preview
 * scan below so both see the same metadata the download will carry. */
function buildCleanMetadata(args: {
  songName: string;
  artistName: string | undefined;
  charterName: string | undefined;
  iniMetadata: SongIniMetadataValue | undefined;
}): ChartPackageMetadata {
  const {songName, artistName, charterName, iniMetadata} = args;
  return {
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
}

/** One of the three sources `assembleChartFiles` accepts, resolved from
 * whichever the host supplied — `getChartFile` wins (only it can honour the
 * chart-file format select), then the live document, then `.chart` text. */
type ChartSource =
  | {chartFile: {fileName: string; data: Uint8Array}}
  | {chartDoc: ChartDocument}
  | {chartText: string};

async function resolveChartSource(args: {
  getChartFile: ExportDialogProps['getChartFile'];
  chartDoc: ChartDocument | undefined;
  getChartText: ExportDialogProps['getChartText'];
  chartFileFormat: ChartFileFormat;
}): Promise<ChartSource | null> {
  const {getChartFile, chartDoc, getChartText, chartFileFormat} = args;
  if (getChartFile) {
    return {chartFile: await getChartFile({format: chartFileFormat})};
  }
  if (chartDoc) return {chartDoc};
  if (getChartText) return {chartText: await getChartText()};
  return null;
}

/** Everything the host has to produce before a package can be assembled. */
interface ExportInputs {
  chartSource: ChartSource;
  audioFiles: AudioSource[];
  extraAssets: AssetFile[];
}

/**
 * The chart, its audio and its passthrough assets.
 *
 * A missing chart source is the one fatal case; audio and assets are warned
 * about and left empty, so a chart with an unreadable stem still exports.
 */
async function collectExportInputs(args: {
  getChartFile: ExportDialogProps['getChartFile'];
  chartDoc: ChartDocument | undefined;
  getChartText: ExportDialogProps['getChartText'];
  chartFileFormat: ChartFileFormat;
  getAudioSources: ExportDialogProps['getAudioSources'];
  includeStems: boolean;
  getExtraAssets: ExportDialogProps['getExtraAssets'];
}): Promise<ExportInputs> {
  const chartSource = await resolveChartSource(args);
  if (!chartSource) {
    throw new Error(
      'ExportDialog requires getChartFile, chartDoc or getChartText',
    );
  }

  let audioFiles: AudioSource[] = [];
  if (args.getAudioSources) {
    try {
      audioFiles = await args.getAudioSources({
        includeStems: args.includeStems,
      });
    } catch (err) {
      console.warn('Failed to get audio sources:', err);
    }
  }

  let extraAssets: AssetFile[] = [];
  if (args.getExtraAssets) {
    try {
      extraAssets = await args.getExtraAssets();
    } catch (err) {
      console.warn('Failed to get extra assets:', err);
    }
  }

  return {chartSource, audioFiles, extraAssets};
}

// ---------------------------------------------------------------------------
// Chart-checker issues
// ---------------------------------------------------------------------------

/** `folderIssues` too common/unactionable to be worth flagging: every drum
 * transcription and most in-progress edits ship without album art, so
 * reporting it on every export would drown out real problems. Mirrors the
 * tolerance `lib/chart-export/__tests__/package-validation.test.ts` already
 * applies when asserting a packaged chart is clean. */
const BENIGN_FOLDER_ISSUES = new Set<FolderIssueType>(['noAlbumArt']);

/** Bulleted issues are capped at this many lines; past that a "+N more"
 * summary line takes over so a chart with dozens of small issues (e.g. one
 * per difficulty) doesn't turn the dialog into a wall of text. */
const MAX_VISIBLE_ISSUES = 8;

export interface ExportIssueSummary {
  /** Human-readable, deduplicated issue descriptions, in folder → metadata →
   * chart order, capped to `MAX_VISIBLE_ISSUES`. */
  lines: string[];
  /** Total distinct issues found, before the cap. */
  totalCount: number;
}

/**
 * Turn a `ScannedChart`'s three issue channels into the dialog's bulleted
 * list. All three channels already carry a scan-chart-authored
 * `description`, so no separate human-readable mapping is needed here.
 * Duplicate descriptions collapse to one line — a chart-wide problem (e.g. a
 * missing name) shouldn't repeat once per difficulty.
 */
export function summarizeScanIssues(scanned: ScannedChart): ExportIssueSummary {
  const descriptions: string[] = [];
  for (const issue of scanned.folderIssues) {
    if (BENIGN_FOLDER_ISSUES.has(issue.folderIssue)) continue;
    descriptions.push(issue.description);
  }
  for (const issue of scanned.metadataIssues) {
    descriptions.push(issue.description);
  }
  for (const issue of scanned.notesData?.chartIssues ?? []) {
    descriptions.push(issue.description);
  }

  const unique = Array.from(new Set(descriptions));
  return {
    lines: unique.slice(0, MAX_VISIBLE_ISSUES),
    totalCount: unique.length,
  };
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

  /**
   * The host's inputs, fetched at most once per dialog open per stem choice.
   *
   * The issue preview below and the export itself need exactly the same
   * three things, and producing them is the expensive part: on a project with
   * added leading silence `getAudioSources` re-encodes every audio file, so
   * fetching them twice would encode the whole song twice for one download.
   * Keyed by the two controls that change what they are, and dropped when the
   * dialog closes so the next open sees the current chart.
   */
  const inputsRef = useRef<{key: string; inputs: Promise<ExportInputs>} | null>(
    null,
  );
  const stemChoice = showStemChoice ? includeStems : true;
  const loadExportInputs = useCallback((): Promise<ExportInputs> => {
    const key = `${chartFileFormat}|${stemChoice}`;
    const cached = inputsRef.current;
    if (cached?.key === key) return cached.inputs;
    const inputs = collectExportInputs({
      getChartFile,
      chartDoc,
      getChartText,
      chartFileFormat,
      getAudioSources,
      includeStems: stemChoice,
      getExtraAssets,
    });
    inputsRef.current = {key, inputs};
    return inputs;
  }, [
    chartDoc,
    chartFileFormat,
    getAudioSources,
    getChartFile,
    getChartText,
    getExtraAssets,
    stemChoice,
  ]);

  useEffect(() => {
    if (!open) inputsRef.current = null;
  }, [open]);

  // Chart-checker issues: what scan-chart would report about this package.
  // Purely informational (the export buttons stay enabled either way), so
  // this runs once per dialog open rather than on every keystroke in the
  // song-details dialog — `open` is the only dependency that re-triggers it.
  const [issueSummary, setIssueSummary] = useState<ExportIssueSummary | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      if (!cancelled) setIssueSummary(null);
      try {
        const {chartSource, audioFiles, extraAssets} = await loadExportInputs();

        // No Opus transcode here — the real audio bytes are already a
        // recognizable, decodable audio format, so scan-chart's audio
        // folder-issue checks read them the same either way, and skipping
        // the encode keeps this preview cheap.
        const fileEntries = assembleChartFiles({
          ...chartSource,
          metadata: buildCleanMetadata({
            songName,
            artistName,
            charterName,
            iniMetadata,
          }),
          audioSources: audioFiles,
          extraAssets,
        });
        const parseResult = parseChartAndIni(fileEntries);
        const scanned = scanChart(fileEntries, parseResult, {
          includeMd5: false,
          includeBTrack: false,
        });
        if (!cancelled) setIssueSummary(summarizeScanIssues(scanned));
      } catch (err) {
        console.warn('Could not check chart for issues:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleExport = useCallback(
    async (packageFormat: PackageFormat) => {
      setExportingFormat(packageFormat);
      try {
        // 1. The chart, its audio and its passthrough assets — the same three
        //    the issue preview above already resolved, so this is normally a
        //    cache hit rather than a second read and re-encode.
        const {chartSource, audioFiles, extraAssets} = await loadExportInputs();

        // 2. Normalize all audio to Opus before assembly. Some pages provide
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

        const cleanMetadata = buildCleanMetadata({
          songName,
          artistName,
          charterName,
          iniMetadata,
        });
        const fileEntries = assembleChartFiles({
          ...chartSource,
          metadata: cleanMetadata,
          audioSources: opusAudioSources,
          extraAssets: opusExtraAssets,
          ...(songLengthMs != null ? {songLengthMs} : {}),
        });

        // 3. Package as ZIP or SNG
        const {blob, extension} = packageChartFiles(fileEntries, packageFormat);

        // 4. Trigger browser download, named `Artist - Song (Charter)`
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
    [songName, artistName, charterName, iniMetadata, loadExportInputs],
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

          {/* Chart-checker issues: informational only, doesn't block either
              export button. Nothing renders while it's still computing or
              once it comes back clean. */}
          {issueSummary && issueSummary.totalCount > 0 && (
            <div className="rounded-md border border-amber-600/30 bg-amber-600/5 p-3 text-xs text-amber-700 dark:text-amber-500">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {issueSummary.totalCount === 1
                  ? '1 issue found in this chart:'
                  : `${issueSummary.totalCount} issues found in this chart:`}
              </p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-6">
                {issueSummary.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              {issueSummary.totalCount > issueSummary.lines.length && (
                <p className="mt-1 pl-6 text-amber-700/70 dark:text-amber-500/70">
                  +{issueSummary.totalCount - issueSummary.lines.length} more
                </p>
              )}
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
