'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  FolderCog,
} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import scanLocalCharts, {
  type SongAccumulator,
} from '@/lib/local-songs-folder/scanLocalCharts';
import {coalesceProgress} from '@/lib/local-songs-folder/scan-progress';
import type {FolderSource} from '@/lib/file-access/folderSource';
import DownloadFallbackNotice from '@/components/file-access/DownloadFallbackNotice';
import {downloadBlob} from '@/lib/download';
import {
  convertChartFolders,
  saveIntoFolder,
  saveIntoZip,
  selectChartFoldersToConvert,
  type SaveSng,
} from '@/lib/sng/convert-folder-to-sng';
import {PartedZip} from '@/lib/sng/partedZip';
import {formatBytes} from '@/lib/sng/file-utils';
import {calculateTimeRemaining, formatTimeRemaining} from '@/lib/ui-utils';

interface SngFolderConverterProps {
  folder: FolderSource;
  onBack: () => void;
}

type Phase =
  | {status: 'scanning'; found: number}
  | {status: 'converting'; written: number; total: number; etaMs: number}
  | {status: 'done'; written: number; failed: number; skipped: number}
  | {status: 'error'; message: string};

// Used as the per-chart time estimate before any chart has been written, so the
// first ETA isn't NaN/Infinity.
const DEFAULT_MS_PER_CHART = 750;

/** What the progress block says the converter is doing with each .sng. */
interface SavingWords {
  title: string;
  verb: string;
}
const WRITING: SavingWords = {title: 'Writing .sng files…', verb: 'written'};
const PACKING: SavingWords = {title: 'Packing .sng files…', verb: 'packed'};

/** A finished .zip part. Its Blob is let go once it is downloaded. */
interface ZipPart {
  blob: Blob | null;
  size: number;
}

