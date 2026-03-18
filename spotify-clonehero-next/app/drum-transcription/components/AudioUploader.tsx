'use client';

import {useCallback, useRef, useState} from 'react';
import {Upload, Music} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Card, CardContent} from '@/components/ui/card';
import {cn} from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AudioUploaderProps {
  /** Called when the user selects an audio file (file upload or browse). */
  onFileSelected: (file: File) => void;
  /** Called when the user clicks "Try Demo". */
  onTryDemo: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AudioUploader({
  onFileSelected,
  onTryDemo,
}: AudioUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateAndSelect = useCallback(
    (file: File) => {
      if (
        !file.type.startsWith('audio/') &&
        !file.name.match(
          /\.(mp3|wav|ogg|flac|aac|m4a|webm|opus|wma)$/i,
        )
      ) {
        toast.error(
          'Please select an audio file (MP3, WAV, OGG, FLAC, etc.)',
        );
        return;
      }
      onFileSelected(file);
    },
    [onFileSelected],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        validateAndSelect(file);
      }
    },
    [validateAndSelect],
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
        validateAndSelect(file);
      }
    },
    [validateAndSelect],
  );

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <Card className="w-full">
      <CardContent className="pt-6">
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
          <div className="flex gap-3">
            <Button variant="outline" onClick={handleBrowseClick}>
              Browse Files
            </Button>
            <Button variant="secondary" onClick={onTryDemo}>
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
      </CardContent>
    </Card>
  );
}
