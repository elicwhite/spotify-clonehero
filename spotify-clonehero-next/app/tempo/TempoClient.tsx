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
import {FolderSearch, Music} from 'lucide-react';

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
import {Switch} from '@/components/ui/switch';
import {calculateTimeRemaining} from '@/lib/ui-utils';
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
import ProcessingView, {type ProcessingStep} from '@/components/ProcessingView';

import {
  runTempoTrack,
  type TempoTrackProgress,
} from '@/lib/drum-transcription/pipeline/tempo-track';
import {mergeAudioFiles} from '@/lib/tempo-map/merge-audio';
import {swapSynctrack} from '@/lib/tempo-map/swap-synctrack';
import {buildChartFromSynctrack} from '@/lib/tempo-map/build-chart';
import type {Synctrack} from '@/lib/tempo-map/types';
import {
  METER_CONFIDENCE_THRESHOLD,
  type MeterStats,
} from '@/lib/tempo-map/meter-confidence';

import ChartEditor from '@/components/chart-editor/ChartEditor';
import type {AssetFile} from '@/components/chart-editor/ExportDialog';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '@/components/chart-editor/ChartEditorContext';
import {TEMPO_CAPABILITIES} from '@/components/chart-editor/capabilities';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '@/components/chart-editor/scope';
import {usePaddedAudio} from '@/components/chart-editor/hooks/usePaddedAudio';
import LeadingSilenceButton from '@/app/drum-transcription/components/LeadingSilenceButton';

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
  /** Chart-mode inputs for re-deriving the new chart when toggling snap. */
  chartAssets: ScanFile[];
  modifiers: typeof defaultIniChartModifiers;
  /** Audio-mode precomputed chart (no notes, nothing to snap). */
  newChart: ParsedChart;
  synctrack: Synctrack;
  /** Meter regularity from the pipeline (null = too short to measure). */
  meterStats: MeterStats | null;
  /** writeChartFolder output for the download button (audio mode). */
  exportFiles: ScanFile[];
  /** 'sng' downloads as .sng, everything else as .zip. */
  sourceFormat: SourceFormat | null;
}

const PRO_DRUMS_MODIFIERS = {
  ...defaultIniChartModifiers,
  pro_drums: true,
} as const;

// ---------------------------------------------------------------------------
// Processing steps
// ---------------------------------------------------------------------------

const STEP_DEFS: Array<{key: string; label: string; description?: string}> = [
  {key: 'prepare', label: 'Reading your song'},
  {
    key: 'download-separation-model',
    label: 'Downloading the drum-separation model',
    description:
      'About 336 MB — only happens the first time, then it’s saved in your browser.',
  },
  {
    key: 'separate',
    label: 'Isolating the drums',
    description: 'Listening for just the drum kit. This is the longest step.',
  },
  {
    key: 'download-beat-model',
    label: 'Downloading the beat-finding model',
    description: 'About 83 MB — only happens the first time.',
  },
  {key: 'beats-fullmix', label: 'Finding the beat of the whole song'},
  {key: 'beats-drums', label: 'Finding the beat of the drums'},
  {key: 'convert', label: 'Building the tempo map'},
  {
    key: 'transcribe-drums',
    label: 'Listening to the drum hits',
    description:
      'Runs the same drum-transcription model as /drum-transcription, used ' +
      'here to anchor the tempo map to the actual kick/snare hits.',
  },
  {key: 'chart', label: 'Writing the chart'},
];

function initialSteps(): ProcessingStep[] {
  return STEP_DEFS.map(d => ({...d, status: 'pending'}));
}

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

