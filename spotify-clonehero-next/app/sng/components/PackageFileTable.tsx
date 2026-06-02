'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {Play, Pause, Trash2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {hasAudioExtension} from '@/lib/src-shared/utils';
import {audioMimeType, formatBytes} from '@/lib/sng/file-utils';

export interface WorkingFile {
  id: string;
  fileName: string;
  data: Uint8Array;
}

interface PackageFileTableProps {
  files: WorkingFile[];
  onDelete: (id: string) => void;
}

export default function PackageFileTable({
  files,
  onDelete,
}: PackageFileTableProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const releaseUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  // Clean up the audio element + object URL on unmount.
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
      releaseUrl();
    };
  }, [releaseUrl]);

  // If the currently playing file was removed, stop the audio. We derive the
  // effective playing id for rendering (below) rather than resetting state
  // here, so this effect only touches the audio element.
  const playingExists = files.some(f => f.id === playingId);
  useEffect(() => {
    if (playingId && !playingExists) {
      audioRef.current?.pause();
      releaseUrl();
    }
  }, [playingId, playingExists, releaseUrl]);

  const effectivePlayingId = playingExists ? playingId : null;

  const togglePlay = useCallback(
    (file: WorkingFile) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (playingId === file.id) {
        audio.pause();
        setPlayingId(null);
        return;
      }

      audio.pause();
      releaseUrl();
      const url = URL.createObjectURL(
        new Blob([file.data as Uint8Array<ArrayBuffer>], {
          type: audioMimeType(file.fileName),
        }),
      );
      urlRef.current = url;
      audio.src = url;
      audio
        .play()
        .then(() => setPlayingId(file.id))
        .catch(() => setPlayingId(null));
    },
    [playingId, releaseUrl],
  );

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="w-24 text-right">Size</TableHead>
            <TableHead className="w-28 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={3}
                className="py-6 text-center text-sm text-muted-foreground">
                No files yet. Add some above.
              </TableCell>
            </TableRow>
          ) : (
            files.map(file => {
              const isAudio = hasAudioExtension(file.fileName);
              const isPlaying = effectivePlayingId === file.id;
              return (
                <TableRow key={file.id}>
                  <TableCell className="font-mono text-sm break-all">
                    {file.fileName}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {formatBytes(file.data.length)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {isAudio && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={isPlaying ? 'Pause' : 'Play'}
                          onClick={() => togglePlay(file)}>
                          {isPlaying ? (
                            <Pause className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete file"
                        onClick={() => onDelete(file.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
      <audio
        ref={audioRef}
        onEnded={() => setPlayingId(null)}
        className="hidden"
      />
    </>
  );
}
