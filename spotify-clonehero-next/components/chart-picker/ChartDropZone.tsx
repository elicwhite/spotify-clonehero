'use client';

import {useCallback, useRef, useState} from 'react';
import {Upload, FolderOpen} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import DropZoneShell, {OrDivider} from './DropZoneShell';
import {
  readChartFile,
  readChartFolder,
  readDroppedChart,
  detectFormat,
  type LoadedFiles,
} from '@/lib/chart-files/chart-package';
import type {FolderSource} from '@/lib/file-access/folderSource';
import {pickFolder} from '@/lib/file-access/pickFolder';

const NOT_A_CHART_MESSAGE = 'Drop a chart folder, a .zip, or a .sng';

interface ChartDropZoneProps {
  onLoaded: (result: LoadedFiles) => void;
  disabled?: boolean;
  /** Persistent ID for the File System Access API directory picker. */
  id?: string;
  /** Additional CSS classes for the outer container. */
  className?: string;
}

export default function ChartDropZone({
  onLoaded,
  disabled,
  id = 'chart-picker',
  className,
}: ChartDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Read a chart package, holding the zone inert until it lands. Every way in
   *  reports failure the same way: a toast saying what was wrong with what the
   *  user chose. */
  const runLoad = useCallback(
    async (read: () => Promise<LoadedFiles>) => {
      setIsLoading(true);
      try {
        onLoaded(await read());
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to read chart');
      } finally {
        setIsLoading(false);
      }
    },
    [onLoaded],
  );

  const handleFile = useCallback(
    async (file: File) => {
      const format = detectFormat(file);
      if (!format) {
        toast.error(NOT_A_CHART_MESSAGE);
        return;
      }
      await runLoad(() => readChartFile(file, format));
    },
    [runLoad],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled || isLoading) return;

      // Called before the await inside: `dataTransfer` is emptied as soon as
      // this handler returns.
      const dropped = readDroppedChart(e.dataTransfer);
      void runLoad(async () => {
        const result = await dropped;
        if (result.kind !== 'chart') throw new Error(NOT_A_CHART_MESSAGE);
        return result.loaded;
      });
    },
    [runLoad, disabled, isLoading],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) setIsDragging(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [handleFile],
  );

  // Nothing downstream needs a handle: the folder is read once and exports go
  // out as downloads, so a file input does the job where there is no picker.
  const handlePickFolder = useCallback(async () => {
    if (disabled || isLoading) return;

    let folder: FolderSource | null;
    try {
      folder = await pickFolder({id});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to open the picker');
      return;
    }
    if (folder) await runLoad(() => readChartFolder(folder));
  }, [runLoad, disabled, isLoading, id]);

  return (
    <div className={cn('space-y-3', className)}>
      <DropZoneShell
        icon={<Upload className="h-8 w-8" />}
        label={
          isLoading
            ? 'Reading files...'
            : 'Drop a chart folder, .zip or .sng here, or click to browse'
        }
        isDragging={isDragging}
        inert={Boolean(disabled) || isLoading}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => {
          if (!disabled && !isLoading) fileInputRef.current?.click();
        }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,.sng"
          onChange={handleFileInput}
          className="hidden"
        />
      </DropZoneShell>

      <OrDivider />

      {/* Folder picker. Surfaces equal weight to the dropzone because
          folder selection is, in practice, the more common entrypoint
          users expect. */}
      <Button
        variant="outline"
        onClick={handlePickFolder}
        disabled={disabled || isLoading}
        className="w-full">
        <FolderOpen className="h-4 w-4 mr-2" />
        Select a chart folder
      </Button>
    </div>
  );
}
