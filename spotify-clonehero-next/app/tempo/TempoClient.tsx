'use client';

/**
 * /tempo — browser tempo mapper.
 *
 * Pick a standalone audio file or an existing chart (folder / .sng / .zip).
 * The page isolates the drums, finds beats on the full mix and the drum stem,
 * and converts them to a tempo map. The generated chart is saved as a normal
 * chart-editor project, then this entrypoint hands it off to /chart-editor.
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {ArrowLeft, FolderSearch, Music} from 'lucide-react';

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
import {
  findAudioFiles,
  type Files,
} from '@/lib/preview/chorus-chart-processing';
import {readChart} from '@/lib/chart-edit';
import {isWebGPUAvailable} from '@/lib/drum-transcription/ml/onnx-runtime';
import ChartDropZone from '@/components/chart-picker/ChartDropZone';
import type {LoadedFiles, SourceFormat} from '@/lib/chart-files/chart-package';
import {isChartFileName} from '@/lib/chart-files/chart-file-names';
import ConnectedProcessingView from '@/components/assist/ConnectedProcessingView';
import SectionDropZone from '@/components/landing/SectionDropZone';
import AudioUploader from '@/app/drum-transcription/components/AudioUploader';
import {chartPackageAudioBytes} from '@/components/chart-editor/chartPackage';

import {TempoLanding} from './landing/TempoLanding';

import {mergeAudioFiles} from '@/lib/tempo-map/merge-audio';
import {swapSynctrack} from '@/lib/tempo-map/swap-synctrack';
import {buildChartFromSynctrack} from '@/lib/tempo-map/build-chart';

import {useAssistRunnerControls} from '@/components/assist/useAssistRunner';
import {
  generateTempoMapTask,
  type GenerateTempoMapInput,
  type GenerateTempoMapResult,
} from '@/lib/assist/tasks/generate-tempo-map';
import {
  resolveStemFingerprint,
  type AssistTaskDef,
} from '@/lib/assist/tasks/types';
import {isAbortError} from '@/lib/workers/abortable-worker';
import {chartPackageStore} from '@/lib/project-storage/projects';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const PRO_DRUMS_MODIFIERS = {
  ...defaultIniChartModifiers,
  pro_drums: true,
} as const;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

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
  const chartFile = files.find(f => isChartFileName(f.fileName));
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
    'pick' | 'pick-audio' | 'pick-chart' | 'processing'
  >('pick');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

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
      cancelBeforeRunRef.current = false;

      try {
        let name: string;
        let audioFiles: Files;
        let originalChart: ParsedChart | null = null;
        let chartAssets: ScanFile[] = [];
        let sourceFormat: SourceFormat | null = null;
        let originalName: string;
        let originalBytes: Uint8Array;
        let songLengthMs = 0;
        let decodedMix: AudioBuffer | null = null;
        /** The audio the task analyzes. Chart mode mixes the chart's stems
         *  down to one buffer, so beat tracking sees the whole song rather
         *  than whichever stem the fingerprint happens to be taken from;
         *  audio mode hands back the buffer decoded below. */
        let loadDecodedMix: (() => Promise<AudioBuffer>) | undefined;

        if (input.kind === 'audio') {
          const bytes = new Uint8Array(await input.file.arrayBuffer());
          originalBytes = bytes;
          name = basename(input.file.name);
          originalName = input.file.name;
          audioFiles = [{fileName: input.file.name, data: bytes}];
          // Audio mode has no chart of its own to derive a length from, so
          // the file is decoded here; the task analyzes this same buffer
          // rather than decoding the bytes a second time.
          const audioBuffer = await decodeStandaloneAudio(bytes);
          decodedMix = audioBuffer;
          songLengthMs = audioBuffer.duration * 1000;
          loadDecodedMix = async () => audioBuffer;
        } else {
          const {loaded} = input;
          originalName = loaded.originalName;
          sourceFormat = loaded.sourceFormat;
          const doc = readChart(loaded.files, {pro_drums: true});
          originalChart = doc.parsedChart;
          name = originalChart.metadata.name ?? loaded.originalName;
          chartAssets = doc.assets;
          audioFiles = findAudioFiles(loaded.files);
          if (audioFiles.length === 0) {
            throw new Error('This chart has no audio files to analyze.');
          }
          // Use the same canonical bytes /chart-editor fingerprints. For a
          // multi-stem package this is the reconstructed full mix, not an
          // arbitrary first stem, so either route resolves the same cache.
          originalBytes = await chartPackageAudioBytes(audioFiles);
          const stems = audioFiles;
          loadDecodedMix = async () => {
            decodedMix ??= await mergeAudioFiles(stems);
            return decodedMix;
          };
        }

        if (cancelBeforeRunRef.current) {
          setPhase('pick');
          return;
        }

        const assistAudio = {
          loadOriginalBytes: async () => originalBytes,
          loadDecodedMix,
        };
        // Persist the exact key the tempo worker uses for its separated-stem
        // cache. /chart-editor intentionally only probes that cache when its
        // project metadata carries a fingerprint.
        const stemFingerprint = await resolveStemFingerprint(
          assistAudio,
          originalBytes,
        );
        if (cancelBeforeRunRef.current) {
          setPhase('pick');
          return;
        }

        const taskResult = await startAssistTask(task, {
          audio: {...assistAudio, stemFingerprint},
        });
        const sync = taskResult.synctrack;
        if (!decodedMix && loadDecodedMix) decodedMix = await loadDecodedMix();
        if (decodedMix) songLengthMs = decodedMix.duration * 1000;

        // Build the final chart before handing it off. Existing chart notes
        // use the same default snapping the old results editor opened with.
        let newChart: ParsedChart;
        let modifiers = {...PRO_DRUMS_MODIFIERS};
        if (originalChart) {
          modifiers = {...originalChart.iniChartModifiers, pro_drums: true};
          newChart = swapSynctrack(originalChart, sync, {quantizeNotes: true});
        } else {
          const built = buildChartFromSynctrack({sync, songLengthMs});
          built.metadata.name = name;
          const audioAsset: ScanFile = {
            fileName: audioFiles[0].fileName,
            data: audioFiles[0].data,
          };
          chartAssets = [audioAsset];
          newChart = built;
        }

        const {chart, files} = writeAndReparse(newChart, chartAssets, modifiers);
        const chartFile = files.find(f => isChartFileName(f.fileName));
        if (!chartFile) throw new Error('Failed to build the chart project');

        const meta = await chartPackageStore().createProject({
          name,
          artist: chart.metadata.artist ?? '',
          charter: chart.metadata.charter ?? '',
          durationSeconds: songLengthMs / 1000,
          sourceFormat: sourceFormat ?? 'folder',
          originalName,
          chartFile,
          audioFiles,
          allFiles: files,
          origin: 'tempo',
          stemFingerprint,
        });
        router.push(`/chart-editor?project=${meta.id}`);
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
    [router, startAssistTask, task],
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
                Builds a tempo map and beat grid in your browser. Start from a
                song file to get a fresh chart, or from an existing chart to
                rebuild its tempo map without moving any notes.
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
