'use client';

import {useEffect, useState, useCallback, useRef} from 'react';
import {Download} from 'lucide-react';
import {Player} from '@remotion/player';
import {toast} from 'sonner';
import type {LyricLine} from '@/lib/karaoke/parse-lyrics';
import {KaraokeVideo} from '@/app/karaoke/KaraokeVideo';
import type {TreatmentId} from '@/app/karaoke/treatments/types';
import {Button} from '@/components/ui/button';
import {getExtension, getBasename} from '@/lib/src-shared/utils';
import {removeStyleTags} from '@/lib/ui-utils';
import {findAudioFiles, type Files} from '@/lib/preview/chorus-chart-processing';
import {readChart, writeChart, type ChartDocument} from '@/lib/chart-edit';
import {exportAsZip, exportAsSng} from '@/lib/chart-export';
import {alignedSyllablesToChartLyrics} from '@/lib/lyrics-align/chart-lyrics';
import type {AlignedSyllable} from '@/lib/lyrics-align/aligner';
import type {
  LoadedFiles,
  SourceFormat,
} from '@/lib/lyrics-align/chart-file-readers';
import ChartDropZone from './ChartDropZone';

const FPS = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoadedChart {
  name: string;
  artist: string;
  charter: string;
  audioFiles: Files;
  audioUrls: string[];
  vocalsFile: {data: Uint8Array; mimeType: string} | null;
  songLength: number;
  chartDoc: ChartDocument;
  /** All raw files from the input — needed for re-export. */
  rawFiles: LoadedFiles['files'];
  sourceFormat: SourceFormat;
  originalName: string;
  sngMetadata?: Record<string, string>;
}

interface PipelineStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
  detail: string;
  startTime?: number;
  endTime?: number;
}

const ALIGN_STEPS: PipelineStep[] = [
  {id: 'decode', label: 'Decoding audio', status: 'pending', detail: ''},
  {
    id: 'separate',
    label: 'Separating vocal stem',
    status: 'pending',
    detail: '',
  },
  {id: 'syllabify', label: 'Splitting lyrics into syllables', status: 'pending', detail: ''},
  {
    id: 'align',
    label: 'Aligning syllables to audio',
    status: 'pending',
    detail: '',
  },
];

type Status =
  | 'idle'
  | 'loading-chart'
  | 'input'
  | 'processing'
  | 'done'
  | 'error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMimeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'mp3':
      return 'audio/mpeg';
    case 'opus':
      return 'audio/opus';
    case 'wav':
      return 'audio/wav';
    default:
      return 'audio/ogg';
  }
}

function filesToBlobUrls(files: Files): string[] {
  return files.map(f => {
    const ext = getExtension(f.fileName).toLowerCase();
    const blob = new Blob([f.data], {type: getMimeForExtension(ext)});
    return URL.createObjectURL(blob);
  });
}

