'use client';

import {useCallback, useRef, useState} from 'react';
import {Upload, Music, FileAudio, Loader2, CheckCircle2} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import {cn} from '@/lib/utils';
import {decodeAudio, interleaveAudioBuffer} from '@/lib/drum-transcription/audio/decoder';
import {
  createAudioMetadata,
  formatDuration,
  formatFileSize,
  type AudioMetadata,
} from '@/lib/drum-transcription/audio/types';
import {
  createProject,
  storeAudio,
} from '@/lib/drum-transcription/storage/opfs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UploadStep = 'idle' | 'decoding' | 'storing' | 'done';

interface SelectedFileInfo {
  file: File;
  metadata: AudioMetadata;
}

export interface AudioUploadResult {
  projectId: string;
  metadata: AudioMetadata;
}

interface AudioUploaderProps {
  /** Called when audio has been decoded and stored in OPFS. */
  onAudioReady: (result: AudioUploadResult) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AudioUploader({onAudioReady}: AudioUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SelectedFileInfo | null>(
    null,
  );
  const [step, setStep] = useState<UploadStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|ogg|flac|aac|m4a|webm|opus|wma)$/i)) {
        toast.error('Please select an audio file (MP3, WAV, OGG, FLAC, etc.)');
        return;
      }

      setError(null);
      setStep('decoding');

      try {
        // Decode audio
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await decodeAudio(arrayBuffer);

        const metadata = createAudioMetadata(file, audioBuffer);
        setSelectedFile({file, metadata});

        // Check for very long audio
        if (metadata.durationMs > 30 * 60 * 1000) {
          toast.warning(
            'This audio is longer than 30 minutes. Processing may be very slow.',
          );
        }

        // Store in OPFS
        setStep('storing');

        const project = await createProject(metadata.name);
        const interleavedPcm = interleaveAudioBuffer(audioBuffer);
        await storeAudio(
          project.id,
          interleavedPcm,
          metadata,
          audioBuffer.length,
        );

        setStep('done');
        toast.success('Audio decoded and stored successfully');

        onAudioReady({projectId: project.id, metadata});
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to process audio file';
        setError(message);
        setStep('idle');
        toast.error(message);
      }
    },
    [onAudioReady],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile],
  );

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleTryDemo = useCallback(async () => {
    setError(null);
    setStep('decoding');

    try {
      const response = await fetch('/drumsample.mp3');
      if (!response.ok) {
        throw new Error('Failed to fetch demo audio file');
      }
      const blob = await response.blob();
      const file = new File([blob], 'Demo Drum Sample.mp3', {
        type: 'audio/mpeg',
      });
      await processFile(file);
    } catch (err) {
      // If processFile throws, it handles its own error. Only catch fetch errors.
      if (step === 'decoding') {
        const message =
          err instanceof Error ? err.message : 'Failed to load demo audio';
        setError(message);
        setStep('idle');
        toast.error(message);
      }
    }
  }, [processFile, step]);

  const isProcessing = step === 'decoding' || step === 'storing';

  return (
    <Card className="w-full">
      <CardContent className="pt-6">
        {/* Processing state */}
        {isProcessing && (
          <div className="flex flex-col items-center justify-center gap-4 py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">
                {step === 'decoding'
                  ? 'Decoding audio...'
                  : 'Storing audio...'}
              </p>
              <p className="text-xs text-muted-foreground">
                {step === 'decoding'
                  ? 'Converting to 44.1kHz stereo PCM'
                  : 'Saving to browser storage'}
              </p>
            </div>
          </div>
        )}

        {/* Success state */}
        {step === 'done' && selectedFile && (
          <div className="flex flex-col items-center justify-center gap-4 py-12">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Audio Ready</p>
              <FileInfo metadata={selectedFile.metadata} />
            </div>
          </div>
        )}

        {/* Upload zone (idle state) */}
        {step === 'idle' && (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={cn(
              'flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-12 transition-colors',
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-muted-foreground/50',
            )}>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Upload className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">
                Drag and drop an audio file here
              </p>
              <p className="text-xs text-muted-foreground">
                MP3, WAV, OGG, FLAC, or other browser-supported audio formats
              </p>
            </div>
            {error && (
              <p className="text-xs text-destructive text-center max-w-sm">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <Button variant="outline" onClick={handleBrowseClick}>
                Browse Files
              </Button>
              <Button variant="secondary" onClick={handleTryDemo}>
                <Music className="mr-2 h-4 w-4" />
                Try Demo
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleFileInput}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FileInfo({metadata}: {metadata: AudioMetadata}) {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <FileAudio className="h-3.5 w-3.5" />
        {metadata.originalFileName}
      </span>
      <span>{formatDuration(metadata.durationMs)}</span>
      <span>{formatFileSize(metadata.fileSizeBytes)}</span>
    </div>
  );
}
