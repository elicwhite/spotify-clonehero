'use client';

import {useCallback, useState} from 'react';
import {toast} from 'sonner';
import type {File as FileEntry} from '@eliwhite/scan-chart';
import {readSngFile} from '@/components/chart-picker/chart-file-readers';
import {exportAsSng, exportAsZip} from '@/lib/chart-export';
import {downloadBlob} from '@/lib/download';
import {mergeByName} from '@/lib/sng/file-utils';
import {parseChartPreview} from '@/lib/sng/parse-chart-preview';
import SngLanding from './components/SngLanding';
import SngEditor, {type DownloadFormat} from './components/SngEditor';
import SngFolderConverter from './components/SngFolderConverter';

type Mode = 'landing' | 'editor' | 'convert';

/** Strip characters illegal in file names while keeping spaces, parens, etc. */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim();
  return cleaned.length > 0 ? cleaned : 'song';
}

export default function SngClient() {
  const [mode, setMode] = useState<Mode>('landing');
  const [files, setFiles] = useState<FileEntry[]>([]);
  // Name of the opened .sng (Modify flow). Null when building from scratch, in
  // which case the download name is derived from the chart metadata.
  const [openedSngName, setOpenedSngName] = useState<string | null>(null);
  // Directory being batch-converted to .sng (Convert Folder flow).
  const [convertDir, setConvertDir] =
    useState<FileSystemDirectoryHandle | null>(null);

  const startConvert = useCallback(async () => {
    let dirHandle: FileSystemDirectoryHandle;
    try {
      // readwrite so the .sng files can be written back next to each chart.
      dirHandle = await window.showDirectoryPicker({
        id: 'sng-convert-folder',
        mode: 'readwrite',
      });
    } catch (err) {
      // showDirectoryPicker rejects with AbortError when the user cancels.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      toast.error(err instanceof Error ? err.message : 'Failed to open folder');
      return;
    }
    setConvertDir(dirHandle);
    setMode('convert');
  }, []);

  const startCreate = useCallback(() => {
    setFiles([]);
    setOpenedSngName(null);
    setMode('editor');
  }, []);

  const startModify = useCallback(async (file: File) => {
    try {
      const loaded = await readSngFile(file);
      setFiles(loaded.files);
      setOpenedSngName(loaded.originalName || 'song');
      setMode('editor');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to read .sng file');
    }
  }, []);

  const goBack = useCallback(() => {
    setMode('landing');
    setFiles([]);
    setOpenedSngName(null);
    setConvertDir(null);
  }, []);

  const addEntries = useCallback((entries: FileEntry[]) => {
    setFiles(prev => {
      // Files with a name that already exists replace the existing file.
      const existingNames = new Set(prev.map(f => f.fileName.toLowerCase()));
      const replaced = entries.filter(e =>
        existingNames.has(e.fileName.toLowerCase()),
      ).length;
      const added = entries.length - replaced;
      const parts: string[] = [];
      if (added > 0) parts.push(`Added ${added} file${added === 1 ? '' : 's'}`);
      if (replaced > 0) {
        parts.push(`replaced ${replaced} file${replaced === 1 ? '' : 's'}`);
      }
      if (parts.length > 0) toast.success(parts.join(', '));
      return mergeByName(prev, entries);
    });
  }, []);

  const removeFile = useCallback((fileName: string) => {
    setFiles(prev => prev.filter(f => f.fileName !== fileName));
  }, []);

  const download = useCallback(
    (format: DownloadFormat) => {
      // Modify flow keeps the opened file's name; Create flow names the package
      // after the chart's "artist - song (charter)".
      let baseName = openedSngName ?? '';
      if (!baseName) {
        const preview = parseChartPreview(files);
        baseName = preview
          ? `${preview.artist} - ${preview.name} (${preview.charter})`
          : 'song';
      }

      try {
        // song.ini is folded into the SNG header (and kept as a file in the
        // zip) by the exporters themselves.
        const blob =
          format === 'sng'
            ? new Blob([exportAsSng(files) as Uint8Array<ArrayBuffer>], {
                type: 'application/octet-stream',
              })
            : exportAsZip(files);
        downloadBlob(blob, `${sanitizeFileName(baseName)}.${format}`);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : `Failed to export .${format}`,
        );
      }
    },
    [files, openedSngName],
  );

  if (mode === 'landing') {
    return (
      <SngLanding
        onCreate={startCreate}
        onPickSng={startModify}
        onConvertFolder={startConvert}
      />
    );
  }

  if (mode === 'convert' && convertDir) {
    return <SngFolderConverter dirHandle={convertDir} onBack={goBack} />;
  }

  return (
    <SngEditor
      files={files}
      onAdd={addEntries}
      onDelete={removeFile}
      onDownload={download}
      onBack={goBack}
    />
  );
}
