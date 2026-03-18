'use client';

import {Suspense, useCallback, useEffect, useState} from 'react';
import {useSearchParams, useRouter} from 'next/navigation';
import {AlertTriangle, Loader2, ArrowLeft, FolderOpen} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import AudioUploader, {
  type AudioUploadResult,
} from './components/AudioUploader';
import EditorApp from './components/EditorApp';
import {EditorProvider} from './contexts/EditorContext';
import {
  listProjects,
  type ProjectSummary,
} from '@/lib/drum-transcription/storage/opfs';

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
function DrumTranscriptionInner() {
  const webGPUSupported = useWebGPUCheck();
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = searchParams.get('project');

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  // Load project list when no project is selected
  useEffect(() => {
    if (!projectId) {
      setLoadingProjects(true);
      listProjects()
        .then(setProjects)
        .catch(() => setProjects([]))
        .finally(() => setLoadingProjects(false));
    }
  }, [projectId]);

  const handleAudioReady = useCallback(
    (result: AudioUploadResult) => {
      router.push(`/drum-transcription?project=${result.projectId}`);
    },
    [router],
  );

  const handleSelectProject = useCallback(
    (id: string) => {
      router.push(`/drum-transcription?project=${id}`);
    },
    [router],
  );

  const handleBackToProjects = useCallback(() => {
    router.push('/drum-transcription');
  }, [router]);

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

  // If a project is selected, show the editor
  if (projectId) {
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)] w-full">
        <div className="px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackToProjects}
            className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back to Projects
          </Button>
        </div>
        <EditorProvider>
          <EditorApp projectId={projectId} />
        </EditorProvider>
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

      <AudioUploader onAudioReady={handleAudioReady} />

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
                <button
                  key={project.id}
                  onClick={() => handleSelectProject(project.id)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg border hover:bg-accent/50 transition-colors text-left">
                  <div>
                    <p className="text-sm font-medium">{project.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {project.stage} &middot; Updated{' '}
                      {new Date(project.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                </button>
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
    </div>
  );
}

export default function DrumTranscriptionPage() {
  return (
    <Suspense fallback={null}>
      <DrumTranscriptionInner />
    </Suspense>
  );
}
