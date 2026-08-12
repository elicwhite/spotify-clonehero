'use client';

/**
 * Shared flow behind `/drum-difficulties` and `/guitar-difficulties` (plan
 * 0074 route model, 2026-08-03): pick a chart -> validate it has an Expert
 * track for `instrument` -> run the `generate-difficulties` assist task with
 * the home-screen `ProcessingView` full-page treatment -> apply the result
 * via `GenerateDifficultiesCommand` -> land in the shared `ChartEditor` with
 * that instrument's Expert/Hard/Medium/Easy visible.
 *
 * The editor it lands in is the chart-package host `TrackEditPage` also
 * mounts: playback, waveform, export sources and the Chart Assist audio
 * boundary all come from `chartPackage.ts`. What lives here is the part
 * that route has and `/chart-editor` doesn't — a full-page pipeline run
 * between the picker and the editor — and the fact that no OPFS project
 * backs it: a chart is loaded once per visit, generated, edited, exported.
 */

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AlertTriangle, Loader2} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import ChartDropZone from '@/components/chart-picker/ChartDropZone';
import type {LoadedFiles} from '@/components/chart-picker/chart-file-readers';
import {findAudioFiles} from '@/lib/preview/chorus-chart-processing';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {Files} from '@/lib/preview/chorus-chart-processing';
import {readChartForEditing, findTrack} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {
  AudioServiceProvider,
  useAudioServiceContext,
} from '@/components/chart-editor/AudioServiceContext';
import {
  AssistRunnerProvider,
  useAssistRunnerContext,
} from '@/components/assist/AssistRunnerProvider';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '@/components/chart-editor/ChartEditorContext';
import {useEditorKeyboard} from '@/components/chart-editor/hooks/useEditorKeyboard';
import ChartEditor from '@/components/chart-editor/ChartEditor';
import {
  CHART_PACKAGE_ASSIST_DISABLED_REASONS,
  prepareChartPackageAudio,
  useChartPackageEditor,
  type PreparedChartPackageAudio,
} from '@/components/chart-editor/chartPackage';
import {difficultyGenerationBlockMessage} from '@/components/chart-editor/difficultyGenerationMessages';
import {
  DEFAULT_DRUMS_EXPERT_SCOPE,
  DEFAULT_GUITAR_EXPERT_SCOPE,
  trackKeyId,
} from '@/components/chart-editor/scope';
import {GenerateDifficultiesCommand} from '@/components/chart-editor/commands';
import {INSTRUMENT_LABEL} from '@/components/chart-editor/trackLabels';
import {computeTrackStamp, TRACK_DIFFICULTIES} from '@/lib/chart-editor-core';
import {buildDifficultyGenerationInput} from '@/lib/assist/difficulty-input';
import type {DifficultyGenerationInput} from '@/lib/assist/difficulty-client';
import {
  generateDifficultiesTask,
  type GenerateDifficultiesInput,
  type GenerateDifficultiesResult,
} from '@/lib/assist/tasks/generate-difficulties';
import type {AssistTaskDef} from '@/lib/assist/tasks/types';
import {isAbortError} from '@/lib/workers/abortable-worker';
import ConnectedProcessingView from '@/components/assist/ConnectedProcessingView';
import {audioSamples} from '@/components/chart-editor/audioSamples';

/** Only the two instruments this route model offers a generation route for.
 *  Bass generation ships disabled everywhere (plan 0074 Design D) and is not
 *  a route. */
export type DifficultyGenerationInstrument = 'drums' | 'guitar';

export interface DifficultyGenerationFlowConfig {
  instrument: DifficultyGenerationInstrument;
  pageTitle: string;
  pageDescription: string;
  dropZoneId: string;
  /** Test seam: override the `generate-difficulties` task, e.g. one built
   *  with `makeGenerateDifficultiesTask({createWorker: fakeWorkerFactory})`. */
  task?: AssistTaskDef<GenerateDifficultiesResult, GenerateDifficultiesInput>;
}

interface SongMeta {
  name: string;
  artist: string;
  charter: string;
}

