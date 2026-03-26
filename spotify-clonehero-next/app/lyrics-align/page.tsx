'use client';

import {useEffect, useState, useCallback, useRef} from 'react';
import {Player} from '@remotion/player';
import {parseChartFile} from '@eliwhite/scan-chart';
import type {LyricLine} from '@/lib/karaoke/parse-lyrics';
import {KaraokeVideo} from '@/app/karaoke/KaraokeVideo';
import {TREATMENTS, type TreatmentId} from '@/app/karaoke/treatments/types';
import {Button} from '@/components/ui/button';
import {getExtension, getBasename, hasAudioName, hasChartExtension, hasIniName} from '@/lib/src-shared/utils';
import {findChartData, findAudioFiles, type Files} from '@/lib/preview/chorus-chart-processing';

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
  /** Pre-existing vocals file if available (skip Demucs) */
  vocalsFile: {data: Uint8Array; mimeType: string} | null;
  songLength: number;
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
  {id: 'decode', label: 'Decode audio', status: 'pending', detail: ''},
  {
    id: 'separate',
    label: 'Separate vocals (Demucs)',
    status: 'pending',
    detail: 'Runs in isolated worker',
  },
  {
    id: 'ctc',
    label: 'Run CTC model (wav2vec2)',
    status: 'pending',
    detail: '',
  },
  {
    id: 'viterbi',
    label: 'Viterbi forced alignment',
    status: 'pending',
    detail: '',
  },
  {
    id: 'group',
    label: 'Group into karaoke lines',
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

// ---------------------------------------------------------------------------
// Directory scanner — uses shared helpers from lib/
// ---------------------------------------------------------------------------

async function readChartDirectory(
  dirHandle: FileSystemDirectoryHandle,
): Promise<Files> {
  const files: Files = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind !== 'file') continue;
    if (hasChartExtension(name) || hasAudioName(name) || hasIniName(name)) {
      const file = await (handle as FileSystemFileHandle).getFile();
      files.push({fileName: name, data: new Uint8Array(await file.arrayBuffer())});
    }
  }
  return files;
}