function loadChartFromFiles(loaded: LoadedFiles): LoadedChart {
  const {files, sourceFormat, originalName, sngMetadata} = loaded;

  // chart-edit's readChart expects { fileName, data }
  // Our chart-file-readers already produce that shape
  const chartDoc = readChart(files);

  // Find audio files using shared helper
  const audioFiles = findAudioFiles(files);
  if (audioFiles.length === 0) {
    throw new Error('No audio files found');
  }

  // Check for pre-existing vocals stem
  const vocalsFile = audioFiles.find(
    f => getBasename(f.fileName).toLowerCase() === 'vocals',
  );

  const name = chartDoc.metadata.name ?? 'Unknown';
  const artist = chartDoc.metadata.artist ?? 'Unknown';
  const charter = chartDoc.metadata.charter ?? 'Unknown';

  // Estimate song length from last tempo marker
  const lastTempo = chartDoc.tempos[chartDoc.tempos.length - 1];
  const songLength = lastTempo ? (lastTempo as any).msTime + 60000 : 180000;

  return {
    name,
    artist,
    charter,
    audioFiles,
    audioUrls: filesToBlobUrls(audioFiles),
    vocalsFile: vocalsFile
      ? {
          data: vocalsFile.data,
          mimeType: getMimeForExtension(getExtension(vocalsFile.fileName)),
        }
      : null,
    songLength,
    chartDoc,
    rawFiles: files,
    sourceFormat,
    originalName,
    sngMetadata,
  };
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function LyricsAlignPage() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [chart, setChart] = useState<LoadedChart | null>(null);
  const [lyrics, setLyrics] = useState('');
  const treatment: TreatmentId = 'scroll';
  const [alignedLines, setAlignedLines] = useState<LyricLine[]>([]);
  const [alignedSyllables, setAlignedSyllables] = useState<AlignedSyllable[]>(
    [],
  );
  const [alignSteps, setAlignSteps] = useState<PipelineStep[]>(ALIGN_STEPS);
  const [showLyricsWarning, setShowLyricsWarning] = useState(false);
  const initStartedRef = useRef(false);

  const updateAlignStep = useCallback(
    (id: string, update: Partial<PipelineStep>) => {
      setAlignSteps(prev =>
        prev.map(s => (s.id === id ? {...s, ...update} : s)),
      );
    },
    [],
  );

  // Preload alignment model in worker once chart is loaded
  useEffect(() => {
    if (status !== 'input' || initStartedRef.current) return;
    initStartedRef.current = true;

    (async () => {
      try {
        const {init} = await import('@/lib/lyrics-align/aligner');
        await init(msg => console.log('[aligner init]', msg));
      } catch (e: any) {
        console.warn('Failed to preload alignment model:', e.message);
      }
    })();
  }, [status]);

  // Clean up blob URLs on unmount
  useEffect(() => {
    return () => {
      chart?.audioUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [chart]);

  const handleChartLoaded = useCallback((loaded: LoadedFiles) => {
    setStatus('loading-chart');
    setError(null);

    try {
      const result = loadChartFromFiles(loaded);
      setChart(result);

      // Check for existing lyrics and warn
      if (result.chartDoc.hasLyrics && result.chartDoc.lyrics.length > 0) {
        setShowLyricsWarning(true);
      }

      setStatus('input');
    } catch (e: any) {
      setError(e.message ?? 'Failed to load chart');
      setStatus('error');
    }
  }, []);

  const handleAlign = useCallback(async () => {
    if (!chart || !lyrics.trim()) return;

    setError(null);
    setAlignedLines([]);
    setAlignedSyllables([]);
    setShowLyricsWarning(false);
    setAlignSteps(
      ALIGN_STEPS.map(s => ({
        ...s,
        status: 'pending',
        detail: '',
        startTime: undefined,
        endTime: undefined,
      })),
    );
    setStatus('processing');

    try {
      let vocals16k: Float32Array;

      if (chart.vocalsFile) {
        updateAlignStep('decode', {
          status: 'done',
          detail: 'Vocals stem found in chart',
          endTime: Date.now(),
        });
        updateAlignStep('separate', {
          status: 'active',
          detail: 'Using existing vocals stem (skipping Demucs)',
          startTime: Date.now(),
        });

        const {resampleTo16kMono} = await import(
          '@/lib/lyrics-align/demucs-client'
        );
        vocals16k = await resampleTo16kMono(
          chart.vocalsFile.data,
          chart.vocalsFile.mimeType,
        );

        updateAlignStep('separate', {
          status: 'done',
          detail: `${(vocals16k.length / 16000).toFixed(1)}s mono 16kHz (from vocals stem)`,
          endTime: Date.now(),
        });
      } else {
        updateAlignStep('decode', {
          status: 'active',
          detail: 'Decoding audio file...',
          startTime: Date.now(),
        });

        const songFile =
          chart.audioFiles.find(
            f => getBasename(f.fileName).toLowerCase() === 'song',
          ) ?? chart.audioFiles[0];

        const ext = getExtension(songFile.fileName).toLowerCase();
        const mime = getMimeForExtension(ext);
        const blob = new Blob([songFile.data], {type: mime});
        const arrayBuffer = await blob.arrayBuffer();

        const audioCtx = new AudioContext({sampleRate: 44100});
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        await audioCtx.close();

        updateAlignStep('decode', {
          status: 'done',
          detail: `${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.numberOfChannels}ch, ${audioBuffer.sampleRate}Hz`,
          endTime: Date.now(),
        });

        updateAlignStep('separate', {
          status: 'active',
          detail: 'Starting Demucs worker...',
          startTime: Date.now(),
        });

        const {runDemucsInWorker} = await import(
          '@/lib/lyrics-align/demucs-client'
        );
        vocals16k = await runDemucsInWorker(audioBuffer, msg =>
          updateAlignStep('separate', {detail: msg}),
        );

        updateAlignStep('separate', {
          status: 'done',
          detail: `${(vocals16k.length / 16000).toFixed(1)}s mono 16kHz — worker terminated`,
          endTime: Date.now(),
        });
      }

      updateAlignStep('align', {
        status: 'active',
        startTime: Date.now(),
      });

      const {alignVocals} = await import('@/lib/lyrics-align/aligner');

      const result = await alignVocals(vocals16k, lyrics, msg => {
        if (msg.startsWith('Syllabified:')) {
          updateAlignStep('syllabify', {
            status: 'done',
            detail: '',
            startTime: Date.now(),
            endTime: Date.now(),
          });
        } else if (msg.startsWith('Done:')) {
          updateAlignStep('align', {status: 'done', endTime: Date.now()});
        }
      });

      setAlignSteps(prev =>
        prev.map(s => ({
          ...s,
          status:
            s.status === 'pending' || s.status === 'active'
              ? 'done'
              : s.status,
          endTime: s.endTime ?? Date.now(),
        })),
      );

      setAlignedLines(result.lines);
      setAlignedSyllables(result.syllables);
      setStatus('done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus('error');
      setAlignSteps(prev =>
        prev.map(s =>
          s.status === 'active' ? {...s, status: 'error', detail: msg} : s,
        ),
      );
    }
  }, [chart, lyrics, updateAlignStep]);

  const handleDownload = useCallback(() => {
    if (!chart || alignedSyllables.length === 0) return;

    try {
      // Convert aligned syllables to chart lyrics format
      const {lyrics: chartLyrics, vocalPhrases} =
        alignedSyllablesToChartLyrics(
          alignedSyllables,
          chart.chartDoc.tempos,
          chart.chartDoc.chartTicksPerBeat,
        );

      // Update the chart document with lyrics
      const doc = {...chart.chartDoc};
      doc.lyrics = chartLyrics;
      doc.vocalPhrases = vocalPhrases;
      doc.hasLyrics = true;

      // Write chart back to files
      const chartFiles = writeChart(doc);

      // Build export file list: chart files + original audio files
      const exportFiles: {filename: string; data: Uint8Array}[] = [];
      for (const f of chartFiles) {
        exportFiles.push({filename: f.fileName, data: f.data});
      }
      // Add audio files from the original input that writeChart doesn't include
      // (writeChart returns chart + ini + assets; assets already include audio passed through)
      // Check if audio files are already in the output via assets
      const outputNames = new Set(exportFiles.map(f => f.filename.toLowerCase()));
      for (const f of chart.rawFiles) {
        if (!outputNames.has(f.fileName.toLowerCase())) {
          exportFiles.push({filename: f.fileName, data: f.data});
        }
      }

      // Package in original format, using the original filename
      const ext = chart.sourceFormat === 'sng' ? '.sng' : '.zip';

      let blob: Blob;
      if (chart.sourceFormat === 'sng') {
        const sngBytes = exportAsSng(exportFiles);
        blob = new Blob([sngBytes], {type: 'application/octet-stream'});
      } else {
        blob = exportAsZip(exportFiles);
      }

      const filename = chart.originalName + ext;

      // Trigger browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      toast.success('Chart exported with lyrics');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    }
  }, [chart, alignedSyllables]);

  const showKaraoke = status === 'done' && alignedLines.length > 0;
  const songLength =
    showKaraoke && alignedLines.length > 0
      ? alignedLines[alignedLines.length - 1].endMs + 5000
      : chart?.songLength ?? 180000;
  const durationInFrames = Math.ceil((songLength / 1000) * FPS);

  return (
    <main className="min-h-screen bg-background w-full">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">
            Add Lyrics To A Chart
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Add timed, syllable-level lyrics to any Clone Hero chart.
            Everything runs in your browser.
          </p>
        </header>

        {/* Step 1: Landing — flow diagram + drop zone */}
        {(status === 'idle' || (status === 'error' && !chart)) && (
          <div className="space-y-8">
            {/* Flow diagram */}
            <div className="bg-muted rounded-xl p-6">
              <div className="flex items-center justify-between">
                <FlowStep icon="📁" label="Open" desc="Your chart" />
                <FlowArrow />
                <FlowStep icon="✏️" label="Paste" desc="Song lyrics" />
                <FlowArrow />
                <FlowStep icon="🎵" label="Align" desc="Auto-synced" />
                <FlowArrow />
                <FlowStep icon="📥" label="Download" desc="Updated chart" />
              </div>
            </div>

            <ChartDropZone onLoaded={handleChartLoaded} />
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        )}

        {/* Loading chart */}
        {status === 'loading-chart' && (
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground" />
            <p className="text-muted-foreground">Reading chart files...</p>
          </div>
        )}

        {/* Step 2: Chart loaded — show info + lyrics input */}
        {chart && (status === 'input' || (status === 'error' && chart)) && (
          <div className="space-y-6">
            {/* Chart info */}
            <div className="bg-muted rounded-lg p-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">
                  {removeStyleTags(chart.name)}{' '}
                  <span className="text-muted-foreground font-normal">
                    by
                  </span>{' '}
                  {removeStyleTags(chart.artist)}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Charted by {removeStyleTags(chart.charter)} &middot;{' '}
                  {chart.audioFiles.length} audio file
                  {chart.audioFiles.length !== 1 ? 's' : ''}
                  {chart.vocalsFile && ' (vocals stem available)'}
                  {' '}&middot; {chart.sourceFormat === 'sng' ? '.sng' : chart.sourceFormat === 'zip' ? '.zip' : 'folder'}
                </p>
              </div>
              <ChartDropZone onLoaded={handleChartLoaded} />
            </div>

            {/* Existing lyrics warning */}
            {showLyricsWarning && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <p className="text-sm text-yellow-200">
                  This chart already has lyrics. Aligning will replace them.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => setShowLyricsWarning(false)}>
                  OK, continue
                </Button>
              </div>
            )}

            {/* Lyrics textarea */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Paste Lyrics
              </label>
              <textarea
                value={lyrics}
                onChange={e => setLyrics(e.target.value)}
                rows={12}
                placeholder="Paste the song lyrics here..."
                className="w-full bg-muted border border-border rounded-lg px-4 py-3 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary resize-y"
              />
            </div>

            <Button
              onClick={handleAlign}
              disabled={!lyrics.trim() || showLyricsWarning}
              size="lg">
              Align Lyrics
            </Button>

            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        )}

        {/* Processing */}
        {status === 'processing' && (
          <ProgressCard steps={alignSteps} error={error} />
        )}

        {/* Step 3: Results — karaoke viewer + download */}
        {showKaraoke && chart && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm text-muted-foreground">
                {alignedLines.reduce((n, l) => n + l.syllables.length, 0)}{' '}
                syllables aligned into {alignedLines.length} lines
              </span>
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAlignedLines([]);
                  setAlignedSyllables([]);
                  setStatus('input');
                }}>
                Re-align
              </Button>
              <Button size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-1" />
                Download updated .{chart.sourceFormat === 'sng' ? 'sng' : 'zip'}
              </Button>
            </div>

            <h3 className="text-sm font-medium text-muted-foreground">
              Preview
            </h3>

            <Player
              component={KaraokeVideo}
              inputProps={{
                lines: alignedLines,
                audioUrls: chart.audioUrls,
                albumArtUrl: null,
                treatment,
              }}
              durationInFrames={durationInFrames}
              compositionWidth={1920}
              compositionHeight={1080}
              fps={FPS}
              controls
              numberOfSharedAudioTags={8}
              acknowledgeRemotionLicense
              errorFallback={({error}) => (
                <div className="flex items-center justify-center h-full bg-black text-red-400 p-8 text-center">
                  <p>{error.message}</p>
                </div>
              )}
              style={{width: '100%', maxWidth: 1280, aspectRatio: '16/9'}}
            />
          </div>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Progress Card
// ---------------------------------------------------------------------------

function FlowStep({icon, label, desc}: {icon: string; label: string; desc: string}) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      <span className="text-3xl">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{desc}</span>
    </div>
  );
}

function FlowArrow() {
  return (
    <svg
      className="w-10 h-6 text-muted-foreground/30 flex-shrink-0"
      fill="currentColor"
      viewBox="0 0 40 24">
      <path d="M0 9h28l-6-6 3-3 12 12-12 12-3-3 6-6H0z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Progress Card
// ---------------------------------------------------------------------------

function ProgressCard({
  steps,
  error,
}: {
  steps: PipelineStep[];
  error: string | null;
}) {
  return (
    <div className="bg-muted rounded-xl p-6 mb-8">
      <h2 className="text-lg font-semibold mb-4">Adding lyrics to your chart</h2>
      <div className="space-y-3">
        {steps.map(step => (
          <div key={step.id} className="flex items-start gap-3">
            <div className="mt-0.5 flex-shrink-0 w-5 h-5">
              {step.status === 'done' && (
                <svg
                  className="w-5 h-5 text-green-500"
                  fill="currentColor"
                  viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              {step.status === 'active' && (
                <svg
                  className="w-5 h-5 text-yellow-500 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              )}
              {step.status === 'pending' && (
                <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30" />
              )}
              {step.status === 'error' && (
                <svg
                  className="w-5 h-5 text-destructive"
                  fill="currentColor"
                  viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={
                    step.status === 'done'
                      ? 'text-muted-foreground'
                      : step.status === 'active'
                        ? 'text-foreground font-medium'
                        : step.status === 'error'
                          ? 'text-destructive'
                          : 'text-muted-foreground/50'
                  }>
                  {step.label}
                </span>
                {step.status === 'done' && step.startTime && step.endTime && (
                  <span className="text-muted-foreground/50 text-xs">
                    {((step.endTime - step.startTime) / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              {step.detail && (
                <p
                  className={`text-sm truncate ${
                    step.status === 'error'
                      ? 'text-destructive'
                      : 'text-muted-foreground/70'
                  }`}>
                  {step.detail}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-4 text-destructive text-sm">{error}</p>}
    </div>
  );
}