/** Everything a dropped chart has to yield before a run can start. */
export interface GenerationCandidate {
  chartDoc: ChartDocument;
  audioFiles: Files;
  meta: SongMeta;
  input: DifficultyGenerationInput;
  /** The Expert track's content stamp as dropped, recorded with the
   *  generated tiers so staleness is measured against what they came from. */
  sourceStamp: string;
}

export type ChartInspection =
  | {ok: true; candidate: GenerationCandidate}
  | {ok: false; error: string};

/**
 * Reads a dropped chart package and decides whether generation can run on
 * it: parse, Expert track, reducible input, audio. Pure (no React, no audio
 * decoding), so every rejection this route can show is testable directly.
 */
export function inspectDroppedChart(
  loaded: LoadedFiles,
  instrument: DifficultyGenerationInstrument,
): ChartInspection {
  let chartDoc: ChartDocument;
  try {
    // The editor's parse, since this route ends in the editor: a basic
    // four-lane drum chart is read as pro-drums, which is also what makes it
    // reducible at all.
    chartDoc = readChartForEditing(loaded.files);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to read chart',
    };
  }

  const expert = findTrack(chartDoc, {instrument, difficulty: 'expert'});
  if (!expert) {
    return {
      ok: false,
      error: difficultyGenerationBlockMessage(
        instrument,
        'no-expert-track',
        'picker',
      ),
    };
  }

  const built = buildDifficultyGenerationInput(chartDoc, instrument);
  if (!built.ok) {
    return {
      ok: false,
      error: difficultyGenerationBlockMessage(
        instrument,
        built.reason,
        'picker',
      ),
    };
  }

  const audioFiles = findAudioFiles(loaded.files);
  if (audioFiles.length === 0) {
    return {ok: false, error: 'No audio files found in chart package.'};
  }

  // The editor saves and exports .chart, whatever the package arrived as.
  chartDoc.parsedChart.format = 'chart';

  return {
    ok: true,
    candidate: {
      chartDoc,
      audioFiles,
      meta: {
        name:
          chartDoc.parsedChart.metadata.name ??
          loaded.originalName ??
          'Unknown',
        artist: chartDoc.parsedChart.metadata.artist ?? 'Unknown',
        charter: chartDoc.parsedChart.metadata.charter ?? 'Unknown',
      },
      input: built.input,
      sourceStamp: computeTrackStamp(expert.track),
    },
  };
}

export default function DifficultyGenerationFlow(
  config: DifficultyGenerationFlowConfig,
) {
  return (
    <AudioServiceProvider>
      <AssistRunnerProvider>
        <ChartEditorProvider
          activeScope={
            config.instrument === 'drums'
              ? DEFAULT_DRUMS_EXPERT_SCOPE
              : DEFAULT_GUITAR_EXPERT_SCOPE
          }>
          <DifficultyGenerationFlowInner config={config} />
        </ChartEditorProvider>
      </AssistRunnerProvider>
    </AudioServiceProvider>
  );
}

/** The chart as it is once its audio is ready to play. */
interface LoadedChart {
  candidate: GenerationCandidate;
  audio: PreparedChartPackageAudio;
  durationSeconds: number;
}

/**
 * One state, so the screens can't disagree about what exists: the picker has
 * no chart, the processing screen has one loaded (and may carry a failure to
 * report in place), the editor has one loaded and generated.
 */
type FlowState =
  | {kind: 'picker'; error: string | null}
  | {kind: 'preparing'}
  | {kind: 'generating'; loaded: LoadedChart; error: string | null}
  | {kind: 'editor'; loaded: LoadedChart};

