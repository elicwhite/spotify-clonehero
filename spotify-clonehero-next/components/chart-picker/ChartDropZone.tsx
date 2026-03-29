'use client';

import {useCallback, useRef, useState} from 'react';
import {Upload, FolderOpen} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
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
          format === 'zip'
            ? await readZipFile(file)
            : await readSngFile(file);
        onLoaded(result);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : 'Failed to read file',
        );
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
      {/* Drop zone for .zip/.sng files */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !disabled && !isLoading && fileInputRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-muted-foreground/50',
          (disabled || isLoading) && 'opacity-50 cursor-not-allowed',
        )}>
        <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {isLoading
            ? 'Reading files...'
            : 'Drop a .zip or .sng file here, or click to browse'}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,.sng"
          onChange={handleFileInput}
          className="hidden"
        />
      </div>

      {/* Folder picker button */}
      <Button
        variant="outline"
        size="sm"
        onClick={handlePickFolder}
        disabled={disabled || isLoading}
        className="w-full">
        <FolderOpen className="h-4 w-4 mr-2" />
        Or select a chart folder
      </Button>
    </div>
  );
}
