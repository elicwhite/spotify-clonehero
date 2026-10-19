'use client';

/**
 * Drop target for a single audio file, styled to match
 * `components/chart-picker/ChartDropZone` so the two entry points on the
 * landing screen read as siblings. It hands the raw bytes and the decoded
 * duration up; what gets built from them is the caller's business.
 */

import {useCallback, useRef, useState} from 'react';
import {Music} from 'lucide-react';
import {toast} from 'sonner';
import DropZoneShell from '@/components/chart-picker/DropZoneShell';

/** Extensions Clone Hero packages carry, and that `decodeAudioData` can read. */
const AUDIO_EXTENSIONS = [
  '.mp3',
  '.ogg',
  '.opus',
  '.wav',
  '.flac',
  '.m4a',
] as const;

export interface DroppedAudio {
  fileName: string;
  data: Uint8Array;
  durationSeconds: number;
}

interface AudioDropZoneProps {
  onDropped: (audio: DroppedAudio) => void;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

function hasAudioExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return AUDIO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export default function AudioDropZone({
  onDropped,
  disabled,
  className,
}: AudioDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!hasAudioExtension(file.name)) {
        toast.error('Please drop an audio file');
        return;
      }

      setIsLoading(true);
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        // Decoding here rather than after the project exists means a file the
        // browser cannot read fails before anything is written to disk.
        const ctx = new AudioContext();
        let durationSeconds: number;
        try {
          const buffer = await ctx.decodeAudioData(data.slice().buffer);
          durationSeconds = buffer.duration;
        } finally {
          void ctx.close();
        }
        onDropped({fileName: file.name, data, durationSeconds});
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : 'Could not read that audio file',
        );
      } finally {
        setIsLoading(false);
      }
    },
    [onDropped],
  );

  const busy = disabled || isLoading;

  return (
    <div className={className}>
      <DropZoneShell
        icon={<Music className="h-8 w-8" />}
        label={
          isLoading
            ? 'Reading audio...'
            : 'Drop an audio file here, or click to browse'
        }
        isDragging={isDragging}
        inert={busy}
        onDrop={e => {
          e.preventDefault();
          setIsDragging(false);
          if (busy) return;
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
        onDragOver={e => {
          e.preventDefault();
          if (!busy) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => {
          if (!busy) fileInputRef.current?.click();
        }}>
        <input
          ref={fileInputRef}
          type="file"
          accept={AUDIO_EXTENSIONS.join(',')}
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
      </DropZoneShell>
    </div>
  );
}