function DifficultyGenerationFlowInner({
  config,
}: {
  config: DifficultyGenerationFlowConfig;
}) {
  const {instrument, pageTitle, pageDescription, dropZoneId} = config;
  const task = config.task ?? generateDifficultiesTask;
  const label = INSTRUMENT_LABEL[instrument];

  const {dispatch} = useChartEditorContext();
  const runner = useAssistRunnerContext();
  const {setAudioManager: publishAudioManager} = useAudioServiceContext();

  const [flow, setFlow] = useState<FlowState>({kind: 'picker', error: null});

  // The AudioManager this flow built, held outside render state so unmounting
  // can stop it: pages own the manager they create and destroy it themselves
  // (`AudioServiceContext`), and leaving mid-run or mid-edit would otherwise
  // keep the song playing over the next page with its AudioContext still open.
  const liveAudioManager = useRef<AudioManager | null>(null);
  const mounted = useRef(true);

  const teardown = useCallback(
    (loaded: LoadedChart) => {
      loaded.audio.audioManager.destroy();
      if (liveAudioManager.current === loaded.audio.audioManager) {
        liveAudioManager.current = null;
      }
      publishAudioManager(null);
    },
    [publishAudioManager],
  );

  useEffect(() => {
    // Set on mount, not just at declaration, so a StrictMode remount starts
    // mounted again rather than treating every later load as abandoned.
    mounted.current = true;
    return () => {
      mounted.current = false;
      // destroy() is idempotent, so the teardown paths above don't have to
      // coordinate with this one.
      liveAudioManager.current?.destroy();
      liveAudioManager.current = null;
    };
  }, []);

  const handleChartLoaded = useCallback(
    async (dropped: LoadedFiles) => {
      const inspection = inspectDroppedChart(dropped, instrument);
      if (!inspection.ok) {
        setFlow({kind: 'picker', error: inspection.error});
        return;
      }
      const {candidate} = inspection;

      setFlow({kind: 'preparing'});

      let audio: PreparedChartPackageAudio;
      try {
        audio = await prepareChartPackageAudio({
          chartDoc: candidate.chartDoc,
          audioFiles: candidate.audioFiles,
          onPlaybackEnded: () =>
            dispatch({type: 'SET_PLAYING', isPlaying: false}),
        });
      } catch (e) {
        setFlow({
          kind: 'picker',
          error: e instanceof Error ? e.message : 'Failed to load audio',
        });
        return;
      }

      if (!mounted.current) {
        // Left the route while the audio was being built: the unmount
        // cleanup ran before this manager existed, so stop it here.
        audio.audioManager.destroy();
        return;
      }

      const loaded: LoadedChart = {
        candidate,
        audio,
        // The transport's total-time display is the only consumer, so a
        // package whose audio wouldn't decode still gets a usable editor.
        durationSeconds:
          audio.durationSeconds > 0 ? audio.durationSeconds : 180,
      };
      liveAudioManager.current = audio.audioManager;
      publishAudioManager(audio.audioManager);
      dispatch({type: 'SET_CHART_DOC', chartDoc: candidate.chartDoc});
      setFlow({kind: 'generating', loaded, error: null});

      try {
        const result = await runner.start(task, candidate.input);
        // Applied directly against the just-loaded `chartDoc`, not through
        // `useExecuteCommand`'s `state.chartDoc` — that hook's closure was
        // captured before the `SET_CHART_DOC` dispatch above and won't see
        // it until a re-render. `dispatch` itself is a stable reference to
        // the session's own method, so this still lands on the live store.
        const command = new GenerateDifficultiesCommand(
          instrument,
          result.tiers,
          candidate.sourceStamp,
        );
        dispatch({
          type: 'EXECUTE_COMMAND',
          command,
          chartDoc: command.execute(candidate.chartDoc),
        });
        dispatch({
          type: 'SET_VISIBLE_TRACKS',
          tracks: new Set(
            TRACK_DIFFICULTIES.map(difficulty =>
              trackKeyId({instrument, difficulty}),
            ),
          ),
        });
        setFlow({kind: 'editor', loaded});
      } catch (e) {
        if (isAbortError(e)) {
          // Cancel: tear down and return to the picker with nothing applied.
          teardown(loaded);
          setFlow({kind: 'picker', error: null});
          return;
        }
        // A real failure keeps the processing screen and switches it to
        // `ProcessingView`'s error treatment, the same in-place failure
        // presentation the other pipeline home screens use. Its Back button
        // is what tears down and returns to the picker.
        const msg =
          e instanceof Error ? e.message : 'Difficulty generation failed';
        setFlow({kind: 'generating', loaded, error: msg});
        toast.error(msg);
      }
    },
    [instrument, dispatch, publishAudioManager, runner, task, teardown],
  );

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  if (flow.kind === 'preparing') {
    return (
      <main className="flex min-h-screen items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span>Loading chart...</span>
      </main>
    );
  }

  if (flow.kind === 'generating') {
    const {loaded, error} = flow;
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <ConnectedProcessingView
          store={runner.store}
          taskKey="generate-difficulties"
          title={`Generating ${label} Hard, Medium, Easy`}
          subtitle={loaded.candidate.meta.name}
          error={error}
          onCancel={
            error
              ? () => {
                  teardown(loaded);
                  setFlow({kind: 'picker', error: null});
                }
              : () => runner.cancel()
          }
        />
      </main>
    );
  }

  if (flow.kind === 'editor') {
    return <GeneratedChartEditor loaded={flow.loaded} />;
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold sm:text-4xl mb-2">{pageTitle}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          {pageDescription}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Load a Chart</CardTitle>
          <CardDescription>
            Drop a .sng or .zip file, or select a chart folder.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartDropZone onLoaded={handleChartLoaded} id={dropZoneId} />
        </CardContent>
      </Card>

      {flow.error && (
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="text-sm">
            {/* Deliberately neutral: this banner also carries reasons that
                aren't about the chart's difficulties at all (no audio in the
                package, audio that failed to load). */}
            <p className="font-medium text-destructive">
              Can&apos;t start {label} difficulty generation
            </p>
            <p className="mt-1 text-muted-foreground">{flow.error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setFlow({kind: 'picker', error: null})}>
              Try another chart
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}

/**
 * The editor half. Mounted only once a chart is loaded and generated, so the
 * editor's keyboard shortcuts are live exactly while its chart is on screen.
 */
function GeneratedChartEditor({loaded}: {loaded: LoadedChart}) {
  const {state} = useChartEditorContext();
  const {candidate, audio, durationSeconds} = loaded;

  // No OPFS project backs this route — the chart lives in memory for the
  // visit, same as the standalone tool it replaces. Shortcuts still work;
  // there's simply nothing to autosave to.
  useEditorKeyboard();

  const loadAudioFiles = useCallback(
    async () => candidate.audioFiles,
    [candidate.audioFiles],
  );
  const chartPackage = useChartPackageEditor({
    chartDoc: state.chartDoc ?? null,
    loadAudioFiles,
  });

  /**
   * Chart Assist wiring for this host: the sample rate of the audio it
   * decoded (the leading-silence pad quantizes to it), plus the reason it
   * can't offer that action — this route plays the package's audio files
   * straight and never pads them, so a shifted chart would drift away from
   * its audio.
   */
  const chartAssist = useMemo(
    () => ({
      ...chartPackage.chartAssist,
      audioSampleRate: audio.audioSampleRate,
      leadingSilenceDisabledReason:
        CHART_PACKAGE_ASSIST_DISABLED_REASONS.leadingSilence,
    }),
    [chartPackage.chartAssist, audio.audioSampleRate],
  );

  // Wrapped once per buffer — see `components/chart-editor/audioSamples.ts`.
  // Above the early return: hook order can't depend on the chart.
  const samples = useMemo(
    () => audioSamples(audio.audioData),
    [audio.audioData],
  );

  const chart = state.chartDoc?.parsedChart;
  if (!chart) return null;

  return (
    <div className="flex-1 min-h-0 w-full flex h-screen flex-col">
      <ChartEditor
        chart={chart}
        audioManager={audio.audioManager}
        audioData={samples}
        audioChannels={audio.audioChannels}
        durationSeconds={durationSeconds}
        sections={chart.sections}
        songName={candidate.meta.name}
        artistName={candidate.meta.artist}
        charterName={candidate.meta.charter}
        // This route is matrix-driven and lands with four tracks visible,
        // so the piano roll stacks one row per visible track rather than
        // following `activeScope`'s single track.
        stackedPianoRoll
        getChartText={chartPackage.getChartText}
        getAudioSources={chartPackage.getAudioSources}
        chartAssist={chartAssist}
      />
    </div>
  );
}
