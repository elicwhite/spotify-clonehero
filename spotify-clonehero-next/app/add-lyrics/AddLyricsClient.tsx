'use client';

import {useEffect, useState, useCallback, useRef, useMemo} from 'react';
import {
  AudioWaveform,
  ClipboardPaste,
  Download,
  FolderOpen,
  Move,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import {toast} from 'sonner';
import {parseChartFile} from '@eliwhite/scan-chart';
import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {getExtension, getBasename} from '@/lib/src-shared/utils';
import {removeStyleTags} from '@/lib/ui-utils';
import {
  findAudioFiles,
  type Files,
} from '@/lib/preview/chorus-chart-processing';
import {readChart, type ChartDocument} from '@/lib/chart-edit';
import {downloadBlob} from '@/lib/download';
import {buildChartExport} from './export-chart';
import type {AlignedSyllable} from '@/lib/lyrics-align/aligner';
import {applyAlignedLyricsToDoc} from '@/lib/lyrics-align/apply-lyrics';
import {
  detectFormat,
  readChartDirectory,
  readSngFile,
  readZipFile,
  type LoadedFiles,
  type SourceFormat,
} from '@/components/chart-picker/chart-file-readers';
import ChartDropZone from '@/components/chart-picker/ChartDropZone';
import ConnectedProcessingView from '@/components/assist/ConnectedProcessingView';
import {
  ChartEditorProvider,
  DEFAULT_VOCALS_SCOPE,
  useChartEditorContext,
  ADD_LYRICS_CAPABILITIES,
  AudioServiceProvider,
  useAudioServiceContext,
} from '@/components/chart-editor';
import ChartEditor from '@/components/chart-editor/ChartEditor';
import EditorHeaderRow from '@/components/chart-editor/EditorHeaderRow';
import {MoveEntitiesCommand} from '@/components/chart-editor/commands';
import {track} from '@/lib/analytics/track';
import {AudioManager} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import {useAssistRunnerControls} from '@/components/assist/useAssistRunner';
import {
  addLyricsTask,
  type AddLyricsInput,
} from '@/lib/assist/tasks/add-lyrics';
import {isAbortError} from '@/lib/workers/abortable-worker';
import {audioSamples} from '@/components/chart-editor/audioSamples';

type ParsedChart = ReturnType<typeof parseChartFile>;

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
  | 'done'
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
  // Our chart-file-readers already produce that shape
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

/** Decode audio into an interleaved Float32 PCM buffer for waveform display. */
async function decodeAudioForWaveform(
  data: Uint8Array,
): Promise<{interleaved: Float32Array; channels: number} | null> {
  try {
    const ctx = new AudioContext({sampleRate: 44100});
    try {
      const buf = data.slice(0).buffer as ArrayBuffer;
      const decoded = await ctx.decodeAudioData(buf);
      const channels = decoded.numberOfChannels;
      const length = decoded.length;
      const interleaved = new Float32Array(length * channels);
      for (let ch = 0; ch < channels; ch++) {
        const channelData = decoded.getChannelData(ch);
        for (let i = 0; i < length; i++) {
          interleaved[i * channels + ch] = channelData[i];
        }
      }
      return {interleaved, channels};
    } finally {
      await ctx.close();
    }
  } catch (err) {
    console.warn('Could not decode audio for waveform display', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

/**
 * The non-chart half of the editor view: the audio and waveform the
 * ChartEditor needs alongside the document. The chart itself is read from
 * the editor session (`state.chartDoc`) so it stays live as the user edits;
 * nothing chart-shaped is snapshotted here.
 */
interface EditorData {
  audioManager: AudioManager;
  audioData?: Float32Array | undefined;
  audioChannels: number;
  durationSeconds: number;
}

export default function AddLyricsClient() {
  return (
    <AudioServiceProvider>
      <ChartEditorProvider
        capabilities={ADD_LYRICS_CAPABILITIES}
        activeScope={DEFAULT_VOCALS_SCOPE}>
        <LyricsAlignInner />
      </ChartEditorProvider>
    </AudioServiceProvider>
  );
}

// Lyric/phrase entity kinds counted toward "manual moves" before export.
const LYRIC_MOVE_KINDS: ReadonlySet<string> = new Set([
  'lyric',
  'phrase-start',
  'phrase-end',
]);

function LyricsAlignInner() {
  const {state, dispatch} = useChartEditorContext();
  const {setAudioManager: publishAudioManager} = useAudioServiceContext();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [chart, setChart] = useState<LoadedChart | null>(null);
  const [lyrics, setLyrics] = useState('');
  const [alignedSyllables, setAlignedSyllables] = useState<AlignedSyllable[]>(
    [],
  );
  const [showLyricsWarning, setShowLyricsWarning] = useState(false);
  /**
   * Float32 16kHz mono PCM of the vocals stem used for alignment. Either
   * the chart's existing stem (resampled) or the AI-separated stem from
   * Demucs. Used as the highway's waveform source — never written into
   * the downloaded chart.
   */
  const [vocalsWaveform, setVocalsWaveform] = useState<Float32Array | null>(
    null,
  );
  const [editorData, setEditorData] = useState<EditorData | null>(null);
  // Wrapped once per buffer — see `components/chart-editor/audioSamples.ts`.
  const samples = useMemo(
    () => audioSamples(editorData?.audioData),
    [editorData?.audioData],
  );
  const [showIntroModal, setShowIntroModal] = useState(false);
  const initStartedRef = useRef(false);

  // The page's own assist runner — nothing else on this page shares it, so
  // it doesn't need the editor's `AssistRunnerProvider`/context; the same
  // `add-lyrics` task, `run-to-steps.ts` adapter, and cancellation contract
  // as the in-editor `AddLyricsDialog` and `/drum-transcription`.
  const runner = useAssistRunnerControls();
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

  // Tear down any AudioManager + audio decode state when leaving the results
  // view (Re-enter lyrics, chart reload) or unmounting the page.
  useEffect(() => {
    return () => {
      if (editorData) {
        editorData.audioManager.destroy();
      }
    };
  }, [editorData]);

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

  const handleAlign = useCallback(async () => {
    if (!chart || !lyrics.trim()) return;

    setError(null);
    setAlignedSyllables([]);
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
      let result = await runner.start(addLyricsTask, input);

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
        result = await runner.start(addLyricsTask, {
          lyrics,
          vocals: {
            kind: 'stems',
            stems: chart.audioFiles.map(f => ({
              data: f.data,
              mimeType: getMimeForExtension(getExtension(f.fileName)),
            })),
          },
        });
      }

      // The task hands back a buffer it kept out of the alignment worker's
      // transfer list, so it is already the caller's to render. Never
      // serialized into the downloaded chart.
      setVocalsWaveform(result.vocals16k);
      setAlignedSyllables(result.syllables);
      setStatus('done');
      track({
        event: 'add_lyrics_align_completed',
        totalMs: Date.now() - alignStartedAt,
        lowConfidence: result.lowConfidence ? 1 : 0,
        lowConfidenceFrac: Math.round(result.lowConfidenceFrac * 100) / 100,
      });
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
  }, [chart, lyrics, runner]);

  const handleDownload = useCallback(() => {
    // Export the editor's live document. It starts as the aligned doc and
    // every highway edit (lyric drags, phrase resizes, text changes) is
    // dispatched onto it, so it is the only doc that carries the user's
    // manual fixes. Re-deriving from `chart.chartDoc` would discard them.
    const doc = state.chartDoc;
    if (!chart || !doc) return;

    try {
      const {blob, fileName} = buildChartExport(
        doc,
        chart.sourceFormat,
        chart.originalName,
      );

      downloadBlob(blob, fileName);

      const manualMoveCount = state.undoEntries.filter(
        ({command}) =>
          command instanceof MoveEntitiesCommand &&
          LYRIC_MOVE_KINDS.has(command.kind),
      ).length;
      track({
        event: 'add_lyrics_exported',
        format: chart.sourceFormat === 'sng' ? 'sng' : 'zip',
        manualMoveCount,
      });

      toast.success('Chart exported with lyrics');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    }
  }, [chart, state.chartDoc, state.undoEntries]);

  const showEditor = status === 'done' && alignedSyllables.length > 0;

  // Prepare the ChartEditor view when alignment completes. Builds a fresh
  // ChartDocument with the aligned lyrics applied, a running AudioManager,
  // and a decoded PCM buffer for the waveform display.
  useEffect(() => {
    if (!showEditor || !chart || alignedSyllables.length === 0) return;
    if (editorData) return; // already prepared

    let cancelled = false;
    let createdAudioManager: AudioManager | null = null;
    (async () => {
      try {
        const nextDoc = applyAlignedLyricsToDoc(
          chart.chartDoc,
          alignedSyllables,
        );

        const audioManager = new AudioManager(chart.audioFiles, () => {
          dispatch({type: 'SET_PLAYING', isPlaying: false});
        });
        createdAudioManager = audioManager;
        await audioManager.ready;
        if (cancelled) {
          audioManager.destroy();
          return;
        }
        audioManager.setChartDelay(
          getChartDelayMs(nextDoc.parsedChart.metadata) / 1000,
        );

        // Highway waveform: prefer the same vocals buffer used during
        // alignment (16kHz mono Float32 from `vocalsWaveform`). Falls back
        // to decoding the song mix only if alignment somehow ran without
        // populating that state. The waveform display is a visual cue, so
        // a 16kHz mono source plots fine across the song duration.
        const waveform: {interleaved: Float32Array; channels: number} | null =
          vocalsWaveform
            ? {interleaved: vocalsWaveform, channels: 1}
            : await decodeAudioForWaveform(chart.audioFiles[0].data);
        if (cancelled) {
          audioManager.destroy();
          return;
        }

        const durationSeconds = audioManager.duration;

        publishAudioManager(audioManager);
        dispatch({type: 'SET_CHART_DOC', chartDoc: nextDoc});

        setEditorData({
          audioManager,
          audioData: waveform?.interleaved,
          audioChannels: waveform?.channels ?? 1,
          durationSeconds,
        });

        // Open the intro modal once per browser, the first time the user
        // lands in the editor. Versioned key so a future copy update (v2)
        // re-fires once for returning users.
        const INTRO_KEY = 'add-lyrics:editor-intro-shown-v1';
        if (
          typeof localStorage !== 'undefined' &&
          !localStorage.getItem(INTRO_KEY)
        ) {
          setShowIntroModal(true);
          localStorage.setItem(INTRO_KEY, '1');
        }

        // add-lyrics defaults to the waveform highway since the user is
        // syncing lyrics to vocal energy, not navigating notes.
        dispatch({type: 'SET_HIGHWAY_MODE', mode: 'waveform'});
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to prepare chart editor:', err);
        toast.error(
          err instanceof Error ? err.message : 'Failed to prepare preview',
        );
        createdAudioManager?.destroy();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    showEditor,
    chart,
    alignedSyllables,
    editorData,
    vocalsWaveform,
    dispatch,
    publishAudioManager,
  ]);

  const cloneHeroMetadata = useMemo<ChartResponseEncore | null>(() => {
    if (!chart) return null;
    const md = chart.chartDoc.parsedChart.metadata;
    return {
      name: md.name ?? 'Unknown',
      artist: md.artist ?? 'Unknown',
      charter: md.charter ?? 'Unknown',
      md5: '',
      hasVideoBackground: false,
      albumArtMd5: '',
      notesData: {} as ChartResponseEncore['notesData'],
      modifiedTime: '',
      file: '',
    } as ChartResponseEncore;
  }, [chart]);

  // The chart the editor renders, read live from the session so highway
  // edits reach every consumer (sheet-music pane, section list) rather than
  // only the parts the scene reconciler redraws.
  const editorChart = (state.chartDoc?.parsedChart ??
    null) as ParsedChart | null;

  if (showEditor && chart) {
    const md = chart.chartDoc.parsedChart.metadata;
    const songName = md.name ?? 'Unknown';
    const artistName = md.artist ?? 'Unknown';
    const charterName = md.charter ?? 'Unknown';
    return (
      <main className="h-screen w-screen flex flex-col bg-background overflow-hidden">
        {/* This page's own 52px song-identity row, directly beneath the
            site's compact header (`components/CompactSiteHeader.tsx`) - the same
            row `ChartEditor` renders on other editor pages, which is why the
            editor below is passed `hideHeader`. Identity runs on one line so
            the row stays a single bar. */}
        <EditorHeaderRow>
          <div className="flex min-w-0 mr-auto items-baseline gap-2">
            <h1 className="text-sm font-semibold truncate">
              {removeStyleTags(songName)}
              <span className="text-muted-foreground font-normal"> by </span>
              {removeStyleTags(artistName)}
            </h1>
            <span className="text-xs text-muted-foreground truncate">
              {alignedSyllables.length} syllables aligned into{' '}
              {alignedSyllables.filter(s => s.newLine).length} lines
            </span>
          </div>
          <span className="hidden sm:inline shrink-0 text-xs text-muted-foreground">
            Drag any lyric to fix its timing
          </span>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => {
              if (editorData) {
                editorData.audioManager.destroy();
              }
              publishAudioManager(null);
              setEditorData(null);
              setAlignedSyllables([]);
              setVocalsWaveform(null);
              setStatus('input');
              track({event: 'add_lyrics_realign'});
            }}>
            Re-enter lyrics
          </Button>
          {/* Disabled until the editor is prepared: until then the session
              doc is still the previous alignment's (or nothing at all), and
              exporting it would hand back the wrong chart. */}
          <Button
            size="sm"
            className="shrink-0"
            onClick={handleDownload}
            disabled={!editorData}>
            <Download className="h-4 w-4 mr-1" />
            Download .{chart.sourceFormat === 'sng' ? 'sng' : 'zip'}
          </Button>
        </EditorHeaderRow>
        <Dialog open={showIntroModal} onOpenChange={setShowIntroModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Your lyrics are aligned</DialogTitle>
              <DialogDescription>
                A few things worth knowing before you fine-tune.
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <Move className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <span>
                  <strong>Drag any lyric</strong> on the highway to nudge its
                  timing. Useful when the aligner picked the wrong onset.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <AudioWaveform className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <span>
                  The waveform on the highway is the{' '}
                  <strong>isolated vocal stem</strong>, not the full song mix —
                  easier to spot where each line should sit.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Download className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <span>
                  When the timing looks right, hit <strong>Download</strong> in
                  the top-right to get the updated chart.
                </span>
              </li>
            </ul>
            <DialogFooter>
              <Button onClick={() => setShowIntroModal(false)}>Got it</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <div className="flex-1 min-h-0">
          {editorData && cloneHeroMetadata && editorChart ? (
            <ChartEditor
              chart={editorChart}
              audioManager={editorData.audioManager}
              audioData={samples}
              audioChannels={editorData.audioChannels}
              durationSeconds={editorData.durationSeconds}
              sections={editorChart.sections}
              songName={songName}
              artistName={artistName}
              charterName={charterName}
              hideHeader
            />
          ) : (
            <div className="flex items-center justify-center gap-3 h-full">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground" />
              <p className="text-muted-foreground">Preparing preview...</p>
            </div>
          )}
        </div>
      </main>
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
            Paste your lyrics — they&rsquo;re automatically synced to the audio,
            syllable-by-syllable. Runs entirely in your browser.
          </p>
        </header>

        {/* Step 1: Landing — flow diagram + drop zone */}
        {(status === 'idle' || (status === 'error' && !chart)) && (
          <div className="space-y-8">
            {/* Flow diagram */}
            <div className="bg-muted rounded-xl p-6">
              <div className="flex items-center justify-between">
                <FlowStep Icon={FolderOpen} label="Open" desc="Your chart" />
                <FlowArrow />
                <FlowStep
                  Icon={ClipboardPaste}
                  label="Paste"
                  desc="Song lyrics"
                />
                <FlowArrow />
                <FlowStep Icon={AudioWaveform} label="Align" desc="Automatic" />
                <FlowArrow />
                <FlowStep
                  Icon={Download}
                  label="Download"
                  desc="Updated chart"
                />
              </div>
            </div>

            <ChartDropZone onLoaded={handleChartLoaded} id="add-lyrics-chart" />
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        )}

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

              {/* Existing lyrics warning */}
              {status !== 'processing' && showLyricsWarning && (
                <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 flex items-start gap-3">
                  <TriangleAlert className="h-4 w-4 mt-0.5 text-yellow-700 dark:text-yellow-300 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      This chart already has lyrics. Aligning will replace them.
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

              {/* Lyrics textarea + Align button. Hidden during processing
                  so the step list is the only thing in view. */}
              {status !== 'processing' && (
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
// Flow diagram bits
// ---------------------------------------------------------------------------

function FlowStep({
  Icon,
  label,
  desc,
}: {
  Icon: LucideIcon;
  label: string;
  desc: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 min-w-0">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-background">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </span>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{desc}</span>
    </div>
  );
}

function FlowArrow() {
  return (
    <svg
      className="w-10 h-6 text-muted-foreground/30 flex-shrink-0"
      fill="currentColor"
      viewBox="0 0 40 24">
      <path d="M0 9h28l-6-6 3-3 12 12-12 12-3-3 6-6H0z" />
    </svg>
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
