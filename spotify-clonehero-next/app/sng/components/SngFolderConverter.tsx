'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, CheckCircle2, FolderCog} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import scanLocalCharts, {
  type SongAccumulator,
} from '@/lib/local-songs-folder/scanLocalCharts';
import {coalesceProgress} from '@/lib/local-songs-folder/scan-progress';
import {
  convertChartFolders,
  selectChartFoldersToConvert,
} from '@/lib/sng/convert-folder-to-sng';
import {calculateTimeRemaining, formatTimeRemaining} from '@/lib/ui-utils';

interface SngFolderConverterProps {
  dirHandle: FileSystemDirectoryHandle;
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

export default function SngFolderConverter({
  dirHandle,
  onBack,
}: SngFolderConverterProps) {
  const [phase, setPhase] = useState<Phase>({status: 'scanning', found: 0});
  // Guards against the effect running twice in React 18 strict mode.
  const startedRef = useRef(false);

  const run = useCallback(async () => {
    const accumulator: SongAccumulator[] = [];
    try {
      setPhase({status: 'scanning', found: 0});
      const progress = coalesceProgress(found =>
        setPhase({status: 'scanning', found}),
      );
      await scanLocalCharts(dirHandle, accumulator, progress.bump);
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
      const {written, failed} = await convertChartFolders(toConvert, {
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
      });

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
  }, [dirHandle]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    run();
  }, [run]);

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-8">
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
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
          <ConverterStatus phase={phase} dirName={dirHandle.name} />
          {(phase.status === 'done' || phase.status === 'error') && (
            <div className="mt-6 flex justify-end">
              <Button onClick={onBack}>Done</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function ConverterStatus({phase, dirName}: {phase: Phase; dirName: string}) {
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
          title="Writing .sng files…"
          primary={`${phase.written} / ${phase.total} .sngs written`}
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
