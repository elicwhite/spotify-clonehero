'use client';

import {createContext, useCallback, useContext, useState} from 'react';
import {toast} from 'sonner';
import {
  readSngFile,
  type FileEntry,
} from '@/components/chart-picker/chart-file-readers';
import {exportAsSng, exportAsZip} from '@/lib/chart-export';
import {downloadBlob} from '@/lib/download';
import {mergeByName} from '@/lib/sng/file-utils';
import {parseChartPreview} from '@/lib/sng/parse-chart-preview';

export type DownloadFormat = 'sng' | 'zip';

interface SngContextValue {
  files: FileEntry[];
  /** Add files, replacing any existing file of the same name. */
  addEntries: (entries: FileEntry[]) => void;
  removeFile: (fileName: string) => void;
  download: (format: DownloadFormat) => void;
  /** Start a new, empty package. */
  reset: () => void;
  /** Load an existing .sng. Returns whether it was read successfully. */
  loadSng: (file: File) => Promise<boolean>;
}

const SngContext = createContext<SngContextValue | null>(null);

export function useSng(): SngContextValue {
  const ctx = useContext(SngContext);
  if (!ctx) throw new Error('useSng must be used within an SngProvider');
  return ctx;
}

/** Strip characters illegal in file names while keeping spaces, parens, etc. */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim();
  return cleaned.length > 0 ? cleaned : 'song';
}

export function SngProvider({children}: {children: React.ReactNode}) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  // Name of the opened .sng (Modify flow). Null when creating from scratch, in
  // which case the download name is derived from the chart metadata.
  const [openedSngName, setOpenedSngName] = useState<string | null>(null);

  const reset = useCallback(() => {
    setFiles([]);
    setOpenedSngName(null);
  }, []);

  const loadSng = useCallback(async (file: File): Promise<boolean> => {
    try {
      const loaded = await readSngFile(file);
      setFiles(loaded.files);
      setOpenedSngName(loaded.originalName || 'song');
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to read .sng file');
      return false;
    }
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

  return (
    <SngContext.Provider
      value={{files, addEntries, removeFile, download, reset, loadSng}}>
      {children}
    </SngContext.Provider>
  );
}
