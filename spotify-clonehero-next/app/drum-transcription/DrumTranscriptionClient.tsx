'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {useSearchParams, useRouter} from 'next/navigation';
import OrtRuntimeScript from '@/components/onnx/OrtRuntimeScript';
import {AlertTriangle, Loader2, ArrowLeft, FolderOpen} from 'lucide-react';
import {toast} from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import SectionDropZone from '@/components/landing/SectionDropZone';
import {ToolEntryCard} from '@/components/landing/ToolEntryCard';
import SourcePicker from './components/SourcePicker';
import {DrumTranscriptionLanding} from './landing/DrumTranscriptionLanding';
import type {LoadedFiles} from '@/lib/chart-files/chart-package';
import {readChart} from '@/lib/chart-edit';
import {isChartOrIniFileName} from '@/lib/chart-files/chart-file-names';
import {findAudioFiles} from '@/lib/preview/chorus-chart-processing';
import {pickPrimaryAudioFile} from '@/lib/audio/pickPrimaryAudioFile';
import ConnectedProcessingView from '@/components/assist/ConnectedProcessingView';
import ProjectList from '@/components/project-list/ProjectList';
import type {SongMetadataValue} from '@/lib/chart-editor-core';
import {getProject} from '@/lib/drum-transcription/storage/opfs';
import {
  deleteProject as deleteProjectRecord,
  listProjects as listProjectRecords,
  renameProject as renameProjectRecord,
} from '@/lib/project-storage/projects';
import type {ProjectRecord} from '@/lib/project-storage/types';
import {
  transcribeDrumsTask,
  type TranscribeDrumsRun,
} from '@/lib/assist/tasks/transcribe-drums';
import {
  ASSIST_RUN_BUSY_MESSAGE,
  useAssistRunnerControls,
  type AssistRunContext,
} from '@/components/assist/useAssistRunner';
import {isAbortError} from '@/lib/workers/abortable-worker';
import {useToolLandingView} from '@/components/analytics/useToolLandingView';
import {track, type ChartOpenSource} from '@/lib/analytics/track';

/** Every run on this page is the transcription tool's own landing flow. The
 *  project the pipeline creates is stamped `drum-transcription` to match. */
const LANDING_RUN: AssistRunContext = {
  origin: 'drum-transcription',
  entrypoint: 'landing',
};

// Browser capabilities are static for the page lifetime, so the subscribe
// function is a no-op. The server can't answer, so getServerSnapshot returns
// null and callers treat that as "checking".
const noopSubscribe = () => () => {};
const nullServerSnapshot = (): boolean | null => null;

const webGPUGetSnapshot = () => 'gpu' in navigator;

function useWebGPUCheck() {
  return useSyncExternalStore(
    noopSubscribe,
    webGPUGetSnapshot,
    nullServerSnapshot,
  );
}

// WebCodecs AudioEncoder is required to encode exported stems to Opus.
const audioEncoderGetSnapshot = () =>
  typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined';

function useAudioEncoderCheck() {
  return useSyncExternalStore(
    noopSubscribe,
    audioEncoderGetSnapshot,
    nullServerSnapshot,
  );
}

/**
 * Inner component that reads search params.
 * Must be wrapped in Suspense because useSearchParams() requires it.
 */
