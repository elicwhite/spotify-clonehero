'use client';

import {useEffect, useState, useCallback, useRef} from 'react';
import {useRouter} from 'next/navigation';
import {FolderOpen, TriangleAlert} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {DestructiveNotice} from '@/components/DestructiveNotice';
import SectionDropZone from '@/components/landing/SectionDropZone';
import {ToolEntryCard} from '@/components/landing/ToolEntryCard';

import {getExtension, getBasename} from '@/lib/src-shared/utils';
import {removeStyleTags} from '@/lib/ui-utils';
import {
  findAudioFiles,
  type Files,
} from '@/lib/preview/chorus-chart-processing';
import {readChart, type ChartDocument} from '@/lib/chart-edit';
import {applyAlignedLyricsToDoc} from '@/lib/lyrics-align/apply-lyrics';
import {createProjectFromDoc} from '@/lib/project-storage/createProjectFromDoc';
import {
  detectFormat,
  readChartDirectory,
  readSngFile,
  readZipFile,
  type LoadedFiles,
  type SourceFormat,
} from '@/lib/chart-files/chart-package';
import ChartDropZone from '@/components/chart-picker/ChartDropZone';
import ConnectedProcessingView from '@/components/assist/ConnectedProcessingView';
import {track} from '@/lib/analytics/track';
import type {AssistRunContext} from '@/components/assist/useAssistRunner';
import {useAssistRunnerControls} from '@/components/assist/useAssistRunner';
import {
  addLyricsTask,
  type AddLyricsInput,
} from '@/lib/assist/tasks/add-lyrics';
import {isAbortError} from '@/lib/workers/abortable-worker';
import {AddLyricsLanding} from './landing/AddLyricsLanding';
import {useToolLandingView} from '@/components/analytics/useToolLandingView';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoadedChart {
  audioFiles: Files;
  vocalsFile: {data: Uint8Array; mimeType: string} | null;
  chartDoc: ChartDocument;
  sourceFormat: SourceFormat;
  originalName: string;
  sngMetadata?: Record<string, string> | undefined;
}

type Status =
  | 'idle'
  | 'loading-chart'
  | 'input'
  | 'processing'
  | 'saving'
  // The run finished but the project write did not. The aligned document is
  // still in memory, so this is retryable without re-running the alignment.
  | 'save-failed'
  | 'error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMimeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'mp3':
      return 'audio/mpeg';
    case 'opus':
      return 'audio/opus';
    case 'wav':
      return 'audio/wav';
    default:
      return 'audio/ogg';
  }
}

function loadChartFromFiles(loaded: LoadedFiles): LoadedChart {
  const {files, sourceFormat, originalName, sngMetadata} = loaded;

  // chart-edit's readChart expects { fileName, data }
  // Our chart-files readers already produce that shape
  const chartDoc = readChart(files);

  // Find audio files using shared helper
  const audioFiles = findAudioFiles(files);
  if (audioFiles.length === 0) {
    throw new Error('No audio files found');
  }

  // Check for pre-existing vocals stem
  const vocalsFile = audioFiles.find(
    f => getBasename(f.fileName).toLowerCase() === 'vocals',
  );

  return {
    audioFiles,
    vocalsFile: vocalsFile
      ? {
          data: vocalsFile.data,
          mimeType: getMimeForExtension(getExtension(vocalsFile.fileName)),
        }
      : null,
    chartDoc,
    sourceFormat,
    originalName,
    sngMetadata,
  };
}

/** The chart's primary mix file: `song.*` when present, else the first audio
 *  file. Used both as the `add-lyrics` task's audio source (its bytes are
 *  what the roformer-cache fingerprint and the Demucs fallback are computed
 *  from) and, on tier-2 escalation, as one of the stems re-mixed for a fresh
 *  separation. */