export default function TempoClient() {
  const [webGPU, setWebGPU] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<
    'pick' | 'pick-chart' | 'processing' | 'results'
  >('pick');
  const [steps, setSteps] = useState<ProcessingStep[]>(initialSteps());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultState | null>(null);
  const [variant, setVariant] = useState<Variant>('new');

  const audioInputRef = useRef<HTMLInputElement>(null);
  const stepTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    isWebGPUAvailable().then(setWebGPU);
  }, []);

  // ---------- step bookkeeping ----------
  const updateStep = useCallback(
    (key: string, patch: Partial<ProcessingStep>) => {
      setSteps(prev => prev.map(s => (s.key === key ? {...s, ...patch} : s)));
    },
    [],
  );

  const startStep = useCallback((key: string) => {
    stepTimers.current[key] = Date.now();
    setSteps(prev =>
      prev.map(s => {
        if (s.key === key) return {...s, status: 'active'};
        // Anything still active before this step finished.
        if (s.status === 'active') {
          return {
            ...s,
            status: 'done',
            durationMs: Date.now() - (stepTimers.current[s.key] ?? Date.now()),
            etaSeconds: undefined,
            detail: undefined,
          };
        }
        return s;
      }),
    );
  }, []);

  const finishAll = useCallback(() => {
    setSteps(prev =>
      prev.map(s =>
        s.status === 'active'
          ? {
              ...s,
              status: 'done',
              durationMs:
                Date.now() - (stepTimers.current[s.key] ?? Date.now()),
              etaSeconds: undefined,
            }
          : s,
      ),
    );
  }, []);

  const onPipelineProgress = useCallback(
    (p: TempoTrackProgress) => {
      const key = p.stage;
      if (!stepTimers.current[key]) startStep(key);
      let etaSeconds = p.etaSeconds;
      if (
        etaSeconds === undefined &&
        p.percent !== undefined &&
        p.percent > 0
      ) {
        // Derive an ETA from elapsed time and fraction complete.
        const startedAt = new Date(stepTimers.current[key]);
        etaSeconds =
          calculateTimeRemaining(
            startedAt,
            100,
            Math.round(p.percent * 100),
            0,
          ) / 1000;
      }
      updateStep(key, {
        progress: p.percent,
        etaSeconds,
        detail: p.detail,
      });
    },
    [startStep, updateStep],
  );

  // ---------- the pipeline ----------
  const process = useCallback(
    async (
      input: {kind: 'audio'; file: File} | {kind: 'chart'; loaded: LoadedFiles},
    ) => {
      setPhase('processing');
      setError(null);
      setSteps(initialSteps());
      stepTimers.current = {};
      setVariant('new');

      try {
        startStep('prepare');

        let audioBuffer: AudioBuffer;
        let sourceBytes: ArrayBuffer | null = null;
        let name: string;
        let audioFiles: Files;
        let originalChart: ParsedChart | null = null;
        let chartAssets: ScanFile[] = [];
        let sourceFormat: SourceFormat | null = null;

        if (input.kind === 'audio') {
          const bytes = new Uint8Array(await input.file.arrayBuffer());
          sourceBytes = bytes.buffer.slice(0) as ArrayBuffer;
          name = basename(input.file.name);
          audioFiles = [{fileName: input.file.name, data: bytes}];
          audioBuffer = await decodeStandaloneAudio(bytes);
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
          audioBuffer = await mergeAudioFiles(audioFiles);
          // Hash the chart's first audio file for the drum-stem cache.
          const first = audioFiles[0].data;
          sourceBytes = first.buffer.slice(
            first.byteOffset,
            first.byteOffset + first.byteLength,
          ) as ArrayBuffer;
        }

        const pipelineResult = await runTempoTrack(audioBuffer, {
          sourceBytes,
          onProgress: onPipelineProgress,
        });

        startStep('chart');
        const sync = pipelineResult.synctrack;

        // Chart mode derives the new chart inside ResultsView (so the
        // snap-to-grid toggle can re-derive it); audio mode is fixed here.
        let newChart: ParsedChart;
        let exportFiles: ScanFile[] = [];
        let modifiers = {...PRO_DRUMS_MODIFIERS};
        if (originalChart) {
          modifiers = {...originalChart.iniChartModifiers, pro_drums: true};
          newChart = originalChart; // placeholder; ResultsView derives the real one
        } else {
          const built = buildChartFromSynctrack({
            sync,
            songLengthMs: audioBuffer.duration * 1000,
          });
          built.metadata.name = name;
          const audioAsset: ScanFile = {
            fileName: `song.${audioFiles[0].fileName.split('.').pop()}`,
            data: audioFiles[0].data,
          };
          ({chart: newChart, files: exportFiles} = writeAndReparse(
            built,
            [audioAsset],
            modifiers,
          ));
        }

        finishAll();
        setResult({
          mode: input.kind,
          name,
          audioFiles,
          originalChart,
          chartAssets,
          modifiers,
          newChart,
          synctrack: sync,
          meterStats: pipelineResult.meterStats,
          exportFiles,
          sourceFormat,
        });
        setPhase('results');
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [startStep, finishAll, onPipelineProgress],
  );

  // ---------- render ----------
  if (webGPU === false) {
    return (
      <main className="min-h-[60vh] flex items-center justify-center p-6">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Your browser can’t run this tool</CardTitle>
            <CardDescription>
              Tempo mapping runs AI models on your graphics card using WebGPU,
              which this browser doesn’t support. Try a recent version of Chrome
              or Edge on a computer.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (phase === 'processing') {
    return (
      <main className="min-h-[80vh] flex items-center justify-center p-6">
        <ProcessingView
          title="Mapping the tempo"
          subtitle={undefined}
          steps={steps}
          error={error}
          onRetry={undefined}
          onCancel={() => {
            setPhase('pick');
            setError(null);
          }}
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

  // pick / pick-chart
  return (
    <main className="min-h-[80vh] flex items-center justify-center p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Tempo Mapper</CardTitle>
          <CardDescription>
            Detects a song’s tempo and time signature right in your browser.
            Start from a song file to get a fresh chart, or from an existing
            chart to rebuild its tempo map without moving any notes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {phase === 'pick' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="h-28 flex flex-col gap-2"
                onClick={() => audioInputRef.current?.click()}>
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
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*,.opus,.ogg,.mp3,.wav,.flac,.m4a"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) process({kind: 'audio', file: f});
                  e.target.value = '';
                }}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <ChartDropZone
                id="tempo-chart-picker"
                onLoaded={loaded => process({kind: 'chart', loaded})}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPhase('pick')}>
                ← Back
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Everything runs on your computer — nothing is uploaded. The first
            run downloads two AI models (about 420 MB total) that are then saved
            in your browser.
          </p>
        </CardContent>
      </Card>
    </main>
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
      return {newChart: result.newChart, exportFiles: result.exportFiles};
    }
    const swapped = swapSynctrack(
      result.originalChart,
      result.synctrack,
      snapNotes ? {quantizeNotes: true} : {},
    );
    const {chart, files} = writeAndReparse(
      swapped,
      result.chartAssets,
      result.modifiers,
    );
    return {newChart: chart, exportFiles: files};
  }, [result, snapNotes]);

  const currentChart =
    variant === 'original' && result.originalChart
      ? result.originalChart
      : derived.newChart;

  // The doc the shared editor loads into `ChartEditorContext`. Downloads
  // always export the retempoed (`derived`) chart — the variant toggle only
  // changes what's shown, matching the pre-shared-editor behavior.
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
      <ChartEditorProvider
        capabilities={TEMPO_CAPABILITIES}
        activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
        <TempoEditor
          result={result}
          chartDoc={chartDoc}
          exportFiles={derived.exportFiles}
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
  exportFiles,
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
  exportFiles: ScanFile[];
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

  const {
    audioManager,
    fullMixPcm: audioPcm,
    durationSeconds,
    rebuilding: audioRebuilding,
  } = usePaddedAudio({
    chartDoc: state.chartDoc,
    audioMeta,
    fullMixPcm,
    onSongEnded: () => dispatch({type: 'SET_PLAYING', isPlaying: false}),
  });

  const cloneHeroMetadata = useMemo(() => {
    const songLength = Math.max(
      chartDoc.parsedChart.metadata.song_length ?? 0,
      ...chartDoc.parsedChart.trackData
        .flatMap(t => t.noteEventGroups.flat())
        .map(n => n.msTime + (n.msLength || 0)),
    );
    return buildMetadata(result.name, songLength);
  }, [chartDoc, result.name]);

  // Downloads always bundle the retempoed chart (`exportFiles`), whichever
  // variant is currently on screen — matching the pre-shared-editor
  // behavior. Non-chart files (audio, album art, …) ride along verbatim as
  // passthrough assets, so no separate `getAudioSources` is needed.
  const getChartFile = useCallback(async () => {
    const chartFileOut = exportFiles.find(
      f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
    );
    if (!chartFileOut) throw new Error('Failed to build the chart file');
    return {
      fileName: chartFileOut.fileName,
      data: chartFileOut.data,
    };
  }, [exportFiles]);

  const getExtraAssets = useCallback(async (): Promise<AssetFile[]> => {
    return exportFiles.filter(
      f => f.fileName !== 'notes.chart' && f.fileName !== 'notes.mid',
    );
  }, [exportFiles]);

  const chart = state.chartDoc?.parsedChart ?? null;
  if (!chart || !audioManager) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4">
        <p className="text-sm text-muted-foreground">Preparing editor...</p>
      </div>
    );
  }

  return (
    <ChartEditor
      metadata={cloneHeroMetadata}
      chart={chart}
      audioManager={audioManager}
      audioData={audioPcm ?? undefined}
      audioChannels={audioMeta?.channels ?? 2}
      durationSeconds={durationSeconds}
      sections={chart.sections}
      songName={`${result.name} (retempo)`}
      dirty={state.dirty}
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
                  onClick={() => setVariant('original')}>
                  Original
                </Button>
                <Button
                  variant={variant === 'new' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => setVariant('new')}>
                  New tempo map
                </Button>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <Switch checked={snapNotes} onCheckedChange={setSnapNotes} />
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
          {audioMeta && (
            <LeadingSilenceButton
              sampleRate={audioMeta.sampleRate}
              disabled={audioRebuilding}
            />
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
  );
}