export default function SngFolderConverter({
  folder,
  onBack,
}: SngFolderConverterProps) {
  const [phase, setPhase] = useState<Phase>({status: 'scanning', found: 0});
  // A folder from a file input has no handle to write beside each chart, so
  // the .sng files are collected into .zip parts for the user to download.
  const zipping = folder.handle == null;
  const [parts, setParts] = useState<ZipPart[]>([]);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const undownloaded = parts.filter(part => part.blob != null).length;
  // Guards against the effect running twice in React 18 strict mode.
  const startedRef = useRef(false);

  const run = useCallback(async () => {
    const accumulator: SongAccumulator[] = [];
    try {
      setPhase({status: 'scanning', found: 0});
      const progress = coalesceProgress(found =>
        setPhase({status: 'scanning', found}),
      );
      await scanLocalCharts(folder, accumulator, progress.bump);
      progress.flush();

      const toConvert = selectChartFoldersToConvert(accumulator);
      const total = toConvert.length;
      const skipped = accumulator.length - total;

      if (total === 0) {
        setPhase({status: 'done', written: 0, failed: 0, skipped});
        return;
      }

      setPhase({
        status: 'converting',
        written: 0,
        total,
        etaMs: total * DEFAULT_MS_PER_CHART,
      });

      const startTime = new Date();
      const target = saveTarget(folder, blob =>
        setParts(current => [...current, {blob, size: blob.size}]),
      );
      const {written, failed} = await convertChartFolders(
        toConvert,
        target.save,
        {
          onProgress: ({written, failed}) => {
            setPhase({
              status: 'converting',
              written,
              total,
              etaMs: calculateTimeRemaining(
                startTime,
                total,
                written + failed,
                DEFAULT_MS_PER_CHART,
              ),
            });
          },
        },
      );

      target.finish();
      setPhase({status: 'done', written, failed, skipped});
      if (failed > 0) {
        toast.error(
          `${failed} chart${failed === 1 ? '' : 's'} failed to convert`,
        );
      }
    } catch (e) {
      setPhase({
        status: 'error',
        message: e instanceof Error ? e.message : 'Failed to convert folder',
      });
    }
  }, [folder]);

  const downloadPart = useCallback(
    (index: number, fileName: string) => {
      const blob = parts[index]?.blob;
      if (!blob) return;
      downloadBlob(blob, fileName);
      setParts(current =>
        current.map((part, i) => (i === index ? {...part, blob: null} : part)),
      );
    },
    [parts],
  );

  // Converted parts live only in this page, so leaving with some not yet
  // downloaded loses them.
  const leave = useCallback(() => {
    if (undownloaded > 0) setConfirmingLeave(true);
    else onBack();
  }, [onBack, undownloaded]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    run();
  }, [run]);

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-8">
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={leave}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderCog className="h-5 w-5" />
            Convert Folder to SNG
          </CardTitle>
        </CardHeader>
        <CardContent>
          {zipping ? (
            <DownloadFallbackNotice
              className="mb-4 text-sm text-muted-foreground"
              folder="the folder you picked"
              action={
                parts.length > 1
                  ? 'Unzip each part into that folder.'
                  : 'Unzip it into that folder.'
              }
              browserIsReason
            />
          ) : null}
          <ConverterStatus
            phase={phase}
            dirName={folder.name}
            saving={zipping ? PACKING : WRITING}
          />
          {parts.length > 0 ? (
            <ZipParts
              parts={parts}
              folderName={folder.name}
              complete={phase.status === 'done'}
              onDownload={downloadPart}
            />
          ) : null}
          {(phase.status === 'done' || phase.status === 'error') && (
            <div className="mt-6 flex justify-end">
              <Button onClick={leave}>Done</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmingLeave} onOpenChange={setConfirmingLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without downloading?</AlertDialogTitle>
            <AlertDialogDescription>
              {undownloaded === 1
                ? 'One .zip is not downloaded yet.'
                : `${undownloaded} .zip parts are not downloaded yet.`}{' '}
              If you leave, the converted files are lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={onBack}>Leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

/**
 * Where converted .sng files go: beside their folders when the picked folder
 * has a handle to write through, into .zip parts for download when it does
 * not.
 */
function saveTarget(
  folder: FolderSource,
  onPart: (part: Blob) => void,
): {save: SaveSng; finish: () => void} {
  if (folder.handle) {
    return {save: saveIntoFolder(folder.handle), finish: () => {}};
  }
  const zip = new PartedZip(onPart);
  return {save: saveIntoZip(zip), finish: () => zip.finish()};
}

/**
 * One download button per finished part. Each download is its own click:
 * browsers block a page that starts several downloads by itself.
 */
function ZipParts({
  parts,
  folderName,
  complete,
  onDownload,
}: {
  parts: ZipPart[];
  folderName: string;
  complete: boolean;
  onDownload: (index: number, fileName: string) => void;
}) {
  const single = complete && parts.length === 1;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {parts.map((part, index) => {
        const name = single ? '.zip' : `part ${index + 1}`;
        const fileName = single
          ? `${folderName} (sng).zip`
          : `${folderName} (sng part ${index + 1}).zip`;
        const downloaded = part.blob == null;
        return (
          <Button
            key={index}
            variant="outline"
            disabled={downloaded}
            onClick={() => onDownload(index, fileName)}>
            {downloaded ? (
              <Check className="mr-2 h-4 w-4" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {downloaded ? `Downloaded ${name}` : `Download ${name}`} (
            {formatBytes(part.size)})
          </Button>
        );
      })}
    </div>
  );
}

function ConverterStatus({
  phase,
  dirName,
  saving,
}: {
  phase: Phase;
  dirName: string;
  saving: SavingWords;
}) {
  if (phase.status === 'scanning') {
    return (
      <StatusBlock
        title={`Scanning ${dirName}…`}
        primary={`${phase.found} chart${phase.found === 1 ? '' : 's'} found`}
      />
    );
  }

  if (phase.status === 'converting') {
    const pct = phase.total > 0 ? (phase.written / phase.total) * 100 : 0;
    return (
      <div className="space-y-3">
        <StatusBlock
          title={saving.title}
          primary={`${phase.written} / ${phase.total} .sngs ${saving.verb}`}
          secondary={formatTimeRemaining(phase.etaMs)}
        />
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width]"
            style={{width: `${pct}%`}}
          />
        </div>
      </div>
    );
  }

  if (phase.status === 'done') {
    const parts = [
      `Converted ${phase.written} chart${phase.written === 1 ? '' : 's'} to .sng`,
    ];
    if (phase.skipped > 0) parts.push(`skipped ${phase.skipped} existing .sng`);
    if (phase.failed > 0) parts.push(`${phase.failed} failed`);
    return (
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-6 w-6 text-green-600" />
        <div>
          <p className="font-medium">Done</p>
          <p className="text-sm text-muted-foreground">{parts.join(', ')}.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="font-medium text-destructive">Conversion failed</p>
      <p className="text-sm text-muted-foreground">{phase.message}</p>
    </div>
  );
}

function StatusBlock({
  title,
  primary,
  secondary,
}: {
  title: string;
  primary: string;
  secondary?: string;
}) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-2xl font-semibold">{primary}</p>
      {secondary && (
        <p className="text-sm text-muted-foreground">{secondary}</p>
      )}
    </div>
  );
}
