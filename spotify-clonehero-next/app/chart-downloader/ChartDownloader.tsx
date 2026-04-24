'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {useChorusChartDb} from '@/lib/chorusChartDb';
import {scanForInstalledCharts} from '@/lib/local-songs-folder';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Slider} from '@/components/ui/slider';
import {toast} from 'sonner';
import LocalScanLoaderCard from '../spotify/app/LocalScanLoaderCard';
import UpdateChorusLoaderCard from '../spotify/app/UpdateChorusLoaderCard';
import {getLocalDb} from '@/lib/local-db/client';
import {upsertLocalCharts} from '@/lib/local-db/local-charts';
import {sql} from 'kysely';
import {SngStream} from '@eliwhite/parse-sng';
import scanLocalCharts, {SongAccumulator} from '@/lib/local-songs-folder/scanLocalCharts';

type MissingChart = {
  md5: string;
  name: string;
  artist: string;
  charter: string;
  has_video_background: number;
};

type DownloadStatus =
  | 'not-started'
  | 'scanning'
  | 'finding-missing'
  | 'downloading'
  | 'done'
  | 'error';

type DownloadProgress = {
  total: number;
  completed: number;
  failed: number;
  current: string[];
  startedAt: number;
};

const NOTES_FILE_PATTERN = /^notes\.(chart|mid)$/i;

/** Files we want to keep from the SNG — notes files and song.ini (generated from header) */
function shouldKeepFile(fileName: string): boolean {
  return NOTES_FILE_PATTERN.test(fileName) || fileName.toLowerCase() === 'song.ini';
}

