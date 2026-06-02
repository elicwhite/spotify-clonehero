'use client';

import {ArrowLeft, Download, FileArchive} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {FileEntry} from '@/components/chart-picker/chart-file-readers';
import ChartInfoCard from './ChartInfoCard';
import DropZone from './DropZone';
import PackageFileTable, {type WorkingFile} from './PackageFileTable';

export type DownloadFormat = 'sng' | 'zip';

interface SngEditorProps {
  files: WorkingFile[];
  originalName: string;
  onAdd: (entries: FileEntry[]) => void;
  onDelete: (id: string) => void;
  onDownload: (format: DownloadFormat) => void;
  onBack: () => void;
}

export default function SngEditor({
  files,
  originalName,
  onAdd,
  onDelete,
  onDownload,
  onBack,
}: SngEditorProps) {
  const empty = files.length === 0;

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <h1 className="truncate text-lg font-semibold">{originalName}</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onDownload('sng')} disabled={empty}>
            <Download className="mr-2 h-4 w-4" />
            Download .sng
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDownload('zip')}
            disabled={empty}>
            <FileArchive className="mr-2 h-4 w-4" />
            Download .zip
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* Left: parsed chart preview */}
        <div>
          <ChartInfoCard files={files} />
        </div>

        {/* Right: drop target + file list */}
        <div className="space-y-3">
          <DropZone onAdd={onAdd} />
          <PackageFileTable files={files} onDelete={onDelete} />
        </div>
      </div>
    </main>
  );
}
