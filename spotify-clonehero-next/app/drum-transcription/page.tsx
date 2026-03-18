'use client';

import {useCallback, useEffect, useState} from 'react';
import {AlertTriangle} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import AudioUploader, {
  type AudioUploadResult,
} from './components/AudioUploader';

type PageState = 'upload' | 'processing' | 'editing';

function useWebGPUCheck() {
  const [supported, setSupported] = useState<boolean | null>(null);

  // Check after hydration to avoid server/client mismatch
  useEffect(() => {
    setSupported('gpu' in navigator);
  }, []);

  return supported;
}

export default function DrumTranscriptionPage() {
  const webGPUSupported = useWebGPUCheck();
  const [pageState, setPageState] = useState<PageState>('upload');
  const [projectId, setProjectId] = useState<string | null>(null);

  const handleAudioReady = useCallback((result: AudioUploadResult) => {
    setProjectId(result.projectId);
    setPageState('processing');
  }, []);

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

      {pageState === 'upload' && (
        <AudioUploader onAudioReady={handleAudioReady} />
      )}

      {pageState === 'processing' && projectId && (
        <Card className="w-full">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <p className="text-sm font-medium">
                Audio stored. Next step: stem separation.
              </p>
              <p className="text-xs text-muted-foreground">
                Project ID: {projectId}
              </p>
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
