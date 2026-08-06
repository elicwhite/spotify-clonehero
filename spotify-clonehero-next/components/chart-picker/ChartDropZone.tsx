'use client';

import {useCallback, useRef, useState} from 'react';
import {Upload, FolderOpen} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import DropZoneShell, {OrDivider} from './DropZoneShell';
import {
  readChartDirectory,
  readZipFile,
  readSngFile,
  detectFormat,
  type LoadedFiles,
} from './chart-file-readers';

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

  const handleFile = useCallback(
    async (file: File) => {
      const format = detectFormat(file);
      if (!format) {
        toast.error('Please drop a .zip or .sng file');
        return;
      }

      setIsLoading(true);
      try {
        const result =
          format === 'zip' ? await readZipFile(file) : await readSngFile(file);
        onLoaded(result);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to read file');
      } finally {
        setIsLoading(false);
      }
    },
    [onLoaded],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled || isLoading) return;

      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile, disabled, isLoading],
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

  const handlePickFolder = useCallback(async () => {
    if (disabled || isLoading) return;
    try {
      const dirHandle = await window.showDirectoryPicker({id});
      setIsLoading(true);
      const result = await readChartDirectory(dirHandle);
      onLoaded(result);
    } catch (e: any) {
      if (e.name === 'AbortError') return; // User cancelled
      toast.error(e.message ?? 'Failed to read directory');
    } finally {
      setIsLoading(false);
    }
  }, [onLoaded, disabled, isLoading, id]);

  return (
    <div className={cn('space-y-3', className)}>
      <DropZoneShell
        icon={<Upload className="h-8 w-8" />}
        label={
          isLoading
            ? 'Reading files...'
            : 'Drop a .zip or .sng file here, or click to browse'
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