function pickSongFile(chart: LoadedChart): {
  fileName: string;
  data: Uint8Array;
} {
  return (
    chart.audioFiles.find(
      f => getBasename(f.fileName).toLowerCase() === 'song',
    ) ?? chart.audioFiles[0]
  );
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

/** Every run on this page is this tool's own landing flow. The project it
 *  later creates is stamped `add-lyrics` to match. */
const LANDING_RUN: AssistRunContext = {
  origin: 'add-lyrics',
  entrypoint: 'landing',
};

export default function AddLyricsClient() {
  useToolLandingView('add-lyrics');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [chart, setChart] = useState<LoadedChart | null>(null);
  const [lyrics, setLyrics] = useState('');
  const [showLyricsWarning, setShowLyricsWarning] = useState(false);
  /** The aligned document a failed save is holding, for the retry. */
  const [pendingDoc, setPendingDoc] = useState<ChartDocument | null>(null);
  const initStartedRef = useRef(false);

  // The page's own assist runner — nothing else on this page shares it, so
  // it doesn't need the editor's `AssistRunnerProvider`/context; the same
  // `add-lyrics` task, `run-to-steps.ts` adapter, and cancellation contract
  // as the in-editor `AddLyricsDialog` and `/drum-transcription`.
  const runner = useAssistRunnerControls();
  const router = useRouter();
  /** Which alignment pass is in flight, for the processing card's caption.
   *  `null` outside a run. */
  const [tierPass, setTierPass] = useState<1 | 2 | null>(null);

  // Preload alignment model in worker once chart is loaded
  useEffect(() => {
    if (status !== 'input' || initStartedRef.current) return;
    initStartedRef.current = true;

    (async () => {
      try {
        const {init} = await import('@/lib/lyrics-align/aligner');
        await init(msg => console.log('[aligner init]', msg));
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn('Failed to preload alignment model:', message);
      }
    })();
  }, [status]);

  const handleChartLoaded = useCallback((loaded: LoadedFiles) => {
    setStatus('loading-chart');
    setError(null);

    try {
      const result = loadChartFromFiles(loaded);
      setChart(result);

      // Check for existing lyrics and warn
      const existingLyrics =
        result.chartDoc.parsedChart.vocalTracks.parts[
          'vocals'
        ]?.notePhrases.flatMap(p => p.lyrics) ?? [];
      if (existingLyrics.length > 0) {
        setShowLyricsWarning(true);
      }

      setStatus('input');
      track({
        event: 'add_lyrics_chart_loaded',
        sourceFormat: result.sourceFormat,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to load chart';
      setError(message);
      setStatus('error');
    }
  }, []);

  /**
   * Writes the aligned chart as a project and opens it. Never throws: a
   * failure keeps the document so the user can retry the write alone.
   */
  const saveAndOpen = useCallback(
    async (doc: ChartDocument) => {
      if (!chart) return;
      setStatus('saving');
      setError(null);
      try {
        const projectId = await createProjectFromDoc({
          chartDoc: doc,
          audioFiles: chart.audioFiles,
          origin: 'add-lyrics',
          sourceFormat: chart.sourceFormat,
          originalName: chart.originalName,
          sngMetadata: chart.sngMetadata,
        });
        track({event: 'add_lyrics_handed_off'});
        // The funnel's step 2 for this tool. The editor cannot report it:
        // opening a project there is also what reopening one looks like, so
        // the hand-off is the only place that knows a chart just arrived.
        track({
          event: 'chart_opened',
          origin: 'add-lyrics',
          sourceFormat: chart.sourceFormat,
        });
        router.push(`/chart-editor?project=${projectId}`);
      } catch (e) {
        setPendingDoc(doc);
        setError(e instanceof Error ? e.message : String(e));
        setStatus('save-failed');
      }
    },
    [chart, router],
  );

  const handleAlign = useCallback(async () => {
    // A run in flight, or a finished run being saved, owns the page until it
    // navigates. Without this, the Align button below could start a second
    // run behind a push that has already been issued.
    if (status === 'processing' || status === 'saving') return;
    if (!chart || !lyrics.trim()) return;

    setError(null);
    setShowLyricsWarning(false);
    setTierPass(1);
    setStatus('processing');
    track({event: 'add_lyrics_align_started'});
    const alignStartedAt = Date.now();

    try {
      // Pass 1: the shared `add-lyrics` task's own vocals-resolution rule —
      // a bundled `vocals.*` stem is used as-is (no separation at all); else
      // a roformer-separated stem already cached under this audio's
      // fingerprint (from a drum-transcription/tempo run on the same file)
      // is reused; else a fresh Demucs separation runs. Same task, same
      // step list, same math as the in-editor Add Lyrics dialog.
      const input: AddLyricsInput = {
        lyrics,
        vocals: chart.vocalsFile
          ? {kind: 'bundled', stem: chart.vocalsFile}
          : {
              kind: 'resolve',
              audio: {loadOriginalBytes: async () => pickSongFile(chart).data},
            },
      };
      let result = await runner.start(addLyricsTask, input, LANDING_RUN);

      // Tier-2 fallback: when pass 1 resolved vocals without separating the
      // mix itself (a bundled stem, or a roformer stem out of the cache) and
      // the alignment was catastrophic (lowConfidenceFrac >= 0.75), retry
      // with a fresh Demucs separation against every chart stem mixed back
      // together. A second run of the same task with a variant step list
      // (forced Demucs, no cache/bundled branch) rather than a second
      // implementation. Only escalate if there's something new to try — pass
      // 1 already ran Demucs, or there's only one stem to mix → no point.
      const canEscalate =
        result.lowConfidence &&
        result.vocalsSource !== 'demucs' &&
        chart.audioFiles.length >= 2;

      if (canEscalate) {
        setTierPass(2);
        result = await runner.start(
          addLyricsTask,
          {
            lyrics,
            vocals: {
              kind: 'stems',
              stems: chart.audioFiles.map(f => ({
                data: f.data,
                mimeType: getMimeForExtension(getExtension(f.fileName)),
              })),
            },
          },
          LANDING_RUN,
        );
      }

      track({
        event: 'add_lyrics_align_completed',
        totalMs: Date.now() - alignStartedAt,
        lowConfidence: result.lowConfidence ? 1 : 0,
        lowConfidenceFrac: Math.round(result.lowConfidenceFrac * 100) / 100,
      });

      // The aligned chart becomes a project, and the editor opens it. This
      // page aligns; reviewing and fixing the result is what the editor is
      // for, and a project is what survives a reload.
      //
      // Saving has its own error path. A full disk is not an alignment
      // failure, and the alignment that just cost the user a GPU run is
      // still in memory — losing it to a write error would be the worst
      // outcome on this page.
      await saveAndOpen(
        applyAlignedLyricsToDoc(chart.chartDoc, result.syllables),
      );
    } catch (e) {
      if (isAbortError(e)) {
        // Cancelled: back to the paste form with the lyrics still in it.
        setStatus('input');
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus('error');
      const failedStep =
        runner.store.getState().steps.find(s => s.status === 'active')?.key ??
        'unknown';
      track({event: 'add_lyrics_align_failed', step: failedStep});
    } finally {
      setTierPass(null);
    }
  }, [chart, lyrics, runner, saveAndOpen, status]);

  // No chart open yet: the landing page, whose tool entry is this screen's
  // own drop zone, so the pipeline it starts stays owned here.
  if (!chart && status !== 'loading-chart') {
    return (
      <AddLyricsLanding
        toolEntry={
          <>
            {/* The whole section is a drop target (no `onAudioFile`: this
                tool only takes chart packages), so a chart can be dragged
                anywhere on the entry without aiming for the card. */}
            <SectionDropZone
              className="w-full"
              onChartLoaded={handleChartLoaded}>
              <ToolEntryCard>
                <ChartDropZone
                  onLoaded={handleChartLoaded}
                  id="add-lyrics-chart"
                />
              </ToolEntryCard>
            </SectionDropZone>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </>
        }
      />
    );
  }

  return (
    <main className="min-h-screen bg-background w-full">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">
            Add Lyrics To A Chart
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Paste your lyrics and they&rsquo;re synced to the audio, syllable by
            syllable. Runs entirely in your browser.
          </p>
        </header>

        {/* Loading chart */}
        {status === 'loading-chart' && (
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground" />
            <p className="text-muted-foreground">Reading chart files...</p>
          </div>
        )}

        {/* Steps 2-3: chart loaded — info header stays visible during input AND processing */}
        {chart &&
          (status === 'input' ||
            status === 'processing' ||
            status === 'saving' ||
            status === 'save-failed' ||
            (status === 'error' && chart)) && (
            <div className="space-y-6">
              {/* Chart info */}
              <div className="bg-muted rounded-lg p-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">
                    {removeStyleTags(
                      chart.chartDoc.parsedChart.metadata.name ?? 'Unknown',
                    )}{' '}
                    <span className="text-muted-foreground font-normal">
                      by
                    </span>{' '}
                    {removeStyleTags(
                      chart.chartDoc.parsedChart.metadata.artist ?? 'Unknown',
                    )}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Charted by{' '}
                    {removeStyleTags(
                      chart.chartDoc.parsedChart.metadata.charter ?? 'Unknown',
                    )}{' '}
                    &middot; {chart.audioFiles.length} audio file
                    {chart.audioFiles.length !== 1 ? 's' : ''}
                    {chart.vocalsFile &&
                      ' (vocals stem available)'} &middot;{' '}
                    {chart.sourceFormat === 'sng'
                      ? '.sng'
                      : chart.sourceFormat === 'zip'
                        ? '.zip'
                        : 'folder'}
                  </p>
                </div>
                {status === 'input' && (
                  <ReplaceChartButton onLoaded={handleChartLoaded} />
                )}
              </div>

              {/* Processing card. Renders inside the same column so the
                  song info header stays at the top while the steps run. Only
                  this leaf subscribes to the run's progress ticks. */}
              {status === 'processing' && (
                <ConnectedProcessingView
                  store={runner.store}
                  taskKey="add-lyrics"
                  title="Adding lyrics to your chart"
                  description={
                    tierPass === 2
                      ? 'Confidence was low on the first pass, trying again with a fresh separation.'
                      : undefined
                  }
                  onCancel={runner.cancel}
                  className="max-w-none"
                />
              )}

              {/* The run is done and the chart is on its way to the editor.
                  Same column as the steps above, so the page does not jump
                  between the last step and the navigation. */}
              {status === 'saving' && (
                <div className="flex items-center justify-center gap-3 py-8 text-muted-foreground">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-foreground" />
                  <p>Saving your chart and opening the editor...</p>
                </div>
              )}

              {/* The alignment survived; only the write failed. Retrying
                  saves the same document rather than aligning again. */}
              {status === 'save-failed' && pendingDoc && (
                <DestructiveNotice>
                  <p className="text-sm font-medium">
                    Your lyrics are aligned, but the chart could not be saved.
                  </p>
                  {error && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {error}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    This usually means your browser is out of storage. Delete a
                    project from the chart editor and try again.
                  </p>
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={() => void saveAndOpen(pendingDoc)}>
                    Try again
                  </Button>
                </DestructiveNotice>
              )}

              {/* Existing lyrics warning */}
              {status !== 'processing' &&
                status !== 'saving' &&
                showLyricsWarning && (
                  <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 flex items-start gap-3">
                    <TriangleAlert className="h-4 w-4 mt-0.5 text-yellow-700 dark:text-yellow-300 shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm text-yellow-800 dark:text-yellow-200">
                        This chart already has lyrics. Aligning will replace
                        them.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => setShowLyricsWarning(false)}>
                        OK, continue
                      </Button>
                    </div>
                  </div>
                )}

              {/* Lyrics textarea + Align button. Hidden while a run is in
                  flight or its result is being saved, so the step list is the
                  only thing in view. */}
              {status !== 'processing' &&
                status !== 'saving' &&
                status !== 'save-failed' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Paste Lyrics
                      </label>
                      <p className="text-xs text-muted-foreground mb-2">
                        All pasted text becomes lyrics, so don&apos;t include
                        non-lyric symbols or section headers like [Verse]. One
                        line per phrase.
                      </p>
                      <textarea
                        value={lyrics}
                        onChange={e => setLyrics(e.target.value)}
                        rows={12}
                        placeholder="Paste the song lyrics here..."
                        className="w-full bg-muted border border-border rounded-lg px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary resize-y"
                      />
                    </div>

                    <Button
                      onClick={handleAlign}
                      disabled={!lyrics.trim() || showLyricsWarning}
                      size="lg"
                      className="w-full sm:w-auto">
                      Align Lyrics
                    </Button>
                  </>
                )}

              {error && <p className="text-destructive text-sm">{error}</p>}
            </div>
          )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Replace-chart button
// ---------------------------------------------------------------------------

/**
 * Compact replace-chart control for the chart-loaded state. Replaces
 * the full ChartDropZone, which would otherwise duplicate the loaded
 * card and make users wonder if the upload took.
 *
 * Folder picker is the primary action — it's the more common path
 * users reach for when picking a Clone Hero chart. .zip / .sng falls
 * back to a hidden file input via a small text link beneath.
 */
function ReplaceChartButton({
  onLoaded,
}: {
  onLoaded: (result: LoadedFiles) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      const format = detectFormat(file);
      if (!format) {
        toast.error('Please pick a .zip or .sng file');
        return;
      }
      setIsLoading(true);
      try {
        const result =
          format === 'zip' ? await readZipFile(file) : await readSngFile(file);
        onLoaded(result);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to read file');
      } finally {
        setIsLoading(false);
      }
    },
    [onLoaded],
  );

  const handlePickFolder = useCallback(async () => {
    if (isLoading) return;
    try {
      const dirHandle = await window.showDirectoryPicker({
        id: 'add-lyrics-chart',
      });
      setIsLoading(true);
      const result = await readChartDirectory(dirHandle);
      onLoaded(result);
    } catch (e) {
      const err = e as DOMException;
      if (err?.name === 'AbortError') return;
      toast.error(err?.message ?? 'Failed to read directory');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, onLoaded]);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handlePickFolder}
        disabled={isLoading}>
        <FolderOpen className="h-4 w-4 mr-2" />
        {isLoading ? 'Reading...' : 'Choose new chart'}
      </Button>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isLoading}
        className="text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50">
        or pick a .zip / .sng file
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,.sng"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
