'use client';

import {useCallback, useState} from 'react';
import {toast} from 'sonner';
import {
  readSngFile,
  type FileEntry,
} from '@/components/chart-picker/chart-file-readers';
import {exportAsSng, exportAsZip} from '@/lib/chart-export';
import {downloadBlob} from '@/lib/download';
import {dedupeByName} from '@/lib/sng/file-utils';
import SngLanding from './components/SngLanding';
import SngEditor, {type DownloadFormat} from './components/SngEditor';
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

  const download = useCallback(
    (format: DownloadFormat) => {
      // chart-export expects { filename }; song.ini is folded into the SNG
      // header (and kept as a file in the zip) by the exporters themselves.
      const entries = files.map(f => ({filename: f.fileName, data: f.data}));
      const name = sanitizeName(originalName);
      try {
        const blob =
          format === 'sng'
            ? new Blob([exportAsSng(entries) as Uint8Array<ArrayBuffer>], {
                type: 'application/octet-stream',
              })
            : exportAsZip(entries);
        downloadBlob(blob, `${name}.${format}`);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : `Failed to export .${format}`,
        );
      }
    },
    [files, originalName],
  );

  if (mode === 'landing') {
    return <SngLanding onCreate={startCreate} onPickSng={startModify} />;
  }

  return (
    <SngEditor
      files={files}
      originalName={originalName}
      onAdd={addEntries}
      onDelete={removeFile}
      onDownload={download}
      onBack={() => setMode('landing')}
    />
  );
}
