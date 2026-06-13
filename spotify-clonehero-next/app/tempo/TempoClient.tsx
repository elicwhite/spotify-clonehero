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
import {
  AudioWaveform,
  Download,
  FolderSearch,
  Loader2,
  Music,
  Pause,
  Play,
} from 'lucide-react';
import {toast} from 'sonner';

import {
  defaultIniChartModifiers,
  parseChartFile,
  writeChartFolder,
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
import {Slider} from '@/components/ui/slider';
import {Switch} from '@/components/ui/switch';
import {cn} from '@/lib/utils';
import {calculateTimeRemaining} from '@/lib/ui-utils';
import {
  findAudioFiles,
  type Files,
} from '@/lib/preview/chorus-chart-processing';
import {AudioManager} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import {readChart} from '@/lib/chart-edit';
import {exportAsZip, exportAsSng} from '@/lib/chart-export';
import {downloadBlob} from '@/lib/download';
import {isWebGPUAvailable} from '@/lib/drum-transcription/ml/onnx-runtime';
import ChartDropZone from '@/components/chart-picker/ChartDropZone';
import type {
  LoadedFiles,
  SourceFormat,
} from '@/components/chart-picker/chart-file-readers';
import ProcessingView, {type ProcessingStep} from '@/components/ProcessingView';

import {runTempoPipeline} from '@/lib/tempo-map/pipeline-client';
import {mergeAudioFiles} from '@/lib/tempo-map/merge-audio';
import {swapSynctrack} from '@/lib/tempo-map/swap-synctrack';
import {buildChartFromSynctrack} from '@/lib/tempo-map/build-chart';
import type {PipelineProgress, Synctrack} from '@/lib/tempo-map/types';

import SheetMusic from '@/app/sheet-music/[slug]/SheetMusic';
import CloneHeroRenderer from '@/app/sheet-music/[slug]/CloneHeroRenderer';

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

interface TempoTsEntry {
  tick: number;
  msTime: number;
  kind: 'tempo' | 'ts';
  label: string;
}

function buildEventList(chart: ParsedChart): TempoTsEntry[] {
  const entries: TempoTsEntry[] = [];
  for (const t of chart.tempos) {
    entries.push({
      tick: t.tick,
      msTime: t.msTime,
      kind: 'tempo',
      label: `${t.beatsPerMinute.toFixed(2)} BPM`,
    });
  }
  for (const ts of chart.timeSignatures) {
    entries.push({
      tick: ts.tick,
      msTime: ts.msTime,
      kind: 'ts',
      label: `${ts.numerator}/${ts.denominator}`,
    });
  }
  entries.sort((a, b) => a.tick - b.tick || (a.kind === 'ts' ? -1 : 1));
  return entries;
}

function formatTimeMs(ms: number): string {
  if (!isFinite(ms)) return '0:00';
  const total = Math.max(0, ms);
  const mins = Math.floor(total / 60000);
  const secs = Math.floor((total % 60000) / 1000);
  return `${mins}:${String(secs).padStart(2, '0')}`;
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
    (p: PipelineProgress) => {
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

        const pipelineResult = await runTempoPipeline(audioBuffer, {
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
  const [audioManager, setAudioManager] = useState<AudioManager | null>(null);
  const audioManagerRef = useRef<AudioManager | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [snapNotes, setSnapNotes] = useState(true);

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

  const handleDownload = useCallback(() => {
    const base = `${result.name} (retempo)`;
    if (result.sourceFormat === 'sng') {
      const sngBytes = exportAsSng(derived.exportFiles);
      downloadBlob(
        new Blob([sngBytes as Uint8Array<ArrayBuffer>], {
          type: 'application/octet-stream',
        }),
        `${base}.sng`,
      );
    } else {
      downloadBlob(exportAsZip(derived.exportFiles), `${base}.zip`);
    }
    toast.success('Chart downloaded');
  }, [result, derived]);

  const currentChart =
    variant === 'original' && result.originalChart
      ? result.originalChart
      : derived.newChart;

  // ---------- audio manager (same audio for both variants) ----------
  useEffect(() => {
    let cancelled = false;
    const manager = new AudioManager(result.audioFiles, () =>
      setIsPlaying(false),
    );
    manager.ready.then(() => {
      if (cancelled) {
        manager.destroy();
        return;
      }
      const delayMs = getChartDelayMs(result.newChart.metadata);
      manager.setChartDelay(delayMs / 1000);
      audioManagerRef.current = manager;
      setAudioManager(manager);
    });
    return () => {
      cancelled = true;
      manager.destroy();
      if (audioManagerRef.current === manager) {
        audioManagerRef.current = null;
        setAudioManager(null);
      }
    };
  }, [result]);

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      if (audioManagerRef.current) {
        setCurrentTime(audioManagerRef.current.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  const currentTrack = useMemo(() => {
    const expert = currentChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    return expert ?? currentChart.trackData[0] ?? null;
  }, [currentChart]);

  // SheetMusic's VexFlow parser requires at least one note; a standalone-audio
  // chart is just a tempo map with an empty drums track.
  const hasNotes = (currentTrack?.noteEventGroups.length ?? 0) > 0;

  const metadata = useMemo(() => {
    const songLength = Math.max(
      result.newChart.metadata.song_length ?? 0,
      ...currentChart.trackData
        .flatMap(t => t.noteEventGroups.flat())
        .map(n => n.msTime + (n.msLength || 0)),
    );
    return buildMetadata(result.name, songLength);
  }, [result, currentChart]);

  const eventList = useMemo(() => buildEventList(currentChart), [currentChart]);

  const lyrics = useMemo(
    () =>
      currentChart.vocalTracks.parts.vocals?.notePhrases.flatMap(
        p => p.lyrics,
      ) ?? [],
    [currentChart],
  );

  const seekToEntry = useCallback(
    (entry: TempoTsEntry) => {
      const am = audioManagerRef.current;
      if (!am) return;
      const sec = Math.max(0, entry.msTime / 1000);
      if (isPlaying) {
        am.playChartTime(sec);
      } else {
        am.seekToChartTime(sec);
      }
      setCurrentTime(am.currentTime);
    },
    [isPlaying],
  );

  const handlePlay = () => {
    const am = audioManagerRef.current;
    if (!am) return;
    if (isPlaying) {
      am.pause();
      setIsPlaying(false);
    } else if (!am.isInitialized) {
      am.play({time: 0});
      setIsPlaying(true);
    } else {
      am.resume();
      setIsPlaying(true);
    }
  };

  return (
    <main className="h-screen w-screen flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-card">
        <AudioWaveform className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium truncate max-w-md">
          {result.name}
        </span>

        {hasOriginal && (
          <div className="flex items-center gap-2 ml-4">
            <Button
              variant={variant === 'original' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setVariant('original')}>
              Original
            </Button>
            <Button
              variant={variant === 'new' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setVariant('new')}>
              New tempo map
            </Button>
            <label className="flex items-center gap-1.5 ml-2 text-xs text-muted-foreground cursor-pointer">
              <Switch checked={snapNotes} onCheckedChange={setSnapNotes} />
              Snap notes to grid
            </label>
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" />
            Download .{result.sourceFormat === 'sng' ? 'sng' : 'zip'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack}>
            Start over
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="rounded-full"
            disabled={!audioManager}
            onClick={handlePlay}>
            {isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5" />
            )}
          </Button>
          <span className="text-xs font-mono text-muted-foreground">
            {formatTimeMs(currentTime * 1000)}
          </span>
        </div>
      </div>

      {/* Seek bar */}
      {audioManager && (
        <div className="px-4 py-2 border-b">
          <Slider
            value={[currentTime]}
            min={0}
            max={audioManager.duration || 1}
            step={0.01}
            onValueChange={vals => {
              const t = vals[0];
              setCurrentTime(t);
              audioManager.play({time: t});
              setIsPlaying(true);
            }}
          />
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {/* Left: tempo / time-signature list */}
        <aside className="w-72 border-r flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b text-sm font-medium bg-muted/30">
            Tempo & Time Signature ({eventList.length})
          </div>
          <div className="flex-1 overflow-y-auto text-sm">
            {eventList.map((e, idx) => (
              <button
                key={`${e.tick}-${e.kind}-${idx}`}
                onClick={() => seekToEntry(e)}
                className={cn(
                  'w-full text-left px-3 py-1.5 border-b hover:bg-accent flex items-center gap-2 cursor-pointer',
                  e.kind === 'tempo'
                    ? 'text-purple-700 dark:text-purple-300'
                    : 'text-red-700 dark:text-red-300',
                )}>
                <span className="font-mono text-xs w-12 text-muted-foreground shrink-0">
                  {formatTimeMs(e.msTime)}
                </span>
                <span className="font-mono text-xs w-16 text-muted-foreground shrink-0">
                  t{e.tick}
                </span>
                <span className="text-xs uppercase tracking-wide w-12 shrink-0">
                  {e.kind === 'tempo' ? 'BPM' : 'TS'}
                </span>
                <span className="font-medium truncate">{e.label}</span>
              </button>
            ))}
            {eventList.length === 0 && (
              <div className="px-3 py-3 text-muted-foreground text-xs">
                No tempo or time-signature events.
              </div>
            )}
          </div>
        </aside>

        {/* Right: sheet music + clone hero */}
        <section className="flex-1 min-w-0 flex">
          {!currentTrack ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <>
              {hasNotes && (
                <div className="flex-1 min-w-0 flex p-2">
                  <SheetMusic
                    chart={currentChart}
                    track={currentTrack}
                    showBarNumbers={true}
                    enableColors={true}
                    showLyrics={true}
                    lyrics={lyrics}
                    zoom={1}
                    onSelectMeasure={time => {
                      const am = audioManagerRef.current;
                      if (!am) return;
                      am.playChartTime(time);
                      setIsPlaying(true);
                    }}
                    triggerRerender={`${variant}-${snapNotes}-${result.name}`}
                    practiceModeConfig={null}
                    onPracticeMeasureSelect={() => {}}
                    selectionIndex={null}
                    getChartTimeSec={() => audioManagerRef.current?.chartTime}
                  />
                </div>
              )}
              {audioManager && (
                <div className="flex-1 min-w-0 flex p-2">
                  <CloneHeroRenderer
                    key={`${variant}-${snapNotes}`}
                    metadata={metadata}
                    chart={currentChart}
                    track={currentTrack}
                    audioManager={audioManager}
                  />
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
