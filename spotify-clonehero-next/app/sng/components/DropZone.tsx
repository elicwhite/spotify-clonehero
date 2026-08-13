'use client';

import {useCallback, useRef, useState} from 'react';
import {Upload, FilePlus, FolderOpen} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import type {File as FileEntry} from '@eliwhite/scan-chart';
import {
  readChartDirectory,
  readChartFileList,
} from '@/lib/chart-files/chart-package';
import {
  pickFiles,
  readDroppedItems,
  readFileList,
} from '@/lib/chart-files/entries';

interface DropZoneProps {
  onAdd: (files: FileEntry[]) => void;
  disabled?: boolean;
}

export default function DropZone({onAdd, disabled}: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

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

  const handleSelectFiles = useCallback(async () => {
    if (busy) return;
    try {
      // A distinct picker id keeps its own remembered location.
      const files = await pickFiles({id: 'sng-add-files', multiple: true});
      if (!files) return;
      setIsReading(true);
      onAdd(await readFileList(files));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to read files');
    } finally {
      setIsReading(false);
    }
  }, [busy, onAdd]);

  const addFolder = useCallback(
    async (read: () => Promise<{files: FileEntry[]}>) => {
      setIsReading(true);
      try {
        onAdd((await read()).files);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to read folder',
        );
      } finally {
        setIsReading(false);
      }
    },
    [onAdd],
  );

  const handlePickFolder = useCallback(async () => {
    if (busy) return;

    // showDirectoryPicker is Chromium-only; elsewhere a directory <input>
    // reads the same folder.
    if (typeof window.showDirectoryPicker !== 'function') {
      folderInputRef.current?.click();
      return;
    }

    let dirHandle: FileSystemDirectoryHandle;
    try {
      dirHandle = await window.showDirectoryPicker({id: 'sng-add-folder'});
    } catch (err) {
      // showDirectoryPicker rejects with an AbortError DOMException on cancel.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      toast.error(err instanceof Error ? err.message : 'Failed to read folder');
      return;
    }
    await addFolder(() => readChartDirectory(dirHandle));
  }, [busy, addFolder]);

  const handleFolderInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selection = Array.from(e.target.files ?? []);
      e.target.value = '';
      // A directory input reports a cancelled dialog as an empty selection.
      if (selection.length === 0) return;
      await addFolder(() => readChartFileList(selection));
    },
    [addFolder],
  );

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
          onClick={handleSelectFiles}>
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
        <input
          ref={folderInputRef}
          type="file"
          webkitdirectory=""
          onChange={handleFolderInput}
          className="hidden"
        />
      </div>
    </div>
  );
}