async function loadChartFromDirectory(
  dirHandle: FileSystemDirectoryHandle,
): Promise<LoadedChart> {
  const files = await readChartDirectory(dirHandle);

  // Parse chart file using shared helper
  const {chartData, format} = findChartData(files);
  const parsed = parseChartFile(chartData, format, {
    song_length: 0,
    hopo_frequency: 0,
    eighthnote_hopo: false,
    multiplier_note: 0,
    sustain_cutoff_threshold: -1,
    chord_snap_threshold: 0,
    five_lane_drums: false,
    pro_drums: false,
  });

  // Find audio files using shared helper
  const audioFiles = findAudioFiles(files);
  if (audioFiles.length === 0) {
    throw new Error('No audio files found in this chart directory');
  }

  // Check for pre-existing vocals stem
  const vocalsFile = audioFiles.find(
    f => getBasename(f.fileName).toLowerCase() === 'vocals',
  );

  // Metadata from scan-chart, with directory name as fallback
  const name = parsed.metadata?.name ?? dirHandle.name;
  const artist = parsed.metadata?.artist ?? 'Unknown';
  const charter = parsed.metadata?.charter ?? 'Unknown';

  // Estimate song length from last tempo marker
  const lastTempo = parsed.tempos[parsed.tempos.length - 1];
  const songLength = lastTempo ? lastTempo.msTime + 60000 : 180000;

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
  const [treatment, setTreatment] = useState<TreatmentId>('highlight');
  const [alignedLines, setAlignedLines] = useState<LyricLine[]>([]);
  const [alignSteps, setAlignSteps] = useState<PipelineStep[]>(ALIGN_STEPS);
  const [modelReady, setModelReady] = useState(false);
  const initStartedRef = useRef(false);

  const updateAlignStep = useCallback(
    (id: string, update: Partial<PipelineStep>) => {
      setAlignSteps(prev =>
        prev.map(s => (s.id === id ? {...s, ...update} : s)),
      );
    },
    [],
  );

  // Preload alignment model once chart is loaded
  useEffect(() => {
    if (status !== 'input' || initStartedRef.current) return;
    initStartedRef.current = true;

    (async () => {
      try {
        const {init} = await import('@/lib/lyrics-align/aligner');
        await init(msg => console.log('[aligner init]', msg));
        setModelReady(true);
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

  const handlePickDirectory = useCallback(async () => {
    try {
      const dirHandle = await window.showDirectoryPicker({
        id: 'lyrics-align-chart',
      });

      setStatus('loading-chart');
      setError(null);

      const loaded = await loadChartFromDirectory(dirHandle);
      setChart(loaded);
      setStatus('input');
    } catch (e: any) {
      if (e.name === 'AbortError') {
        // User cancelled the picker
        return;
      }
      setError(e.message ?? 'Failed to load chart directory');
      setStatus('error');
    }
  }, []);

  const handleAlign = useCallback(async () => {
    if (!chart || !lyrics.trim()) return;

    setError(null);
    setAlignedLines([]);
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
        // Vocals stem available — skip Demucs
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
        // No vocals stem — run full Demucs separation
        updateAlignStep('decode', {
          status: 'active',
          detail: 'Decoding audio file...',
          startTime: Date.now(),
        });

        // Prefer "song" audio, then first available
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

      // CTC alignment
      updateAlignStep('ctc', {
        status: 'active',
        detail: 'Loading wav2vec2 model...',
        startTime: Date.now(),
      });

      const {alignVocals, init} = await import('@/lib/lyrics-align/aligner');

      if (!modelReady) {
        await init(msg => updateAlignStep('ctc', {detail: msg}));
      }

      const result = await alignVocals(vocals16k, lyrics, msg => {
        if (msg.startsWith('Running Viterbi')) {
          updateAlignStep('ctc', {status: 'done', endTime: Date.now()});
          updateAlignStep('viterbi', {
            status: 'active',
            detail: msg,
            startTime: Date.now(),
          });
        } else if (msg.startsWith('Done:')) {
          updateAlignStep('viterbi', {status: 'done', endTime: Date.now()});
          updateAlignStep('group', {
            status: 'done',
            detail: msg,
            endTime: Date.now(),
          });
        } else if (
          msg.startsWith('Emissions:') ||
          msg.startsWith('Tokens:')
        ) {
          updateAlignStep('ctc', {detail: msg});
        } else if (msg.startsWith('Viterbi:')) {
          updateAlignStep('viterbi', {detail: msg});
        } else {
          updateAlignStep('ctc', {detail: msg});
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
  }, [chart, lyrics, modelReady, updateAlignStep]);

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
            Lyrics Alignment Tool
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Select a chart folder, paste lyrics, and align them to the audio
          </p>
        </header>

        {/* Step 1: Pick a chart directory */}
        {(status === 'idle' || (status === 'error' && !chart)) && (
          <div className="space-y-4">
            <Button size="lg" onClick={handlePickDirectory}>
              Select Chart Folder
            </Button>
            <p className="text-sm text-muted-foreground">
              Choose a Clone Hero song directory containing a chart file
              (notes.chart / notes.mid) and audio files.
            </p>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        )}

        {/* Loading chart */}
        {status === 'loading-chart' && (
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground" />
            <p className="text-muted-foreground">
              Reading chart directory...
            </p>
          </div>
        )}

        {/* Step 2: Chart loaded — show info + lyrics input */}
        {chart && (status === 'input' || (status === 'error' && chart)) && (
          <div className="space-y-6">
            {/* Chart info */}
            <div className="bg-muted rounded-lg p-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">
                  {chart.name}{' '}
                  <span className="text-muted-foreground font-normal">
                    by
                  </span>{' '}
                  {chart.artist}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Charted by {chart.charter} &middot;{' '}
                  {chart.audioFiles.length} audio file
                  {chart.audioFiles.length !== 1 ? 's' : ''}
                  {chart.vocalsFile && ' (vocals stem available)'}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handlePickDirectory}>
                Change
              </Button>
            </div>

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

            <div className="flex items-center gap-4">
              <Button
                onClick={handleAlign}
                disabled={!lyrics.trim()}
                size="lg">
                Align Lyrics
              </Button>
              {modelReady && (
                <span className="text-sm text-muted-foreground">
                  Alignment model ready
                </span>
              )}
              {!modelReady && (
                <span className="text-sm text-muted-foreground">
                  Alignment model loading in background...
                </span>
              )}
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
        )}

        {/* Processing */}
        {status === 'processing' && (
          <ProgressCard steps={alignSteps} error={error} />
        )}

        {/* Step 3: Results — karaoke viewer */}
        {showKaraoke && chart && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm text-muted-foreground">
                {alignedLines.reduce((n, l) => n + l.syllables.length, 0)}{' '}
                words aligned into {alignedLines.length} lines
              </span>
              <div className="flex gap-2">
                {TREATMENTS.map(t => (
                  <Button
                    key={t.id}
                    variant={treatment === t.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setTreatment(t.id)}>
                    {t.label}
                  </Button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAlignedLines([]);
                  setStatus('input');
                }}>
                Re-align
              </Button>
            </div>

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

function ProgressCard({
  steps,
  error,
}: {
  steps: PipelineStep[];
  error: string | null;
}) {
  return (
    <div className="bg-muted rounded-xl p-6 mb-8">
      <h2 className="text-lg font-semibold mb-4">Aligning Lyrics</h2>
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
