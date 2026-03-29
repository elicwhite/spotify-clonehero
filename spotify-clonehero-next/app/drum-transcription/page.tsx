'use client';

import {Suspense, useCallback, useEffect, useState} from 'react';
import {useSearchParams, useRouter} from 'next/navigation';
import Script from 'next/script';
import {AlertTriangle, Loader2, ArrowLeft, FolderOpen, Trash2} from 'lucide-react';
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
import ProcessingView from './components/ProcessingView';
import EditorApp from './components/EditorApp';
import {ChartEditorProvider} from '@/components/chart-editor/ChartEditorContext';
import {
  listProjects,
  getProject,
  deleteProject,
  type ProjectSummary,
} from '@/lib/drum-transcription/storage/opfs';
import {
  runPipeline,
  resumePipeline,
  type PipelineProgress,
  type PipelineStep,
} from '@/lib/drum-transcription/pipeline/runner';

function useWebGPUCheck() {
  const [supported, setSupported] = useState<boolean | null>(null);

  // Check after hydration to avoid server/client mismatch
  useEffect(() => {
    setSupported('gpu' in navigator);
  }, []);

  return supported;
}

/**
 * Inner component that reads search params.
 * Must be wrapped in Suspense because useSearchParams() requires it.
 */
function DrumTranscriptionInner({ortReady}: {ortReady: boolean}) {
  const webGPUSupported = useWebGPUCheck();
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = searchParams.get('project');

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  // Pipeline state
  const [pipelineProgress, setPipelineProgress] =
    useState<PipelineProgress | null>(null);
  const [pipelineAudioFile, setPipelineAudioFile] = useState<File | null>(null);

  // Track whether a project opened via URL needs pipeline processing.
  // While checkingProject is true, we show a brief "Checking project..." state.
  // If projectNeedsProcessing becomes true, we show ProcessingView instead of EditorApp.
  const [checkingProject, setCheckingProject] = useState(false);
  const [projectNeedsProcessing, setProjectNeedsProcessing] = useState(false);

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
    if (!projectId) {
      setProjectNeedsProcessing(false);
      setCheckingProject(false);
      return;
    }

    let cancelled = false;

    async function checkProjectStage() {
      setCheckingProject(true);
      try {
        const meta = await getProject(projectId!);
        if (cancelled) return;

        if (meta.stage === 'editing' || meta.stage === 'exported') {
          // Project is ready for the editor
          setProjectNeedsProcessing(false);
          setCheckingProject(false);
          return;
        }

        // Project needs pipeline processing — show ProcessingView and resume
        setProjectNeedsProcessing(true);
        setCheckingProject(false);

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
          await resumePipeline(projectId!, (progress) => {
            if (!cancelled) setPipelineProgress(progress);
          });

          if (cancelled) return;

          toast.success('Processing complete! Opening editor.');
          setPipelineProgress(null);
          setProjectNeedsProcessing(false);
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
        setProjectNeedsProcessing(false);
        setCheckingProject(false);
      }
    }

    checkProjectStage();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Load project list when no project is selected and not processing
  useEffect(() => {
    if (!projectId && !isProcessing) {
      setLoadingProjects(true);
      listProjects()
        .then(setProjects)
        .catch(() => setProjects([]))
        .finally(() => setLoadingProjects(false));
    }
  }, [projectId, isProcessing]);

  // Wait for ORT to be ready, showing loading-runtime step.
  // Returns a promise that resolves once ortReady is true.
  const waitForOrt = useCallback(
    (projectName: string, projectId?: string) => {
      return new Promise<void>((resolve) => {
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
    },
    [],
  );

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

        const finalProjectId = await runPipeline(
          file,
          file.name,
          (progress) => {
            setPipelineProgress(progress);
          },
        );

        // Pipeline complete -- navigate to editor
        toast.success('Processing complete! Opening editor.');
        setPipelineProgress(null);
        setPipelineAudioFile(null);
        router.push(`/drum-transcription?project=${finalProjectId}`);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Pipeline failed';
        console.error('Pipeline error:', err);
        setPipelineProgress((prev) => ({
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
          await resumePipeline(id, (progress) => {
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

      const finalProjectId = await runPipeline(
        file,
        file.name,
        (progress) => {
          setPipelineProgress(progress);
        },
      );

      toast.success('Processing complete! Opening editor.');
      setPipelineProgress(null);
      router.push(`/drum-transcription?project=${finalProjectId}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to process demo';
      console.error('Demo pipeline error:', err);
      setPipelineProgress((prev) => ({
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
  }, [pipelineProgress, pipelineAudioFile, handleSelectProject, handleStartPipeline]);

  const handleCancelPipeline = useCallback(() => {
    setPipelineProgress(null);
    setPipelineAudioFile(null);
    setProjectNeedsProcessing(false);
  }, []);

  const handleBackToProjects = useCallback(() => {
    router.push('/drum-transcription');
  }, [router]);

  const handleDeleteProject = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteProject(deleteTarget.id);
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      toast.success(`Deleted "${deleteTarget.name}"`);
    } catch (err) {
      console.error('Failed to delete project:', err);
      toast.error('Failed to delete project');
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget]);

  // WebGPU check -- block access if not supported
  if (webGPUSupported === false) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 w-full max-w-lg gap-4">
        <Card className="w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>WebGPU Required</CardTitle>
            <CardDescription>
              Drum transcription requires WebGPU for ML inference. Your browser
              does not support WebGPU.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            <p>
              Please use a recent version of Chrome, Edge, or another
              WebGPU-enabled browser.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading state while checking WebGPU
  if (webGPUSupported === null) {
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
          progress={pipelineProgress!}
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
          <p className="text-sm text-muted-foreground">Checking project status...</p>
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
        <ChartEditorProvider>
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

      <AudioUploader
        onFileSelected={handleStartPipeline}
        onTryDemo={handleTryDemo}
      />

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
              {projects.map((project) => (
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
                    onClick={(e) => {
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
        onOpenChange={(open) => {
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

export default function DrumTranscriptionPage() {
  const [ortReady, setOrtReady] = useState(false);

  const handleOrtLoad = useCallback(() => {
    console.log('[ORT] Script loaded from CDN');
  }, []);

  const handleOrtReady = useCallback(() => {
    console.log('[ORT] Runtime ready');
    setOrtReady(true);
  }, []);

  return (
    <>
      {/* Load ONNX Runtime Web from CDN (avoids bundling ~20MB WASM files).
          Uses afterInteractive so the page renders first, then the script loads. */}
      <Script
        src={ORT_CDN_URL}
        strategy="afterInteractive"
        onLoad={handleOrtLoad}
        onReady={handleOrtReady}
      />
      <Suspense fallback={null}>
        <DrumTranscriptionInner ortReady={ortReady} />
      </Suspense>
    </>
  );
}