function DrumTranscriptionInner() {
  const webGPUSupported = useWebGPUCheck();
  const audioEncoderSupported = useAudioEncoderCheck();
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = searchParams.get('project');

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  // Tracks whether we've completed at least one listProjects() call.
  // Used to derive loadingProjects below, so the effect doesn't need
  // to flip a loading flag synchronously before kicking off the fetch.
  const [projectsLoaded, setProjectsLoaded] = useState(false);

  // The page's assist runner: every pipeline run on this screen (upload,
  // chart package, resume) is a `transcribe-drums` task run on it, so the
  // step list, its wall-clock/ETA math, and cancellation all come from the
  // engine rather than from a step machine kept here.
  const runner = useAssistRunnerControls();
  const [runRequest, setRunRequest] = useState<PipelineRunRequest | null>(null);
  const runProjectIdRef = useRef<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const isProcessing = runRequest !== null;

  // Chart-flow feature: error from the last existing-chart-package load
  // attempt (SourcePicker owns the audio-vs-chart mode toggle itself).
  const [chartFlowError, setChartFlowError] = useState<string | null>(null);

  // Result of checking a project's stage, tagged with the projectId we
  // checked for. Tagging lets us derive UI state from a single source:
  // if the tag doesn't match the current projectId, we haven't finished
  // checking yet.
  const [projectCheck, setProjectCheck] = useState<{
    projectId: string;
    needsProcessing: boolean;
  } | null>(null);
  const checkingProject = !!projectId && projectCheck?.projectId !== projectId;
  const projectNeedsProcessing =
    !!projectId &&
    projectCheck?.projectId === projectId &&
    projectCheck.needsProcessing;

  /**
   * Runs one `transcribe-drums` task on the page's runner and owns the
   * screen's response to the three outcomes: success hands the project on,
   * cancellation returns to the previous screen with nothing applied, and a
   * failure keeps the step list on screen with a Retry that re-runs this
   * same request.
   */
  const startRun = useCallback(
    async (request: PipelineRunRequest) => {
      // A run this screen already started is still going (a remounted effect
      // asking for the same resume, or a project switch mid-run). The live
      // run owns the screen: refusing a duplicate must leave its title, its
      // step list, and the project Retry points at exactly as they are, so
      // this returns before touching any of them. `runner.start` refuses on
      // the same condition; checking here keeps the refusal from landing
      // after the state below has already been rewritten.
      if (runner.store.getState().status === 'running') return;

      setRunRequest(request);
      setRunError(null);
      // The project this run is working in, as soon as it exists: either the
      // one it was pointed at, or the one an upload/chart run creates part
      // way through. Retry needs it (see `handleRetryPipeline`).
      runProjectIdRef.current =
        request.run.kind === 'resume' ? request.run.projectId : null;
      try {
        const result = await runner.start(
          transcribeDrumsTask,
          {
            run: request.run,
            onProjectCreated: id => {
              runProjectIdRef.current = id;
            },
          },
          LANDING_RUN,
        );
        toast.success('Processing complete! Opening editor.');
        setRunRequest(null);
        request.onSuccess(result.projectId);
      } catch (err) {
        if (isAbortError(err)) {
          setRunRequest(null);
          return;
        }
        if (err instanceof Error && err.message === ASSIST_RUN_BUSY_MESSAGE) {
          // Refusing a duplicate is not a pipeline failure and must not
          // replace the live run's step list with an error.
          return;
        }
        const message = err instanceof Error ? err.message : 'Pipeline failed';
        console.error('Pipeline error:', err);
        setRunError(message);
        toast.error(message);
      }
    },
    [runner],
  );

  // When projectId is set via URL, check whether the project needs pipeline
  // work. This route owns the pipeline and is the app's only resume path;
  // once a project has a chart, `/chart-editor` is where it is edited, so a
  // ready project is handed straight over. The two routes' redirect
  // conditions are exact complements, so they cannot bounce a user back and
  // forth.
  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    async function checkProjectStage() {
      const openInEditor = () => {
        if (!cancelled) router.replace(`/chart-editor?project=${projectId!}`);
      };
      try {
        const meta = await getProject(projectId!);
        if (cancelled) return;

        if (meta.stage === 'editing' || meta.stage === 'exported') {
          setProjectCheck({projectId: projectId!, needsProcessing: false});
          openInEditor();
          return;
        }

        // Project needs pipeline processing — show ProcessingView and resume
        setProjectCheck({projectId: projectId!, needsProcessing: true});

        await startRun({
          title: `Processing: ${meta.name}`,
          run: {kind: 'resume', projectId: projectId!},
          onSuccess: () => {
            if (cancelled) return;
            setProjectCheck({projectId: projectId!, needsProcessing: false});
            openInEditor();
          },
        });
      } catch {
        if (cancelled) return;
        // Can't load metadata — let the editor report what it finds.
        setProjectCheck({projectId: projectId!, needsProcessing: false});
        openInEditor();
      }
    }

    checkProjectStage();
    return () => {
      cancelled = true;
    };
  }, [projectId, router, startRun]);

  // Load project list when no project is selected and not processing.
  // All state writes happen in promise callbacks (post-await), so the
  // effect body itself does no synchronous setState.
  const shouldLoadProjects = !projectId && !isProcessing;
  const loadingProjects = shouldLoadProjects && !projectsLoaded;
  useEffect(() => {
    if (!shouldLoadProjects) return;

    let cancelled = false;
    // This page shows only the projects it started. `/chart-editor` is the
    // list that shows everything.
    listProjectRecords()
      .then(result => {
        if (!cancelled) {
          setProjects(result.filter(r => r.origin === 'drum-transcription'));
          setProjectsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjects([]);
          setProjectsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shouldLoadProjects]);

  // `/chart-editor` is where every project is edited, whichever entrypoint
  // created it. `push` (not `replace`) so Back returns here.
  const openEditor = useCallback(
    (id: string) => router.push(`/chart-editor?project=${id}`),
    [router],
  );

  /**
   * The hand-off into the editor for a chart this tool has just made: its
   * step 2. The editor cannot report it — opening a project there is also
   * what reopening one a week later looks like — so the hand-off is the only
   * place that knows a chart has just arrived.
   *
   * Every other use of `openEditor` deliberately reports nothing: reopening
   * a finished project, and resuming one whose pipeline never finished. The
   * resume undercounts step 2 for this tool, which is the better of two
   * wrongs — that record carries no source format, so any value reported
   * would be a guess, and a mislabelled entry is worse than a missing one.
   */
  const openNewChart = useCallback(
    (sourceFormat: ChartOpenSource) => (id: string) => {
      track({
        event: 'chart_opened',
        origin: 'drum-transcription',
        sourceFormat,
      });
      openEditor(id);
    },
    [openEditor],
  );

  // Handle audio upload -> start pipeline
  const handleStartPipeline = useCallback(
    (file: File) =>
      startRun({
        title: `Processing: ${file.name}`,
        run: {kind: 'upload', audioFile: file, fileName: file.name},
        onSuccess: openNewChart('audio'),
      }),
    [openNewChart, startRun],
  );

  // Handle an existing chart package being dropped/selected -> start the
  // chart-flow pipeline (transcribes drums but snaps them to the package's
  // OWN SyncTrack, never a predicted tempo map).
  const handleChartPackageLoaded = useCallback(
    async (loaded: LoadedFiles) => {
      setChartFlowError(null);
      try {
        const chartDoc = readChart(loaded.files, {pro_drums: true});
        const audioFiles = findAudioFiles(loaded.files);
        if (audioFiles.length === 0) {
          throw new Error('No audio files found in the chart package.');
        }
        // The primary song audio: the full mix, by size.
        const primary = pickPrimaryAudioFile(audioFiles)!;
        const primaryAudioFile = new File(
          [primary.data as BlobPart],
          primary.fileName,
        );
        const primaryNameLower = primary.fileName.toLowerCase();
        // The same test `readChart` applies above, so the project stores the
        // same set of passthrough assets the document carries. A chart file
        // under any name is regenerated on export, so keeping one here would
        // only waste storage.
        const extraAssets = loaded.files.filter(
          f =>
            !isChartOrIniFileName(f.fileName) &&
            f.fileName.toLowerCase() !== primaryNameLower,
        );

        await startRun({
          title: `Processing: ${primaryAudioFile.name}`,
          run: {
            kind: 'chart',
            input: {
              chartDoc,
              audioFile: primaryAudioFile,
              packageInfo: {
                sourceFormat: loaded.sourceFormat,
                originalName: loaded.originalName,
                sngMetadata: loaded.sngMetadata,
              },
              extraAssets,
            },
          },
          onSuccess: openNewChart(loaded.sourceFormat),
        });
      } catch (err) {
        // Reading the package failed before any run started; the picker
        // shows this in place.
        const message =
          err instanceof Error ? err.message : 'Could not read chart package';
        console.error('Chart-flow load error:', err);
        setChartFlowError(message);
        toast.error(message);
      }
    },
    [openNewChart, startRun],
  );

  // Handle selecting an existing project. A project whose pipeline never
  // finished is resumed here first; a finished one opens in the editor.
  const handleSelectProject = useCallback(
    async (record: ProjectRecord) => {
      if (record.ready) {
        openEditor(record.id);
        return;
      }
      await startRun({
        title: `Processing: ${record.name}`,
        run: {kind: 'resume', projectId: record.id},
        onSuccess: openEditor,
      });
    },
    [openEditor, startRun],
  );

  // Retry the run that just failed. Once a run has a project, retrying
  // resumes it: every stage that already landed is on disk, and re-running
  // the original upload/chart request would create a second project and
  // redo the decode and separation from scratch.
  const handleRetryPipeline = useCallback(() => {
    if (!runRequest) return;
    const inProgressProjectId = runProjectIdRef.current;
    if (inProgressProjectId) {
      void startRun({
        title: runRequest.title,
        run: {kind: 'resume', projectId: inProgressProjectId},
        onSuccess: runRequest.onSuccess,
      });
      return;
    }
    void startRun(runRequest);
  }, [runRequest, startRun]);

  const handleCancelPipeline = useCallback(() => {
    // Aborts the in-flight run's workers; after a failure there is nothing
    // left to abort and this only clears the screen.
    runner.cancel();
    setRunRequest(null);
    setRunError(null);
    // Preserve the tag for the current project so checkingProject stays
    // false; we've just decided this project no longer needs processing.
    setProjectCheck(prev =>
      prev ? {projectId: prev.projectId, needsProcessing: false} : null,
    );
  }, [runner]);

  const handleBackToProjects = useCallback(() => {
    router.push('/drum-transcription');
  }, [router]);

  const handleDeleteProject = useCallback(async (record: ProjectRecord) => {
    try {
      await deleteProjectRecord(record.id);
      setProjects(prev => prev.filter(p => p.id !== record.id));
      toast.success(`Deleted "${record.name}"`);
    } catch (err) {
      console.error('Failed to delete project:', err);
      toast.error('Failed to delete project');
    }
  }, []);

  const handleRenameProject = useCallback(
    async (record: ProjectRecord, identity: SongMetadataValue) => {
      try {
        const updated = await renameProjectRecord(record.id, identity);
        setProjects(prev => prev.map(p => (p.id === record.id ? updated : p)));
      } catch (err) {
        console.error('Failed to rename project:', err);
        toast.error('Failed to rename project');
      }
    },
    [],
  );

  // Capability check -- block access if a required browser feature is missing.
  const missingCapabilities: {name: string; reason: string}[] = [];
  if (webGPUSupported === false) {
    missingCapabilities.push({
      name: 'WebGPU',
      reason: 'runs the drum separation and transcription ML models',
    });
  }
  if (audioEncoderSupported === false) {
    missingCapabilities.push({
      name: 'WebCodecs AudioEncoder',
      reason: 'encodes exported stems to Opus audio',
    });
  }

  if (missingCapabilities.length > 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 w-full max-w-lg gap-4">
        <Card className="w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>Unsupported Browser</CardTitle>
            <CardDescription>
              Drum transcription needs browser features your current browser
              doesn&apos;t support.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <ul className="space-y-1">
              {missingCapabilities.map(cap => (
                <li key={cap.name}>
                  <span className="font-medium text-foreground">
                    {cap.name}
                  </span>{' '}
                  — {cap.reason}.
                </li>
              ))}
            </ul>
            <p className="text-center">
              Please use a recent version of Chrome, Edge, or another compatible
              browser.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading state while checking capabilities
  if (webGPUSupported === null || audioEncoderSupported === null) {
    return null;
  }

  // Processing view -- shown when pipeline is running (from upload, project list, or URL-based resume)
  if (isProcessing) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 w-full gap-6">
        <div className="px-4 py-2 self-start">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackToProjects}
            className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back to Projects
          </Button>
        </div>
        <ConnectedProcessingView
          store={runner.store}
          taskKey="transcribe-drums"
          title={runRequest.title}
          description="This may take a few minutes depending on the audio length."
          error={runError}
          onRetry={handleRetryPipeline}
          onCancel={handleCancelPipeline}
        />
      </div>
    );
  }

  // If a project is selected, show the editor (or brief checking state)
  if (projectId) {
    // Still checking the project stage — show brief loading state
    if (checkingProject) {
      return (
        <div className="flex flex-col items-center justify-center flex-1 gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            Checking project status...
          </p>
        </div>
      );
    }

    // Project needs processing but the run hasn't started yet (shouldn't
    // normally happen since checkProjectStage starts one, which triggers the
    // isProcessing branch above, but guard against the brief gap)
    if (projectNeedsProcessing) {
      return (
        <div className="flex flex-col items-center justify-center flex-1 gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Preparing pipeline...</p>
        </div>
      );
    }

    // A ready project is edited on `/chart-editor`; this branch is the
    // moment between that decision and the navigation landing.
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Opening editor...</p>
      </div>
    );
  }

  // No project selected -- the landing page, whose action area is this
  // screen's own entry controls (source picker + the projects it started).
  return (
    <DrumTranscriptionLanding
      toolEntry={
        <>
          {/* Either/or entry point: audio-only (unchanged) vs an existing chart
              package, whose SyncTrack/audio drive transcription (chart-flow
              feature). */}
          <SectionDropZone
            onAudioFile={handleStartPipeline}
            onChartLoaded={handleChartPackageLoaded}
            disabled={isProcessing}>
            <ToolEntryCard
              description={
                <>
                  Predicts drum notes from the audio, right in your browser. An
                  existing chart&rsquo;s tempo map is used instead of a
                  predicted one, which avoids most note-position errors.
                </>
              }
              footnote={
                <>
                  Everything runs on your computer. Nothing is uploaded. The
                  first run downloads about 515 MB of models: the drum
                  separator, the transcription model, and the beat tracker used
                  to build the tempo map.
                </>
              }>
              <SourcePicker
                onFileSelected={handleStartPipeline}
                onChartLoaded={handleChartPackageLoaded}
                chartFlowError={chartFlowError}
                disabled={isProcessing}
              />
            </ToolEntryCard>
          </SectionDropZone>

          {/* Projects started from this page. `/chart-editor` lists them all. */}
          {(loadingProjects || projects.length > 0) && (
            <Card className="w-full">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FolderOpen className="h-5 w-5" />
                  Existing Projects
                </CardTitle>
                <CardDescription>
                  Open a previously created project.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ProjectList
                  records={projects}
                  pageOrigin="drum-transcription"
                  loading={loadingProjects}
                  onOpen={record => void handleSelectProject(record)}
                  onRename={handleRenameProject}
                  onDelete={handleDeleteProject}
                />
              </CardContent>
            </Card>
          )}
        </>
      }
    />
  );
}

/** One pipeline run this screen can start, kept so Retry can re-run exactly
 *  the same request and the header can name what is processing. */
interface PipelineRunRequest {
  title: string;
  run: TranscribeDrumsRun;
  onSuccess: (projectId: string) => void;
}

export default function DrumTranscriptionClient() {
  useToolLandingView('drum-transcription');
  return (
    <>
      <OrtRuntimeScript />
      <Suspense fallback={null}>
        <DrumTranscriptionInner />
      </Suspense>
    </>
  );
}
