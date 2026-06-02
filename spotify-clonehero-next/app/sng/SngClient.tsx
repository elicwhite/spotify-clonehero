'use client';

import {useCallback, useState} from 'react';
import {toast} from 'sonner';
import {
  readSngFile,
  type FileEntry,
} from '@/components/chart-picker/chart-file-readers';
import {exportAsSng, exportAsZip} from '@/lib/chart-export';
import {dedupeByName} from '@/lib/sng/file-utils';
import SngLanding from './components/SngLanding';
import SngEditor from './components/SngEditor';
import type {WorkingFile} from './components/PackageFileTable';

type Mode = 'landing' | 'editor';

function toWorkingFiles(entries: FileEntry[]): WorkingFile[] {
  return entries.map(e => ({
    id: crypto.randomUUID(),
    fileName: e.fileName,
    data: e.data,
  }));
}

function sanitizeName(name: string): string {
  const trimmed = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return trimmed.length > 0 ? trimmed : 'song';
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function SngClient() {
  const [mode, setMode] = useState<Mode>('landing');
  const [files, setFiles] = useState<WorkingFile[]>([]);
  const [originalName, setOriginalName] = useState('new-song');

  const startCreate = useCallback(() => {
    setFiles([]);
    setOriginalName('new-song');
    setMode('editor');
  }, []);

  const startModify = useCallback(async (file: File) => {
    try {
      const loaded = await readSngFile(file);
      setFiles(toWorkingFiles(loaded.files));
      setOriginalName(loaded.originalName || 'song');
      setMode('editor');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to read .sng file');
    }
  }, []);

  const addEntries = useCallback((entries: FileEntry[]) => {
    setFiles(prev => {
      const {merged, skipped} = dedupeByName(prev, entries);
      if (skipped.length > 0) {
        toast.warning(
          `Skipped ${skipped.length} file${skipped.length === 1 ? '' : 's'} already in the package: ${skipped.join(', ')}`,
        );
      }
      if (merged.length > 0) {
        toast.success(
          `Added ${merged.length} file${merged.length === 1 ? '' : 's'}`,
        );
      }
      return [...prev, ...toWorkingFiles(merged)];
    });
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  const toExportEntries = useCallback(
    (): FileEntry[] => files.map(f => ({fileName: f.fileName, data: f.data})),
    [files],
  );

  const downloadSng = useCallback(() => {
    try {
      // exportAsSng expects { filename } (not { fileName }) and folds song.ini
      // into the SNG header metadata automatically.
      const sngBytes = exportAsSng(
        toExportEntries().map(f => ({filename: f.fileName, data: f.data})),
      );
      triggerDownload(
        new Blob([sngBytes as Uint8Array<ArrayBuffer>], {
          type: 'application/octet-stream',
        }),
        `${sanitizeName(originalName)}.sng`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to export .sng');
    }
  }, [originalName, toExportEntries]);

  const downloadZip = useCallback(() => {
    try {
      const blob = exportAsZip(
        toExportEntries().map(f => ({filename: f.fileName, data: f.data})),
      );
      triggerDownload(blob, `${sanitizeName(originalName)}.zip`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to export .zip');
    }
  }, [originalName, toExportEntries]);

  if (mode === 'landing') {
    return <SngLanding onCreate={startCreate} onPickSng={startModify} />;
  }

  return (
    <SngEditor
      files={files}
      originalName={originalName}
      onAdd={addEntries}
      onDelete={removeFile}
      onDownloadSng={downloadSng}
      onDownloadZip={downloadZip}
      onBack={() => setMode('landing')}
    />
  );
}
