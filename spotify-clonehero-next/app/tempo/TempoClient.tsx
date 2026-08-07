'use client';

/**
 * /tempo — browser tempo & time-signature mapper.
 *
 * Pick a standalone audio file or an existing chart (folder / .sng / .zip).
 * The page isolates the drums, finds beats on the full mix and the drum stem,
 * and converts them to a tempo map. Standalone audio gets a brand-new chart;
 * an existing chart gets a copy whose SyncTrack is swapped for the prediction
 * (every note keeps its audio time), with an Original ↔ New comparison view.
 */

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, FolderSearch, Music} from 'lucide-react';

import {
  defaultIniChartModifiers,
  parseChartFile,
  writeChartFolder,
  type ChartDocument,
  type File as ScanFile,
  type ParsedChart,
} from '@eliwhite/scan-chart';
import {Button} from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {Switch} from '@/components/ui/switch';
import {
  findAudioFiles,
  type Files,
} from '@/lib/preview/chorus-chart-processing';
import {interleaveAudioBuffer} from '@/lib/drum-transcription/audio/decoder';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import {readChart} from '@/lib/chart-edit';
import {isWebGPUAvailable} from '@/lib/drum-transcription/ml/onnx-runtime';
import ChartDropZone from '@/components/chart-picker/ChartDropZone';
import type {
  LoadedFiles,
  SourceFormat,
} from '@/components/chart-picker/chart-file-readers';
import ConnectedProcessingView from '@/components/assist/ConnectedProcessingView';
import SectionDropZone from '@/components/landing/SectionDropZone';
import AudioUploader from '@/app/drum-transcription/components/AudioUploader';

import {TempoLanding} from './landing/TempoLanding';

import {mergeAudioFiles} from '@/lib/tempo-map/merge-audio';
import {swapSynctrack} from '@/lib/tempo-map/swap-synctrack';
import {buildChartFromSynctrack} from '@/lib/tempo-map/build-chart';
import type {Synctrack} from '@/lib/tempo-map/types';
import {
  METER_CONFIDENCE_THRESHOLD,
  type MeterStats,
} from '@/lib/tempo-map/meter-confidence';

import {useAssistRunnerControls} from '@/components/assist/useAssistRunner';
import {
  generateTempoMapTask,
  type GenerateTempoMapInput,
  type GenerateTempoMapResult,
} from '@/lib/assist/tasks/generate-tempo-map';
import type {AssistTaskDef} from '@/lib/assist/tasks/types';
import {isAbortError} from '@/lib/workers/abortable-worker';

import ChartEditor from '@/components/chart-editor/ChartEditor';
import type {AssetFile} from '@/components/chart-editor/ExportDialog';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '@/components/chart-editor/ChartEditorContext';
import {AudioServiceProvider} from '@/components/chart-editor/AudioServiceContext';
import {TEMPO_CAPABILITIES} from '@/components/chart-editor/capabilities';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '@/components/chart-editor/scope';
import {
  usePaddedAudio,
  stemPcm,
} from '@/components/chart-editor/hooks/usePaddedAudio';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Variant = 'original' | 'new';

interface ResultState {
  mode: 'audio' | 'chart';
  name: string;
  /** Files fed to the AudioManager (chart stems or the uploaded song). */
  audioFiles: Files;
  /** Present in chart mode only. */
  originalChart: ParsedChart | null;
  /**
   * Non-chart passthrough assets (audio, album art, song.ini, …) to attach
   * to the chart doc ResultsView builds — the original chart's assets in
   * chart mode, or a synthesized `song.<ext>` audio asset in audio mode.
   * Used both for re-deriving the new chart when toggling snap and as the
   * live `ChartDocument.assets` the editor (and export) work from.
   */
  chartAssets: ScanFile[];
  modifiers: typeof defaultIniChartModifiers;
  /** Audio-mode precomputed chart (no notes, nothing to snap). */
  newChart: ParsedChart;
  synctrack: Synctrack;
  /** Meter regularity from the pipeline (null = too short to measure). */
  meterStats: MeterStats | null;
  /** Separated drum stem the pipeline transcribed, for the piano-roll and
   * highway waveforms. Planar `{left, right}`; null if separation failed. */
  drumStemStereo: {left: Float32Array; right: Float32Array} | null;
  /** 'sng' downloads as .sng, everything else as .zip. */
  sourceFormat: SourceFormat | null;
}

