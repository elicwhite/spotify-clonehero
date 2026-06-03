'use client';

import {useCallback, useRef, useState} from 'react';
import {Upload, FilePlus, FolderOpen} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {
  readChartDirectory,
  type FileEntry,
} from '@/components/chart-picker/chart-file-readers';
import {readDroppedItems, readFileList} from '@/lib/sng/read-dropped-entries';

interface DropZoneProps {
  onAdd: (files: FileEntry[]) => void;
  disabled?: boolean;
}

export default function DropZone({onAdd, disabled}: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = disabled || isReading;

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (busy) return;
      setIsReading(true);
      try {
        const entries = await readDroppedItems(e.dataTransfer);
        if (entries.length === 0) {
          toast.error('No files found in what you dropped');
        } else {
          onAdd(entries);
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to read dropped files',
        );
      } finally {
        setIsReading(false);
      }
    },
    [busy, onAdd],
  );

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (list && list.length > 0) {
        setIsReading(true);
        try {
          onAdd(await readFileList(list));
        } finally {
          setIsReading(false);
        }
      }
      e.target.value = '';
    },
    [onAdd],
  );

  const handlePickFolder = useCallback(async () => {
    if (busy) return;
    try {
      const dirHandle = await window.showDirectoryPicker({
        id: 'sng-add-folder',
      });
      setIsReading(true);
      const result = await readChartDirectory(dirHandle);
      onAdd(result.files);
    } catch (err) {
      // showDirectoryPicker rejects with an AbortError DOMException on cancel.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      toast.error(err instanceof Error ? err.message : 'Failed to read folder');
    } finally {
      setIsReading(false);
    }
  }, [busy, onAdd]);

  return (
    <div
      onDrop={handleDrop}
      onDragOver={e => {
        e.preventDefault();
        if (!busy) setIsDragging(true);
      }}
      onDragLeave={e => {
        e.preventDefault();
        setIsDragging(false);
      }}
      className={cn(
        'rounded-lg border-2 border-dashed p-6 text-center transition-colors',
        isDragging
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-muted-foreground/50',
        busy && 'opacity-50',
      )}>
      <Upload className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
      <p className="mb-3 text-sm text-muted-foreground">
        {isReading
          ? 'Reading files…'
          : 'Drag files or folders here to add them to the package'}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}>
          <FilePlus className="mr-2 h-4 w-4" />
          Select files
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={handlePickFolder}>
          <FolderOpen className="mr-2 h-4 w-4" />
          Add folder
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInput}
        className="hidden"
      />
    </div>
  );
}
