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
import Script from 'next/script';
import {
  AlertTriangle,
  Loader2,
  ArrowLeft,
  FolderOpen,
  Trash2,
} from 'lucide-react';
import {toast} from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
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
import AudioUploader from './components/AudioUploader';
import ChartDropZone from '@/components/chart-picker/ChartDropZone';
import type {LoadedFiles} from '@/components/chart-picker/chart-file-readers';
import {readChart} from '@/lib/chart-edit';
import {findAudioFiles} from '@/lib/preview/chorus-chart-processing';
import ProcessingView, {type ProcessingStep} from '@/components/ProcessingView';
import {
  createPipelineStepTimer,
  markStepCompletions,
  pipelineProgressToSteps,
} from './components/pipelineToSteps';
import EditorApp from './components/EditorApp';
import {ChartEditorProvider} from '@/components/chart-editor/ChartEditorContext';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '@/components/chart-editor/scope';
import {
  listProjects,
  getProject,
  deleteProject,
  type ProjectSummary,
} from '@/lib/drum-transcription/storage/opfs';
import {
  runPipeline,
  runPipelineFromChart,
  resumePipeline,
  type PipelineProgress,
  type PipelineStep,
} from '@/lib/drum-transcription/pipeline/runner';

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

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  // Tracks whether we've completed at least one listProjects() call.
  // Used to derive loadingProjects below, so the effect doesn't need
  // to flip a loading flag synchronously before kicking off the fetch.
  const [projectsLoaded, setProjectsLoaded] = useState(false);

  // Pipeline state
  const [pipelineProgress, setPipelineProgress] =
    useState<PipelineProgress | null>(null);
  const [pipelineAudioFile, setPipelineAudioFile] = useState<File | null>(null);
  const stepTimerRef = useRef(createPipelineStepTimer());
  const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>([]);

  // Entry-point picker: audio-only (existing behavior, unchanged) vs an
  // existing chart package, whose SyncTrack/audio drive transcription
  // (chart-flow feature). `null` shows both options; the audio-only path
  // never sets this away from `null` before handing off to ProcessingView.
  const [sourceMode, setSourceMode] = useState<'audio' | 'chart' | null>(null);
  const [chartFlowError, setChartFlowError] = useState<string | null>(null);

  // Derive the ProcessingView step list from progress + a wall-clock
  // timer. The timer is a mutable ref read and updated only inside this
  // effect's callbacks (never during render): pipelineProgressToSteps
  // records per-step start/completion times and smoothed ETA values that
  // must persist across renders.
  //
  // recompute runs immediately when progress changes and again once per
  // second so the active step's elapsed-based ETA refreshes even when the
  // worker hasn't sent a new progress message. The runner doesn't
  // separately notify us that a previous step finished, so we mark
  // completions before converting (advancing past a step implicitly
  // completes it).
  useEffect(() => {
    if (!pipelineProgress) {
      // Reset the timer so the next pipeline starts with fresh wall-clock
      // tracking. processingSteps isn't cleared here: it's only read while
      // pipelineProgress is non-null, and recompute() below overwrites it
      // the moment a new pipeline starts.
      stepTimerRef.current = createPipelineStepTimer();
      return;
    }
    const recompute = () => {
      markStepCompletions(pipelineProgress, stepTimerRef.current);
      setProcessingSteps(
        pipelineProgressToSteps(pipelineProgress, stepTimerRef.current),
      );
    };
    recompute();
    const id = setInterval(recompute, 1000);
    return () => clearInterval(id);
  }, [pipelineProgress]);

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

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);

  const isProcessing =
    pipelineProgress !== null &&
    pipelineProgress.step !== 'ready' &&
    pipelineProgress.step !== 'error' &&
    pipelineProgress.step !== 'idle';

  // When projectId is set via URL, check if the project needs pipeline work
  // before rendering EditorApp (which would show a generic spinner and fail
  // because chart files don't exist yet for incomplete projects).
  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    async function checkProjectStage() {
      try {
        const meta = await getProject(projectId!);
        if (cancelled) return;

        if (meta.stage === 'editing' || meta.stage === 'exported') {
          // Project is ready for the editor
          setProjectCheck({projectId: projectId!, needsProcessing: false});
          return;
        }

        // Project needs pipeline processing — show ProcessingView and resume
        setProjectCheck({projectId: projectId!, needsProcessing: true});

        const initialStep: PipelineStep =
          meta.stage === 'uploaded'
            ? 'decoding'
            : meta.stage === 'separating'
              ? 'separating'
              : 'transcribing';

        setPipelineProgress({
          step: initialStep,
          progress: 0,
          projectId: projectId!,
          projectName: meta.name,
        });

        try {
          await resumePipeline(projectId!, progress => {
            if (!cancelled) setPipelineProgress(progress);
          });

          if (cancelled) return;

          toast.success('Processing complete! Opening editor.');
          setPipelineProgress(null);
          setProjectCheck({projectId: projectId!, needsProcessing: false});
        } catch (err) {
          if (cancelled) return;
          const message =
            err instanceof Error ? err.message : 'Pipeline failed';
          console.error('Resume pipeline error (URL):', err);
          setPipelineProgress({
            step: 'error',
            progress: 0,
            projectId: projectId!,
            projectName: meta.name,
            error: message,
          });
          toast.error(message);
        }
      } catch {
        if (cancelled) return;
        // Can't load metadata — let EditorApp handle the error
        setProjectCheck({projectId: projectId!, needsProcessing: false});
      }
    }

    checkProjectStage();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Load project list when no project is selected and not processing.
  // All state writes happen in promise callbacks (post-await), so the
  // effect body itself does no synchronous setState.
  const shouldLoadProjects = !projectId && !isProcessing;
  const loadingProjects = shouldLoadProjects && !projectsLoaded;
  useEffect(() => {
    if (!shouldLoadProjects) return;

    let cancelled = false;
    listProjects()
      .then(result => {
        if (!cancelled) {
          setProjects(result);
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

  // Wait for ORT to be ready, showing loading-runtime step.
  // Returns a promise that resolves once ortReady is true.
  const waitForOrt = useCallback((projectName: string, projectId?: string) => {
    return new Promise<void>(resolve => {
      // Check immediately — ORT may already be loaded
      if ((globalThis as any).ort) {
        resolve();
        return;
      }

      setPipelineProgress({
        step: 'loading-runtime',
        progress: 0,
        projectId,
        projectName,
      });

      // Poll for ORT availability (the Script onReady will set it,
      // but we also check the global directly for robustness)
      const interval = setInterval(() => {
        if ((globalThis as any).ort) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }, []);

  // Handle audio upload -> start pipeline
  const handleStartPipeline = useCallback(
    async (file: File) => {
      setPipelineAudioFile(file);

      try {
        // Wait for ONNX Runtime to load
        await waitForOrt(file.name);

        setPipelineProgress({
          step: 'decoding',
          progress: 0,
          projectName: file.name,
        });

        const finalProjectId = await runPipeline(file, file.name, progress => {
          setPipelineProgress(progress);
        });

        // Pipeline complete -- navigate to editor
        toast.success('Processing complete! Opening editor.');
        setPipelineProgress(null);
        setPipelineAudioFile(null);
        router.push(`/drum-transcription?project=${finalProjectId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Pipeline failed';
        console.error('Pipeline error:', err);
        setPipelineProgress(prev => ({
          step: 'error',
          progress: 0,
          projectId: prev?.projectId,
          projectName: prev?.projectName,
          error: message,
        }));
        toast.error(message);
      }
    },
    [router, waitForOrt],
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
        // The primary song audio: the largest audio file, which is the
        // full mix in nearly every real chart package (stems, when present,
        // are smaller partial mixes).
        const primary = audioFiles.reduce((a, b) =>
          b.data.length > a.data.length ? b : a,
        );
        const primaryAudioFile = new File(
          [primary.data as BlobPart],
          primary.fileName,
        );
        const primaryNameLower = primary.fileName.toLowerCase();
        const chartFileNames = new Set([
          'notes.chart',
          'notes.mid',
          'song.ini',
        ]);
        const extraAssets = loaded.files.filter(
          f =>
            !chartFileNames.has(f.fileName.toLowerCase()) &&
            f.fileName.toLowerCase() !== primaryNameLower,
        );

        setPipelineAudioFile(primaryAudioFile);
        await waitForOrt(primaryAudioFile.name);

        setPipelineProgress({
          step: 'decoding',
          progress: 0,
          projectName: primaryAudioFile.name,
        });

        const finalProjectId = await runPipelineFromChart(
          {
            chartDoc,
            audioFile: primaryAudioFile,
            packageInfo: {
              sourceFormat: loaded.sourceFormat,
              originalName: loaded.originalName,
              sngMetadata: loaded.sngMetadata,
            },
            extraAssets,
          },
          progress => setPipelineProgress(progress),
        );

        toast.success('Processing complete! Opening editor.');
        setPipelineProgress(null);
        setPipelineAudioFile(null);
        router.push(`/drum-transcription?project=${finalProjectId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Pipeline failed';
        console.error('Chart-flow pipeline error:', err);
        setChartFlowError(message);
        setPipelineProgress(prev => ({
          step: 'error',
          progress: 0,
          projectId: prev?.projectId,
          projectName: prev?.projectName,
          error: message,
        }));
        toast.error(message);
      }
    },
    [router, waitForOrt],
  );

  // Handle selecting an existing project
  const handleSelectProject = useCallback(
    async (id: string) => {
      try {
        const meta = await getProject(id);

        // If project is already in editing stage, go straight to editor
        if (meta.stage === 'editing' || meta.stage === 'exported') {
          router.push(`/drum-transcription?project=${id}`);
          return;
        }

        // Wait for ONNX Runtime before resuming pipeline
        await waitForOrt(meta.name, id);

        // Resume the pipeline — map the project stage to the
        // correct pipeline step so ProcessingView highlights the right stage.
        const initialStep: PipelineStep =
          meta.stage === 'uploaded'
            ? 'decoding'
            : meta.stage === 'separating'
              ? 'separating'
              : 'transcribing';

        setPipelineProgress({
          step: initialStep,
          progress: 0,
          projectId: id,
          projectName: meta.name,
        });

        try {
          await resumePipeline(id, progress => {
            setPipelineProgress(progress);
          });

          toast.success('Processing complete! Opening editor.');
          setPipelineProgress(null);
          router.push(`/drum-transcription?project=${id}`);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Pipeline failed';
          console.error('Resume pipeline error:', err);
          setPipelineProgress({
            step: 'error',
            progress: 0,
            projectId: id,
            projectName: meta.name,
            error: message,
          });
          toast.error(message);
        }
      } catch {
        // If we can't even load the project metadata, just try the editor
        router.push(`/drum-transcription?project=${id}`);
      }
    },
    [router, waitForOrt],
  );

  // Handle demo button
  const handleTryDemo = useCallback(async () => {
    try {
      // Wait for ONNX Runtime to load
      await waitForOrt('Demo Drum Sample');

      setPipelineProgress({
        step: 'decoding',
        progress: 0,
        projectName: 'Demo Drum Sample',
      });

      const response = await fetch('/drumsample.mp3');
      if (!response.ok) {
        throw new Error('Failed to fetch demo audio file');
      }
      const blob = await response.blob();
      const file = new File([blob], 'Demo Drum Sample.mp3', {
        type: 'audio/mpeg',
      });

      const finalProjectId = await runPipeline(file, file.name, progress => {
        setPipelineProgress(progress);
      });

      toast.success('Processing complete! Opening editor.');
      setPipelineProgress(null);
      router.push(`/drum-transcription?project=${finalProjectId}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to process demo';
      console.error('Demo pipeline error:', err);
      setPipelineProgress(prev => ({
        step: 'error',
        progress: 0,
        projectId: prev?.projectId,
        projectName: prev?.projectName ?? 'Demo Drum Sample',
        error: message,
      }));
      toast.error(message);
    }
  }, [router, waitForOrt]);

  const handleRetryPipeline = useCallback(() => {
    if (pipelineProgress?.projectId) {
      // Resume existing project
      handleSelectProject(pipelineProgress.projectId);
    } else if (pipelineAudioFile) {
      // Re-run with the same file
      handleStartPipeline(pipelineAudioFile);
    }
  }, [
    pipelineProgress,
    pipelineAudioFile,
    handleSelectProject,
    handleStartPipeline,
  ]);

  const handleCancelPipeline = useCallback(() => {
    setPipelineProgress(null);
    setPipelineAudioFile(null);
    // Preserve the tag for the current project so checkingProject stays
    // false; we've just decided this project no longer needs processing.
    setProjectCheck(prev =>
      prev ? {projectId: prev.projectId, needsProcessing: false} : null,
    );
  }, []);

  const handleBackToProjects = useCallback(() => {
    router.push('/drum-transcription');
  }, [router]);

  const handleDeleteProject = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteProject(deleteTarget.id);
      setProjects(prev => prev.filter(p => p.id !== deleteTarget.id));
      toast.success(`Deleted "${deleteTarget.name}"`);
    } catch (err) {
      console.error('Failed to delete project:', err);
      toast.error('Failed to delete project');
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget]);

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
  if (isProcessing || pipelineProgress?.step === 'error') {
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
        <ProcessingView
          title={
            pipelineProgress?.projectName
              ? `Processing: ${pipelineProgress.projectName}`
              : 'Processing'
          }
          description="This may take a few minutes depending on the audio length."
          steps={processingSteps}
          error={
            pipelineProgress?.step === 'error'
              ? (pipelineProgress.error ?? 'An unexpected error occurred.')
              : undefined
          }
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

    // Project needs processing but pipeline hasn't started yet (shouldn't normally
    // happen since checkProjectStage sets pipelineProgress which triggers the
    // isProcessing branch above, but guard against the brief gap)
    if (projectNeedsProcessing) {
      return (
        <div className="flex flex-col items-center justify-center flex-1 gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Preparing pipeline...</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden">
        <div className="px-4 py-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackToProjects}
            className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back to Projects
          </Button>
        </div>
        <ChartEditorProvider activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
          <EditorApp projectId={projectId} />
        </ChartEditorProvider>
      </div>
    );
  }

  // No project selected -- show upload + project list
  return (
    <div className="flex flex-col items-center justify-center flex-1 w-full max-w-2xl gap-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Drum Transcription
        </h1>
        <p className="text-muted-foreground">
          Upload a song to separate stems, transcribe drums, and edit the chart
          in a Clone Hero highway editor.
        </p>
      </div>

      {/* Either/or entry point: audio-only (unchanged) vs an existing chart
          package, whose SyncTrack/audio drive transcription (chart-flow
          feature). */}
      {sourceMode === null && (
        <Card className="w-full">
          <CardContent className="pt-6 flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground text-center">
              Have a chart already? Reuse its tempo map instead of predicting
              one from scratch — this measurably improves note placement.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 w-full">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setSourceMode('audio')}>
                Just a song (create a new chart)
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setSourceMode('chart')}>
                <FolderOpen className="h-4 w-4 mr-2" />
                Use an existing chart
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {sourceMode === 'audio' && (
        <div className="w-full space-y-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSourceMode(null)}
            className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Grid source: <strong>predicted</strong> — the tempo map is
            estimated from the audio.
          </p>
          <AudioUploader
            onFileSelected={handleStartPipeline}
            onTryDemo={handleTryDemo}
          />
        </div>
      )}

      {sourceMode === 'chart' && (
        <Card className="w-full">
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSourceMode(null)}
                className="gap-1">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Grid source: <strong>provided</strong> — notes will be snapped
              to this chart&apos;s own tempo map, not a predicted one.
            </p>
            <ChartDropZone
              onLoaded={handleChartPackageLoaded}
              id="drum-transcription-chart"
              disabled={isProcessing}
            />
            {chartFlowError && (
              <p className="text-xs text-destructive text-center">
                {chartFlowError}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Existing projects */}
      {loadingProjects && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading projects...
        </div>
      )}

      {!loadingProjects && projects.length > 0 && (
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
            <div className="space-y-2">
              {projects.map(project => (
                <div
                  key={project.id}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg border hover:bg-accent/50 transition-colors">
                  <button
                    onClick={() => handleSelectProject(project.id)}
                    className="flex-1 text-left min-w-0">
                    <p className="text-sm font-medium">{project.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatStage(project.stage)} &middot; Updated{' '}
                      {new Date(project.updatedAt).toLocaleDateString()}
                    </p>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-2 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={e => {
                      e.stopPropagation();
                      setDeleteTarget(project);
                    }}>
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Delete {project.name}</span>
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="text-center text-xs text-muted-foreground space-y-1">
        <p>
          Everything runs locally in your browser. No audio is uploaded to any
          server.
        </p>
        <p>
          Powered by Demucs (stem separation) and ADTOF (drum transcription) via
          ONNX + WebGPU.
        </p>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={open => {
          if (!open) setDeleteTarget(null);
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this project on this website.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProject}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Format a project stage for display.
 */
function formatStage(stage: string): string {
  switch (stage) {
    case 'uploaded':
      return 'Uploaded (processing needed)';
    case 'separating':
      return 'Separating stems...';
    case 'transcribing':
      return 'Transcribing drums...';
    case 'editing':
      return 'Ready to edit';
    case 'exported':
      return 'Exported';
    default:
      return stage;
  }
}

/** ONNX Runtime CDN URL — must match the version used by demucs-next. */
const ORT_CDN_URL =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.0-dev.20251116-b39e144322/dist/ort.min.js';

export default function DrumTranscriptionClient() {
  return (
    <>
      {/* Load ONNX Runtime Web from CDN (avoids bundling ~20MB WASM files).
          Uses afterInteractive so the page renders first, then the script loads. */}
      <Script src={ORT_CDN_URL} strategy="afterInteractive" />
      <Suspense fallback={null}>
        <DrumTranscriptionInner />
      </Suspense>
    </>
  );
}