const PRO_DRUMS_MODIFIERS = {
  ...defaultIniChartModifiers,
  pro_drums: true,
} as const;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function buildMetadata(
  name: string,
  songLengthMs: number,
): ChartResponseEncore {
  return {
    name,
    artist: '',
    charter: '',
    md5: name,
    hasVideoBackground: false,
    albumArtMd5: '',
    notesData: {} as any,
    modifiedTime: '',
    file: '',
    song_length: songLengthMs,
  } as ChartResponseEncore;
}

function basename(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}

async function decodeStandaloneAudio(bytes: Uint8Array): Promise<AudioBuffer> {
  return mergeAudioFiles([{fileName: 'song', data: bytes}]);
}

/** Serialize a chart + assets and re-parse the chart file so every derived
 * field (msTime etc.) is consistent — same data path the chart will take
 * after the user downloads it. */
function writeAndReparse(
  chart: ParsedChart,
  assets: ScanFile[],
  modifiers: typeof defaultIniChartModifiers,
): {chart: ParsedChart; files: ScanFile[]} {
  const files = writeChartFolder({parsedChart: chart, assets});
  const chartFile = files.find(
    f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
  );
  if (!chartFile) throw new Error('Failed to write the new chart');
  const format = chartFile.fileName.endsWith('.mid') ? 'mid' : 'chart';
  const chartBytes = new Uint8Array(chartFile.data);
  const reparsed = parseChartFile(chartBytes, format, modifiers);
  // parseChartFile returns the narrow shape; re-stitch the wide ParsedChart
  // fields the renderers and a future re-export expect.
  return {
    chart: {
      ...reparsed,
      // Carry over ini-derived metadata (delay, song_length, name…) that the
      // chart file itself doesn't store.
      metadata: {...chart.metadata, ...reparsed.metadata},
      chartBytes,
      format,
      iniChartModifiers: modifiers,
    } as ParsedChart,
    files,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface TempoClientProps {
  /** Test seam: override the `generate-tempo-map` assist task, e.g. one
   *  built with `makeGenerateTempoMapTask({createWorker: ...})` so tests can
   *  script its worker instead of spawning the real one. Defaults to the
   *  shared `generateTempoMapTask` singleton. */
  task?: AssistTaskDef<GenerateTempoMapResult, GenerateTempoMapInput>;
}

export default function TempoClient({
  task = generateTempoMapTask,
}: TempoClientProps = {}) {
  const [webGPU, setWebGPU] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<
    'pick' | 'pick-audio' | 'pick-chart' | 'processing' | 'results'
  >('pick');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultState | null>(null);
  const [variant, setVariant] = useState<Variant>('new');

  /** Set by Cancel while the page is still reading/decoding the input, before
   *  the run exists for the runner to abort. Checked once that work is done,
   *  so Cancel in that window really does return to the picker. */
  const cancelBeforeRunRef = useRef(false);

  // The page's single assist runner. Not shared with an editor here (this
  // page IS the tempo-generation flow), so it's owned locally rather than
  // through `AssistRunnerProvider`.
  const {
    store: assistStore,
    start: startAssistTask,
    cancel: cancelAssistTask,
  } = useAssistRunnerControls();

  /** Cancel means one thing on this screen: stop whatever is running and go
   *  back to the picker. It is the same affordance before the run exists,
   *  during it, and after a failure (where `ProcessingView` labels it
   *  "Back"). */
  const backToPicker = useCallback(() => {
    cancelBeforeRunRef.current = true;
    cancelAssistTask();
    setError(null);
    setPhase('pick');
  }, [cancelAssistTask]);

  useEffect(() => {
    isWebGPUAvailable().then(setWebGPU);
  }, []);

  // ---------- the pipeline ----------
  const process = useCallback(
    async (
      input: {kind: 'audio'; file: File} | {kind: 'chart'; loaded: LoadedFiles},
    ) => {
      setPhase('processing');
      setError(null);
      setVariant('new');
      cancelBeforeRunRef.current = false;

      try {
        let name: string;
        let audioFiles: Files;
        let originalChart: ParsedChart | null = null;
        let chartAssets: ScanFile[] = [];
        let sourceFormat: SourceFormat | null = null;
        let originalBytes: Uint8Array;
        let songLengthMs = 0;
        /** The audio the task analyzes. Chart mode mixes the chart's stems
         *  down to one buffer, so beat tracking sees the whole song rather
         *  than whichever stem the fingerprint happens to be taken from;
         *  audio mode hands back the buffer decoded below. */
        let loadDecodedMix: (() => Promise<AudioBuffer>) | undefined;

        if (input.kind === 'audio') {
          const bytes = new Uint8Array(await input.file.arrayBuffer());
          originalBytes = bytes;
          name = basename(input.file.name);
          audioFiles = [{fileName: input.file.name, data: bytes}];
          // Audio mode has no chart of its own to derive a length from, so
          // the file is decoded here; the task analyzes this same buffer
          // rather than decoding the bytes a second time.
          const audioBuffer = await decodeStandaloneAudio(bytes);
          songLengthMs = audioBuffer.duration * 1000;
          loadDecodedMix = async () => audioBuffer;
        } else {
          const {loaded} = input;
          name = loaded.originalName;
          sourceFormat = loaded.sourceFormat;
          const doc = readChart(loaded.files, {pro_drums: true});
          originalChart = doc.parsedChart;
          chartAssets = doc.assets;
          audioFiles = findAudioFiles(loaded.files);
          if (audioFiles.length === 0) {
            throw new Error('This chart has no audio files to analyze.');
          }
          // Hash the chart's first audio file for the drum-stem cache.
          originalBytes = audioFiles[0].data;
          const stems = audioFiles;
          loadDecodedMix = () => mergeAudioFiles(stems);
        }

        if (cancelBeforeRunRef.current) {
          setPhase('pick');
          return;
        }

        const taskResult = await startAssistTask(task, {
          audio: {
            loadOriginalBytes: async () => originalBytes,
            loadDecodedMix,
          },
        });
        const sync = taskResult.synctrack;
        const drumStemStereo = taskResult.drumStemStereo;

        // Chart mode derives the new chart inside ResultsView (so the
        // snap-to-grid toggle can re-derive it); audio mode is fixed here.
        let newChart: ParsedChart;
        let modifiers = {...PRO_DRUMS_MODIFIERS};
        if (originalChart) {
          modifiers = {...originalChart.iniChartModifiers, pro_drums: true};
          newChart = originalChart; // placeholder; ResultsView derives the real one
        } else {
          const built = buildChartFromSynctrack({sync, songLengthMs});
          built.metadata.name = name;
          const audioAsset: ScanFile = {
            fileName: `song.${audioFiles[0].fileName.split('.').pop()}`,
            data: audioFiles[0].data,
          };
          chartAssets = [audioAsset];
          ({chart: newChart} = writeAndReparse(built, chartAssets, modifiers));
        }

        setResult({
          mode: input.kind,
          name,
          audioFiles,
          originalChart,
          chartAssets,
          modifiers,
          newChart,
          synctrack: sync,
          meterStats: taskResult.meterStats,
          drumStemStereo,
          sourceFormat,
        });
        setPhase('results');
      } catch (err) {
        if (isAbortError(err)) {
          // Cancelled: back to the picker.
          setPhase('pick');
          setError(null);
          return;
        }
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [startAssistTask, task],
  );

  // ---------- render ----------
  if (webGPU === false) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Your browser can’t run this tool</CardTitle>
            <CardDescription>
              Tempo mapping runs a separation model, a beat-tracking model, and
              a transcription model on your graphics card using WebGPU, which
              this browser doesn’t support. Try a recent version of Chrome or
              Edge on a computer.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (phase === 'processing') {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <ConnectedProcessingView
          store={assistStore}
          taskKey={task.key}
          title="Mapping the tempo"
          subtitle={undefined}
          error={error}
          onRetry={undefined}
          onCancel={backToPicker}
        />
      </main>
    );
  }

  if (phase === 'results' && result) {
    return (
      <ResultsView
        result={result}
        variant={variant}
        setVariant={setVariant}
        onBack={() => setPhase('pick')}
      />
    );
  }

  // pick / pick-audio / pick-chart: the landing page, whose action area is
  // this screen's own entry controls. The whole card is also a drop target,
  // so a song, a .zip/.sng or a chart folder can be dragged in from any of
  // those sub-states without clicking through to a picker first.
  return (
    <TempoLanding
      toolEntry={
        <SectionDropZone
          onAudioFile={file => process({kind: 'audio', file})}
          onChartLoaded={loaded => process({kind: 'chart', loaded})}>
          <Card className="w-full">
            <CardHeader>
              <CardDescription>
                Detects a song’s tempo and time signature right in your browser.
                Start from a song file to get a fresh chart, or from an existing
                chart to rebuild its tempo map without moving any notes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {phase === 'pick' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    className="h-28 flex flex-col gap-2"
                    onClick={() => setPhase('pick-audio')}>
                    <Music className="h-6 w-6" />
                    <span>Pick a song file</span>
                    <span className="text-xs text-muted-foreground font-normal">
                      mp3, ogg, opus, wav, flac…
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-28 flex flex-col gap-2"
                    onClick={() => setPhase('pick-chart')}>
                    <FolderSearch className="h-6 w-6" />
                    <span>Use an existing chart</span>
                    <span className="text-xs text-muted-foreground font-normal">
                      chart folder, .sng, or .zip
                    </span>
                  </Button>
                </div>
              )}
              {phase === 'pick-audio' && (
                <div className="space-y-3">
                  <AudioUploader
                    onFileSelected={file => process({kind: 'audio', file})}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPhase('pick')}
                    className="gap-1">
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </Button>
                </div>
              )}
              {phase === 'pick-chart' && (
                <div className="space-y-3">
                  <ChartDropZone
                    id="tempo-chart-picker"
                    onLoaded={loaded => process({kind: 'chart', loaded})}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPhase('pick')}
                    className="gap-1">
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Everything runs on your computer. Nothing is uploaded. The first
                run downloads about 515 MB of models: the drum separator, the
                beat tracker, and the transcription model whose drum hits the
                map is fitted to.
              </p>
            </CardContent>
          </Card>
        </SectionDropZone>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Results view (layout mirrors /tempo-viewer)
// ---------------------------------------------------------------------------

function ResultsView({
  result,
  variant,
  setVariant,
  onBack,
}: {
  result: ResultState;
  variant: Variant;
  setVariant: (v: Variant) => void;
  onBack: () => void;
}) {
  const [snapNotes, setSnapNotes] = useState(true);

  const irregularMeter =
    result.meterStats !== null &&
    result.meterStats.frac4 < METER_CONFIDENCE_THRESHOLD;
  // Warn once per result when the meter looks irregular. ResultsView mounts
  // fresh for each processed song, so lazy init opens the modal on mount.
  const [showMeterModal, setShowMeterModal] = useState(() => irregularMeter);

  const hasOriginal = result.originalChart !== null;

  // Chart mode: derive the new chart from the prediction, optionally
  // quantizing notes to the 24-slots-per-beat grid. Without snapping,
  // notes sit on fractional beat positions and notation renders as
  // rest/tuplet soup; with clean human-charted notes naive snapping is
  // the validated-correct quantizer (see autoresearch-subdiv).
  const derived = useMemo(() => {
    if (!result.originalChart) {
      return {newChart: result.newChart};
    }
    const swapped = swapSynctrack(
      result.originalChart,
      result.synctrack,
      snapNotes ? {quantizeNotes: true} : {},
    );
    const {chart} = writeAndReparse(
      swapped,
      result.chartAssets,
      result.modifiers,
    );
    return {newChart: chart};
  }, [result, snapNotes]);

  const currentChart =
    variant === 'original' && result.originalChart
      ? result.originalChart
      : derived.newChart;

  // The doc the shared editor loads into `ChartEditorContext`. Switching
  // variant/snap re-derives this and re-dispatches it into the editor —
  // `TempoEditor` guards that against discarding in-progress edits.
  const chartDoc = useMemo<ChartDocument>(
    () => ({parsedChart: currentChart, assets: result.chartAssets}),
    [currentChart, result.chartAssets],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden">
      {irregularMeter && result.meterStats && (
        <Dialog open={showMeterModal} onOpenChange={setShowMeterModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Irregular meter detected</DialogTitle>
              <DialogDescription>
                Only {Math.round(result.meterStats.frac4 * 100)}% of this
                song&apos;s measures look like steady 4/4.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              The beat grid and tempo map are still useful, but expect to set
              time signatures and check bar lines manually.
            </p>
            <DialogFooter>
              <Button onClick={() => setShowMeterModal(false)}>Got it</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <AudioServiceProvider>
        <ChartEditorProvider
          capabilities={TEMPO_CAPABILITIES}
          activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
          <TempoEditor
            result={result}
            chartDoc={chartDoc}
            hasOriginal={hasOriginal}
            variant={variant}
            setVariant={setVariant}
            snapNotes={snapNotes}
            setSnapNotes={setSnapNotes}
            onBack={onBack}
            meterStats={result.meterStats}
            onShowMeterInfo={() => setShowMeterModal(true)}
          />
        </ChartEditorProvider>
      </AudioServiceProvider>
    </div>
  );
}

/**
 * Renders the shared `ChartEditor` shell for the current variant/snap
 * selection — a child of `ChartEditorProvider` so it can dispatch the chart
 * doc and read `state.chartDoc` back. Owns the padded-AudioManager (single
 * full-mix source, no stems) via `usePaddedAudio`.
 */
function TempoEditor({
  result,
  chartDoc,
  hasOriginal,
  variant,
  setVariant,
  snapNotes,
  setSnapNotes,
  onBack,
  meterStats,
  onShowMeterInfo,
}: {
  result: ResultState;
  chartDoc: ChartDocument;
  hasOriginal: boolean;
  variant: Variant;
  setVariant: (v: Variant) => void;
  snapNotes: boolean;
  setSnapNotes: (v: boolean) => void;
  onBack: () => void;
  meterStats: MeterStats | null;
  onShowMeterInfo: () => void;
}) {
  const {state, dispatch} = useChartEditorContext();

  useEffect(() => {
    dispatch({type: 'SET_CHART_DOC', chartDoc});
  }, [chartDoc, dispatch]);

  // The variant/snap toggles re-derive `chartDoc` and re-dispatch it above,
  // which replaces whatever the user has edited in the session. Route
  // changes through a confirmation once the doc is dirty rather than
  // silently discarding edits (mirrors EditorApp's Regenerate confirm).
  const [pendingChange, setPendingChange] = useState<{
    label: string;
    apply: () => void;
  } | null>(null);
  const requestChange = useCallback(
    (label: string, apply: () => void) => {
      if (state.dirty) {
        setPendingChange({label, apply});
      } else {
        apply();
      }
    },
    [state.dirty],
  );

  // Decode the source audio into raw PCM (ORIGINAL, unpadded) — the same
  // audio for both variants. `usePaddedAudio` pads it to match the chart's
  // leading silence (if any) and owns the AudioManager.
  const [fullMixPcm, setFullMixPcm] = useState<Float32Array | null>(null);
  const [audioMeta, setAudioMeta] = useState<{
    sampleRate: number;
    channels: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    mergeAudioFiles(result.audioFiles).then(buffer => {
      if (cancelled) return;
      // interleaveAudioBuffer always emits 2 channels.
      setAudioMeta({sampleRate: buffer.sampleRate, channels: 2});
      setFullMixPcm(interleaveAudioBuffer(buffer));
    });
    return () => {
      cancelled = true;
    };
  }, [result.audioFiles]);

  // The pipeline's separator always runs at 44.1 kHz (SEPARATION_SAMPLE_RATE
  // in lib/tempo-map/pipeline-worker.ts) and the stem is never resampled
  // back to the source rate. `audioMeta.sampleRate` (from mergeAudioFiles)
  // is commonly 48 kHz for opus/ogg chart audio, so the stem must be
  // resampled to match before `usePaddedAudio` WAV-encodes and pads it at
  // `audioMeta.sampleRate` — otherwise it plays at the wrong speed and its
  // leading-silence padding (computed in that rate) misaligns the waveform.
  const STEM_SAMPLE_RATE = 44100;

  // Planar drum stem -> interleaved stereo at `audioMeta.sampleRate`, the
  // format usePaddedAudio/AudioManager expects. Resampling is async
  // (OfflineAudioContext), so this is an effect rather than a memo. Web
  // Audio's built-in resampler is fine here — this stem is only for the
  // waveform/playback UI, not fed back into Beat This!/CRNN, so the
  // soxr-vs-WebAudio precision concern that applies to the pipeline's own
  // resampling doesn't apply.
  const [drumStemInterleaved, setDrumStemInterleaved] =
    useState<Float32Array | null>(null);
  useEffect(() => {
    let cancelled = false;
    const interleave = (left: Float32Array, right: Float32Array) => {
      const n = Math.min(left.length, right.length);
      const out = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        out[i * 2] = left[i];
        out[i * 2 + 1] = right[i];
      }
      return out;
    };

    // All state writes happen inside this async closure (never synchronously
    // in the effect body) so the eslint set-state-in-effect rule is satisfied;
    // the sync paths just resolve a microtask later, which is harmless here.
    (async () => {
      const stem = result.drumStemStereo;
      if (!stem || !audioMeta) {
        if (!cancelled) setDrumStemInterleaved(null);
        return;
      }

      if (audioMeta.sampleRate === STEM_SAMPLE_RATE) {
        if (!cancelled)
          setDrumStemInterleaved(interleave(stem.left, stem.right));
        return;
      }

      const {left, right} = stem;
      const n = Math.min(left.length, right.length);
      const source = new AudioBuffer({
        numberOfChannels: 2,
        length: n,
        sampleRate: STEM_SAMPLE_RATE,
      });
      source.copyToChannel(left.slice(0, n), 0);
      source.copyToChannel(right.slice(0, n), 1);

      const targetRate = audioMeta.sampleRate;
      const offlineCtx = new OfflineAudioContext(
        2,
        Math.ceil((n * targetRate) / STEM_SAMPLE_RATE),
        targetRate,
      );
      const bufferSource = offlineCtx.createBufferSource();
      bufferSource.buffer = source;
      bufferSource.connect(offlineCtx.destination);
      bufferSource.start(0);
      const rendered = await offlineCtx.startRendering();
      if (cancelled) return;
      setDrumStemInterleaved(
        interleave(rendered.getChannelData(0), rendered.getChannelData(1)),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [result.drumStemStereo, audioMeta]);

  const paddedAudioStems = useMemo(
    () =>
      drumStemInterleaved
        ? [
            {
              name: 'drums',
              pcm: drumStemInterleaved,
              origin: 'ai-separated' as const,
            },
          ]
        : [],
    [drumStemInterleaved],
  );

  const {
    audioManager,
    fullMixPcm: audioPcm,
    stems: audioStems,
    durationSeconds,
    rebuilding: audioRebuilding,
  } = usePaddedAudio({
    chartDoc: state.chartDoc,
    audioMeta,
    fullMixPcm,
    stems: paddedAudioStems,
    onSongEnded: () => dispatch({type: 'SET_PLAYING', isPlaying: false}),
  });
  const drumStemPcm = stemPcm(audioStems, 'drums');

  const cloneHeroMetadata = useMemo(() => {
    const songLength = Math.max(
      chartDoc.parsedChart.metadata.song_length ?? 0,
      ...chartDoc.parsedChart.trackData
        .flatMap(t => t.noteEventGroups.flat())
        .map(n => n.msTime + (n.msLength || 0)),
    );
    return buildMetadata(result.name, songLength);
  }, [chartDoc, result.name]);

  // Serialize the LIVE `state.chartDoc` at export time (same
  // `writeChartFolder` path EditorApp's autosave uses) — not the
  // precomputed `chartDoc` prop — so in-editor tempo/TS/section edits and
  // leading-silence changes are actually in the download. `assets` (audio,
  // album art, ini, …) rides along on the doc through every command's
  // `cloneDocFor` (which spreads `...doc`), so it's still correct here.
  // `doc.parsedChart.format` (inherited from the source chart) decides
  // whether `writeChartFolder` emits `notes.chart` or `notes.mid` — no
  // separate audio-source callback is needed since the asset travels with
  // the doc either way.
  const writeCurrentChartFiles = useCallback((): ScanFile[] => {
    if (!state.chartDoc) throw new Error('Chart not loaded yet');
    return writeChartFolder(state.chartDoc);
  }, [state.chartDoc]);

  const getChartFile = useCallback(async () => {
    const files = writeCurrentChartFiles();
    const chartFileOut = files.find(
      f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
    );
    if (!chartFileOut) throw new Error('Failed to build the chart file');
    return {
      fileName: chartFileOut.fileName,
      data: chartFileOut.data,
    };
  }, [writeCurrentChartFiles]);

  const getExtraAssets = useCallback(async (): Promise<AssetFile[]> => {
    return writeCurrentChartFiles().filter(
      f => f.fileName !== 'notes.chart' && f.fileName !== 'notes.mid',
    );
  }, [writeCurrentChartFiles]);

  const chart = state.chartDoc?.parsedChart ?? null;
  if (!chart || !audioManager) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4">
        <p className="text-sm text-muted-foreground">Preparing editor...</p>
      </div>
    );
  }

  return (
    <>
      <AlertDialog
        open={pendingChange !== null}
        onOpenChange={open => {
          if (!open) setPendingChange(null);
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your edits?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingChange?.label} replaces the chart with a freshly derived
              one. Any tempo, time-signature, section, or leading-silence edits
              you&apos;ve made in this session will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                pendingChange?.apply();
                setPendingChange(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Discard edits
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ChartEditor
        metadata={cloneHeroMetadata}
        chart={chart}
        audioManager={audioManager}
        audioData={audioPcm ?? undefined}
        highwayAudioData={drumStemPcm ?? undefined}
        audioChannels={audioMeta?.channels ?? 2}
        durationSeconds={durationSeconds}
        sections={chart.sections}
        songName={`${result.name} (retempo)`}
        // Only the leading-silence card: this page IS tempo-map generation,
        // so a Tempo map card here would be a second door to what the page
        // already does, and it is not project-backed, so the drum/lyrics
        // cards have nothing to run against. `ChartAssist` renders the cards
        // it has wiring for and nothing else.
        chartAssist={{
          audioSampleRate: audioMeta?.sampleRate,
          audioBusyReason: audioRebuilding ? 'Rebuilding audio' : undefined,
        }}
        // Origins only: this page's stem list comes from its own separation
        // run, and it has no drop-to-add wiring, so the mixer here just
        // badges the separated drum stem.
        stemsMixer={{stemOrigins: audioStems}}
        getChartFile={getChartFile}
        getExtraAssets={getExtraAssets}
        defaultExportFormat={
          result.sourceFormat === 'sng'
            ? 'sng'
            : result.sourceFormat
              ? 'zip'
              : undefined
        }
        leftPanelChildren={
          <>
            {hasOriginal && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant={variant === 'original' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() =>
                      requestChange('Switch to the original chart', () =>
                        setVariant('original'),
                      )
                    }>
                    Original
                  </Button>
                  <Button
                    variant={variant === 'new' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() =>
                      requestChange('Switch to the new tempo map', () =>
                        setVariant('new'),
                      )
                    }>
                    New tempo map
                  </Button>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <Switch
                    checked={snapNotes}
                    onCheckedChange={checked =>
                      requestChange(
                        checked
                          ? 'Turn on snap-to-grid'
                          : 'Turn off snap-to-grid',
                        () => setSnapNotes(checked),
                      )
                    }
                  />
                  Snap notes to grid
                </label>
              </div>
            )}
            {meterStats && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onShowMeterInfo}>
                Meter info
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={onBack}>
              Start over
            </Button>
          </>
        }
      />
    </>
  );
}
