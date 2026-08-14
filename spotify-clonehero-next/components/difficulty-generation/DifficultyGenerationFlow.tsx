'use client';

/**
 * Shared flow behind `/drum-difficulties` and `/guitar-difficulties`: pick a
 * chart -> validate it has an Expert track for `instrument` -> run the
 * `generate-difficulties` assist task with the home-screen `ProcessingView`
 * full-page treatment -> apply the result via `GenerateDifficultiesCommand`
 * -> write the result as an OPFS project and push
 * `/chart-editor?project=<id>`.
 *
 * This page does not mount the editor. It is the pipeline run between the
 * picker and the handoff: a chart is loaded once per visit, generated, and
 * saved, and every later edit and export belongs to `/chart-editor` and the
 * project this page wrote.
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
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
import type {LoadedFiles, SourceFormat} from '@/lib/chart-files/chart-package';
import {createProjectFromDoc} from '@/lib/project-storage/createProjectFromDoc';
import {DIFFICULTY_ORIGIN} from '@/lib/project-storage/difficultyOrigins';
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
import {
  prepareChartPackageAudio,
  type PreparedChartPackageAudio,
} from '@/components/chart-editor/chartPackage';
import {difficultyGenerationBlockMessage} from '@/components/chart-editor/difficultyGenerationMessages';
import {
  DEFAULT_DRUMS_EXPERT_SCOPE,
  DEFAULT_GUITAR_EXPERT_SCOPE,
} from '@/components/chart-editor/scope';
import {GenerateDifficultiesCommand} from '@/components/chart-editor/commands';
import {INSTRUMENT_LABEL} from '@/components/chart-editor/trackLabels';
import {computeTrackStamp} from '@/lib/chart-editor-core';
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
  /** The song title, shown as the processing screen's subtitle. */
  name: string;
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
  /** The shape the package arrived in, so the project it becomes can be
   *  re-exported the same way. */
  sourceFormat: SourceFormat;
  originalName: string;
  sngMetadata?: Record<string, string> | undefined;
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
      },
      input: built.input,
      sourceStamp: computeTrackStamp(expert.track),
      sourceFormat: loaded.sourceFormat,
      originalName: loaded.originalName,
      sngMetadata: loaded.sngMetadata,
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
 * report in place), and the handoff is the moment between a finished run and
 * the editor this page navigates to.
 */
type FlowState =
  | {kind: 'picker'; error: string | null}
  | {kind: 'preparing'}
  | {kind: 'generating'; loaded: LoadedChart; error: string | null}
  | {kind: 'handoff'}
  // The tiers are generated and the write failed. The document is still
  // here, so this retries the write alone rather than the generation.
  | {
      kind: 'save-failed';
      loaded: LoadedChart;
      generated: ChartDocument;
      error: string;
    };

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
  const router = useRouter();

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

  /**
   * Writes the generated chart as a project and opens it. Never throws: a
   * failure keeps the document so the user can retry the write alone.
   */
  const saveAndOpen = useCallback(
    async (loaded: LoadedChart, generated: ChartDocument) => {
      const {candidate} = loaded;
      setFlow({kind: 'handoff'});
      try {
        const projectId = await createProjectFromDoc({
          chartDoc: generated,
          audioFiles: candidate.audioFiles,
          origin: DIFFICULTY_ORIGIN[instrument],
          sourceFormat: candidate.sourceFormat,
          originalName: candidate.originalName,
          sngMetadata: candidate.sngMetadata,
          durationSeconds: loaded.durationSeconds,
        });
        teardown(loaded);
        router.push(`/chart-editor?project=${projectId}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not save the chart';
        setFlow({kind: 'save-failed', loaded, generated, error: msg});
        toast.error(msg);
      }
    },
    [instrument, router, teardown],
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
        // The nominal length the project stores. A fallback keeps a package
        // whose audio would not decode from writing a zero-length project.
        durationSeconds:
          audio.durationSeconds > 0 ? audio.durationSeconds : 180,
      };
      liveAudioManager.current = audio.audioManager;
      publishAudioManager(audio.audioManager);
      dispatch({type: 'SET_CHART_DOC', chartDoc: candidate.chartDoc});
      setFlow({kind: 'generating', loaded, error: null});

      try {
        const result = await runner.start(task, candidate.input);
        // The command is applied directly to the document this run started
        // from. Nothing on this page edits that document while the run is in
        // flight, and the result goes straight to the project write below.
        const command = new GenerateDifficultiesCommand(
          instrument,
          result.tiers,
          candidate.sourceStamp,
        );
        const generated = command.execute(candidate.chartDoc);

        // The generated tiers become a project, and the editor opens it.
        // The provenance the command wrote rides along, so the difficulty
        // card doesn't read this page's own work as never generated.
        //
        // Saving is its own step with its own failure. A full disk is not a
        // generation failure, and the tiers that just cost the user a model
        // run are still in memory — losing them to a write error would be
        // the worst outcome this page has.
        await saveAndOpen(loaded, generated);
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
    [instrument, dispatch, publishAudioManager, runner, saveAndOpen, task],
  );

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  if (flow.kind === 'preparing' || flow.kind === 'handoff') {
    return (
      <main className="flex min-h-screen items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span>
          {flow.kind === 'handoff'
            ? 'Opening the editor...'
            : 'Loading chart...'}
        </span>
      </main>
    );
  }

  if (flow.kind === 'save-failed') {
    const {loaded, generated, error} = flow;
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-md rounded-lg border border-destructive/40 bg-destructive/10 p-6">
          <h2 className="text-lg font-semibold">
            Your {label} difficulties are ready, but the chart could not be
            saved.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            This usually means your browser is out of storage. Delete a project
            from the chart editor and try again.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              onClick={() => void saveAndOpen(loaded, generated)}>
              Try again
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                teardown(loaded);
                setFlow({kind: 'picker', error: null});
              }}>
              Back
            </Button>
          </div>
        </div>
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