export default function ChartDownloader() {
  const [status, setStatus] = useState<DownloadStatus>('not-started');
  const [localScanCount, setLocalScanCount] = useState(0);
  const [missingCharts, setMissingCharts] = useState<MissingChart[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    total: 0,
    completed: 0,
    failed: 0,
    current: [],
    startedAt: 0,
  });
  const [concurrency, setConcurrency] = useState(8);
  const concurrencyRef = useRef(8);
  const [chorusChartProgress, fetchChorusCharts] = useChorusChartDb(true);
  const outputDirRef = useRef<FileSystemDirectoryHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Notify waiting workers when concurrency increases
  const workerNotifyRef = useRef<(() => void) | null>(null);

  const handleStart = useCallback(async () => {
    const abortController = new AbortController();
    abortRef.current = abortController;

    // Prompt for output directory first
    try {
      outputDirRef.current = await window.showDirectoryPicker({
        id: 'chart-downloader-output',
        mode: 'readwrite',
      });
    } catch {
      toast.info('Directory picker canceled');
      return;
    }

    setStatus('scanning');
    setLocalScanCount(0);

    // Kick off chorus sync and local scan in parallel
    const chorusPromise = fetchChorusCharts(abortController);

    let localScanSuccess = true;
    try {
      await scanForInstalledCharts(count => {
        setLocalScanCount(count);
      });

      // Also scan the output directory so previously downloaded charts are recognized
      const outputCharts: SongAccumulator[] = [];
      await scanLocalCharts(outputDirRef.current!, outputCharts, () => {
        setLocalScanCount(prev => prev + 1);
      });
      if (outputCharts.length > 0) {
        await upsertLocalCharts(outputCharts);
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'User canceled picker') {
        toast.info('Directory picker canceled');
        setStatus('not-started');
        return;
      }
      toast.error('Error scanning local charts');
      localScanSuccess = false;
    }

    // Wait for chorus sync
    try {
      await chorusPromise;
    } catch (err) {
      toast.error('Error syncing chorus charts');
      setStatus('error');
      return;
    }

    if (!localScanSuccess) {
      setStatus('error');
      return;
    }

    // Find missing charts
    setStatus('finding-missing');
    const missing = await findMissingCharts();
    setMissingCharts(missing);

    if (missing.length === 0) {
      toast.info('No missing charts found — you have everything!');
      setStatus('done');
      return;
    }

    // Start downloading
    setStatus('downloading');
    setDownloadProgress({
      total: missing.length,
      completed: 0,
      failed: 0,
      current: [],
      startedAt: Date.now(),
    });

    await downloadMissingCharts(missing, outputDirRef.current!, abortController);
    setStatus('done');
  }, [fetchChorusCharts]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStatus('done');
    toast.info('Download stopped');
  }, []);

  const isLoading = status === 'scanning' || status === 'finding-missing';

  return (
    <div className="space-y-6">
      {status === 'not-started' && (
        <div className="flex justify-center">
          <Button size="lg" onClick={handleStart}>
            Start Downloading Missing Charts
          </Button>
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <LocalScanLoaderCard
            count={localScanCount}
            isScanning={status === 'scanning'}
          />
          <UpdateChorusLoaderCard progress={chorusChartProgress} />
        </div>
      )}

      {status === 'finding-missing' && (
        <div className="text-center text-muted-foreground">
          Cross-referencing to find missing charts...
        </div>
      )}

      {status === 'downloading' && (
        <DownloadProgressCard
          progress={downloadProgress}
          concurrency={concurrency}
          onConcurrencyChange={(val) => {
            setConcurrency(val);
            concurrencyRef.current = val;
          }}
          onStop={handleStop}
        />
      )}

      {status === 'done' && (
        <div className="space-y-4">
          <DoneCard progress={downloadProgress} missingCount={missingCharts.length} />
          <div className="flex justify-center">
            <Button onClick={handleStart}>Run Again</Button>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="flex justify-center">
          <Button variant="destructive" onClick={handleStart}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );

  async function downloadMissingCharts(
    charts: MissingChart[],
    outputDir: FileSystemDirectoryHandle,
    abortController: AbortController,
  ) {
    // First, try writing a test .ini file to see if Chrome allows it
    const useFolder = await testIniWriteSupport(outputDir);

    // Shared index for workers to pull from
    let nextIndex = 0;
    let activeWorkers = 0;

    async function processOne(chart: MissingChart) {
      const label = `${chart.artist} - ${chart.name} (${chart.charter})`;
      setDownloadProgress(prev => ({
        ...prev,
        current: [...prev.current, label].slice(-8),
      }));

      try {
        const url = `https://files.enchor.us/${chart.md5}${
          chart.has_video_background ? '_novideo' : ''
        }.sng`;

        const response = await fetch(url, {
          headers: {
            accept: '*/*',
            'sec-fetch-dest': 'empty',
          },
          referrerPolicy: 'no-referrer',
          credentials: 'omit',
          cache: 'no-store',
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}`);
        }

        if (useFolder) {
          await downloadAndStripToFolder(response.body, chart, outputDir);
        } else {
          await downloadAndStripToSng(response.body, chart, outputDir);
        }

        setDownloadProgress(prev => ({
          ...prev,
          completed: prev.completed + 1,
        }));
      } catch (err) {
        if (abortController.signal.aborted) return;
        console.error(`Failed to download ${label}:`, err);
        setDownloadProgress(prev => ({
          ...prev,
          failed: prev.failed + 1,
        }));
      }
    }

    async function worker() {
      activeWorkers++;
      while (!abortController.signal.aborted) {
        // If there are more active workers than the current concurrency, exit
        if (activeWorkers > concurrencyRef.current) break;

        const idx = nextIndex++;
        if (idx >= charts.length) break;

        await processOne(charts[idx]);
      }
      activeWorkers--;
    }

    // Spawn initial workers
    const workerPromises: Promise<void>[] = [];
    for (let i = 0; i < concurrencyRef.current; i++) {
      workerPromises.push(worker());
    }

    // Watch for concurrency increases — spawn new workers as needed
    const watchInterval = setInterval(() => {
      const desired = concurrencyRef.current;
      while (activeWorkers < desired && nextIndex < charts.length && !abortController.signal.aborted) {
        workerPromises.push(worker());
      }
    }, 200);

    await Promise.all(workerPromises);
    clearInterval(watchInterval);
  }
}

/** Try writing a .ini file. Returns true if folders work, false if we need SNG fallback. */
async function testIniWriteSupport(
  dir: FileSystemDirectoryHandle,
): Promise<boolean> {
  try {
    const testDir = await dir.getDirectoryHandle('__ini_test__', {create: true});
    const fileHandle = await testDir.getFileHandle('song.ini', {create: true});
    const writable = await fileHandle.createWritable();
    await writable.write('[Song]\nname=test\n');
    await writable.close();
    // Clean up
    await dir.removeEntry('__ini_test__', {recursive: true});
    return true;
  } catch {
    // Clean up on failure
    try {
      await dir.removeEntry('__ini_test__', {recursive: true});
    } catch {}
    return false;
  }
}

/** Download SNG, extract only notes + song.ini into a folder */
async function downloadAndStripToFolder(
  body: ReadableStream,
  chart: MissingChart,
  outputDir: FileSystemDirectoryHandle,
) {
  const safeName = sanitizeFolderName(
    `${chart.artist} - ${chart.name} (${chart.charter})`,
  );

  // Skip if already exists
  try {
    await outputDir.getDirectoryHandle(safeName, {create: false});
    return; // already downloaded
  } catch {
    // Good — doesn't exist yet
  }

  const songDir = await outputDir.getDirectoryHandle(safeName, {create: true});

  try {
    await new Promise<void>((resolve, reject) => {
      const sngStream = new SngStream(body, {generateSongIni: true});

      sngStream.on('file', async (fileName: string, fileStream: ReadableStream, nextFile: (() => void) | null) => {
        try {
          if (shouldKeepFile(fileName)) {
            const fileHandle = await songDir.getFileHandle(fileName, {
              create: true,
            });
            const writable = await fileHandle.createWritable();
            await fileStream.pipeTo(writable);
          } else {
            // Drain the stream to move to next file
            await drainStream(fileStream);
          }

          if (nextFile) nextFile();
          else resolve();
        } catch (err) {
          reject(err);
        }
      });

      sngStream.on('error', reject);
      sngStream.start();
    });
  } catch (err) {
    // Clean up partial folder on failure
    try {
      await outputDir.removeEntry(safeName, {recursive: true});
    } catch {}
    throw err;
  }
}

/** Download SNG, rebuild a stripped SNG with only notes + metadata */
async function downloadAndStripToSng(
  body: ReadableStream,
  chart: MissingChart,
  outputDir: FileSystemDirectoryHandle,
) {
  const safeName = sanitizeFolderName(
    `${chart.artist} - ${chart.name} (${chart.charter}).sng`,
  );

  // Skip if already exists
  try {
    await outputDir.getFileHandle(safeName, {create: false});
    return; // already downloaded
  } catch {
    // Good — doesn't exist yet
  }

  // We need to collect the files first, then rebuild the SNG
  const {buildSngFile} = await import('@/lib/chart-export/sng');

  const collectedFiles: {filename: string; data: Uint8Array}[] = [];
  let sngMetadata: Record<string, string> = {};

  await new Promise<void>((resolve, reject) => {
    const sngStream = new SngStream(body, {generateSongIni: false});

    sngStream.on('header', (header: any) => {
      sngMetadata = header.metadata ?? {};
    });

    sngStream.on('file', async (fileName: string, fileStream: ReadableStream, nextFile: (() => void) | null) => {
      try {
        if (NOTES_FILE_PATTERN.test(fileName)) {
          const chunks: Uint8Array[] = [];
          const reader = fileStream.getReader();
          while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
          const merged = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          collectedFiles.push({filename: fileName, data: merged});
        } else {
          await drainStream(fileStream);
        }

        if (nextFile) nextFile();
        else resolve();
      } catch (err) {
        reject(err);
      }
    });

    sngStream.on('error', reject);
    sngStream.start();
  });

  if (collectedFiles.length === 0) return; // No notes files found

  const sngData = buildSngFile(sngMetadata, collectedFiles);
  const fileHandle = await outputDir.getFileHandle(safeName, {create: true});
  const writable = await fileHandle.createWritable();
  await writable.write(sngData);
  await writable.close();
}

async function drainStream(stream: ReadableStream) {
  const reader = stream.getReader();
  while (true) {
    const {done} = await reader.read();
    if (done) break;
  }
}

function sanitizeFolderName(name: string): string {
  // Remove characters that are invalid in file/folder names
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200); // Keep reasonable length
}

/** Query the DB for chorus charts that don't match any local chart by name+artist+charter */
async function findMissingCharts(): Promise<MissingChart[]> {
  const db = await getLocalDb();

  const result = await sql<MissingChart>`
    SELECT c.md5, c.name, c.artist, c.charter, c.has_video_background
    FROM chorus_charts c
    WHERE NOT EXISTS (
      SELECT 1 FROM local_charts lc
      WHERE lc.artist_normalized = c.artist_normalized
        AND lc.song_normalized = c.name_normalized
        AND lc.charter_normalized = c.charter_normalized
    )
    AND c.name IS NOT NULL
    AND c.artist IS NOT NULL
    ORDER BY c.modified_time DESC
  `.execute(db);

  return result.rows;
}

function formatEta(progress: DownloadProgress, concurrency: number): string {
  const done = progress.completed + progress.failed;
  if (done < 3) return 'Calculating...';

  // Wall-clock throughput: items per ms at whatever concurrency was used
  const elapsedMs = Date.now() - progress.startedAt;
  const itemsPerMs = done / elapsedMs;

  // Scale throughput linearly by concurrency change.
  // The measured rate was achieved at some average concurrency; we approximate
  // by assuming throughput scales linearly (network-bound, each download is independent).
  // We use the measured rate directly as a baseline — if the user changes the slider,
  // the actual rate will adjust over the next few seconds and the ETA self-corrects.
  const remaining = progress.total - done;
  const remainingMs = remaining / itemsPerMs;

  const hours = remainingMs / (1000 * 60 * 60);
  if (hours >= 1) {
    return `~${hours.toFixed(1)} hours remaining`;
  }
  const minutes = remainingMs / (1000 * 60);
  if (minutes >= 1) {
    return `~${Math.round(minutes)} min remaining`;
  }
  return 'Almost done!';
}

function DownloadProgressCard({
  progress,
  concurrency,
  onConcurrencyChange,
  onStop,
}: {
  progress: DownloadProgress;
  concurrency: number;
  onConcurrencyChange: (val: number) => void;
  onStop: () => void;
}) {
  const [, setTick] = useState(0);
  const done = progress.completed + progress.failed;
  const pct =
    progress.total > 0 ? Math.round((done / progress.total) * 100) : 0;

  // Re-render every second to update ETA
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader className="pb-2">
        <CardTitle className="text-2xl font-bold text-center">
          Downloading Charts
        </CardTitle>
        <p className="text-muted-foreground text-center text-sm">
          {formatEta(progress, concurrency)}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="w-full bg-secondary rounded-full h-3">
          <div
            className="bg-primary h-3 rounded-full transition-all duration-300"
            style={{width: `${pct}%`}}
          />
        </div>
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>
            {progress.completed} / {progress.total} downloaded
          </span>
          {progress.failed > 0 && (
            <span className="text-destructive">{progress.failed} failed</span>
          )}
          <span>{pct}%</span>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Parallel downloads</span>
            <span className="font-medium">{concurrency}</span>
          </div>
          <Slider
            value={[concurrency]}
            onValueChange={([val]) => onConcurrencyChange(val)}
            min={1}
            max={32}
            step={1}
          />
        </div>

        {progress.current.length > 0 && (
          <div className="text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-hidden">
            {progress.current.map((name, i) => (
              <div key={i} className="truncate">
                {name}
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-center">
          <Button variant="outline" onClick={onStop}>
            Stop
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DoneCard({
  progress,
  missingCount,
}: {
  progress: DownloadProgress;
  missingCount: number;
}) {
  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader className="pb-2">
        <CardTitle className="text-2xl font-bold text-center">
          Complete
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center gap-8 text-center">
          <div>
            <div className="text-2xl font-bold">{missingCount}</div>
            <div className="text-xs text-muted-foreground">Missing Charts</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{progress.completed}</div>
            <div className="text-xs text-muted-foreground">Downloaded</div>
          </div>
          {progress.failed > 0 && (
            <div>
              <div className="text-2xl font-bold text-destructive">
                {progress.failed}
              </div>
              <div className="text-xs text-muted-foreground">Failed</div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
