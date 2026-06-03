'use client';

import {useEffect, useState, useCallback, useRef, useMemo} from 'react';
import {
  AudioWaveform,
  ClipboardPaste,
  Download,
  FolderOpen,
  Move,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import {toast} from 'sonner';
import {parseChartFile} from '@eliwhite/scan-chart';
import type {LyricLine} from '@/lib/karaoke/parse-lyrics';
import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {getExtension, getBasename} from '@/lib/src-shared/utils';
import {removeStyleTags} from '@/lib/ui-utils';
import {
  findAudioFiles,
  type Files,
} from '@/lib/preview/chorus-chart-processing';
import {
  readChart,
  writeChartFolder,
  type ChartDocument,
} from '@/lib/chart-edit';
import {exportAsZip, exportAsSng} from '@/lib/chart-export';
import {downloadBlob} from '@/lib/download';
import {alignedSyllablesToChartLyrics} from '@/lib/lyrics-align/chart-lyrics';
import type {AlignedSyllable} from '@/lib/lyrics-align/aligner';
import {
  runDemucsInWorker,
  mixStemsToAudioBuffer,
} from '@/lib/lyrics-align/demucs-client';
import {buildTimedTempos, tickToMs} from '@/lib/drum-transcription/timing';
import {
  detectFormat,
  readChartDirectory,
  readSngFile,
  readZipFile,
  type LoadedFiles,
  type SourceFormat,
} from '@/components/chart-picker/chart-file-readers';
import ChartDropZone from '@/components/chart-picker/ChartDropZone';
import ProcessingView, {type ProcessingStep} from '@/components/ProcessingView';
import {
  ChartEditorProvider,
  DEFAULT_VOCALS_SCOPE,
  useChartEditorContext,
  ADD_LYRICS_CAPABILITIES,
} from '@/components/chart-editor';
import ChartEditor from '@/components/chart-editor/ChartEditor';
import {MoveEntitiesCommand} from '@/components/chart-editor/commands';
import {track} from '@/lib/analytics/track';
import {AudioManager} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import type {ChartResponseEncore} from '@/lib/chartSelection';

type ParsedChart = ReturnType<typeof parseChartFile>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoadedChart {
  audioFiles: Files;
  vocalsFile: {data: Uint8Array; mimeType: string} | null;
  chartDoc: ChartDocument;
  sourceFormat: SourceFormat;
  originalName: string;
  sngMetadata?: Record<string, string>;
}

/**
 * Mutable per-step state for the alignment pipeline. Keeps the same
 * fields ProcessingStep wants plus startTime so we can compute
 * durationMs on completion.
 */
type AlignStepKey =
  | 'decode'
  | 'separate'
  | 'syllabify'
  | 'align'
  | 'separate2'
  | 'align2';

interface AlignStepState {
  key: AlignStepKey;
  label: string;
  description?: string;
  status: 'pending' | 'active' | 'done' | 'error';
  detail?: string;
  progress?: number;
  etaSeconds?: number;
  startTime?: number;
  endTime?: number;
}

const ALIGN_STEPS: AlignStepState[] = [
  {key: 'decode', label: 'Decoding audio', status: 'pending'},
  {key: 'separate', label: 'Separating vocal stem', status: 'pending'},
  {
    key: 'syllabify',
    label: 'Splitting lyrics into syllables',
    status: 'pending',
  },
  {key: 'align', label: 'Aligning syllables to audio', status: 'pending'},
];

const TIER2_STEPS: AlignStepState[] = [
  {
    key: 'separate2',
    label: 'Re-separating vocals from full mix',
    status: 'pending',
  },
  {key: 'align2', label: 'Re-aligning with new vocal stem', status: 'pending'},
];

function alignStepsToProcessingSteps(
  steps: AlignStepState[],
): ProcessingStep[] {
  return steps.map(s => ({
    key: s.key,
    label: s.label,
    description: s.description,
    status: s.status,
    detail: s.detail,
    progress: s.progress,
    etaSeconds: s.etaSeconds,
    durationMs:
      s.status === 'done' &&
      s.startTime !== undefined &&
      s.endTime !== undefined
        ? s.endTime - s.startTime
        : undefined,
  }));
}

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

  return {
    audioFiles,
    vocalsFile: vocalsFile
      ? {
          data: vocalsFile.data,
          mimeType: getMimeForExtension(getExtension(vocalsFile.fileName)),
        }
      : null,
    chartDoc,
    sourceFormat,
    originalName,
    sngMetadata,
  };
}

/**
 * Clone + apply aligned lyrics to the chart document's PART VOCALS track.
 * Produces a new ChartDocument that writeChartFolder() can serialize with lyrics.
 *
 * Replaces both `notePhrases` and `staticLyricPhrases` on the vocals part:
 * scan-chart's MIDI writer unions both arrays when emitting lyric events, so
 * leaving the originals in place would cause duplicate (old + new) lyrics
 * on save.
 *
 * msTime fields are computed from each tick using the chart's tempo map so
 * the highway can position lyrics correctly. (scan-chart's parser fills
 * these in on parse, but we're constructing the doc directly here.)
 */
function applyAlignedLyricsToDoc(
  source: ChartDocument,
  syllables: AlignedSyllable[],
): ChartDocument {
  const {lyrics: chartLyrics, vocalPhrases} = alignedSyllablesToChartLyrics(
    syllables,
    source.parsedChart.tempos,
    source.parsedChart.resolution,
  );

  const resolution = source.parsedChart.resolution;
  const timedTempos = buildTimedTempos(source.parsedChart.tempos, resolution);
  const tickMs = (tick: number) => tickToMs(tick, timedTempos, resolution);

  // Group lyric events under each phrase and pair each lyric with a placeholder
  // pitched note (required so scan-chart keeps the phrase on round-trip).
  const notePhrases = vocalPhrases.map(phrase => {
    const phraseLyrics = chartLyrics.filter(
      l => l.tick >= phrase.tick && l.tick <= phrase.tick + phrase.length,
    );
    const phraseMsStart = tickMs(phrase.tick);
    const phraseMsEnd = tickMs(phrase.tick + phrase.length);
    return {
      tick: phrase.tick,
      msTime: phraseMsStart,
      length: phrase.length,
      msLength: phraseMsEnd - phraseMsStart,
      isPercussion: false,
      notes: phraseLyrics.map(l => ({
        tick: l.tick,
        msTime: tickMs(l.tick),
        length: 60,
        msLength: tickMs(l.tick + 60) - tickMs(l.tick),
        pitch: 60,
        type: 'pitched' as const,
      })),
      lyrics: phraseLyrics.map(l => ({
        tick: l.tick,
        msTime: tickMs(l.tick),
        text: l.text,
        flags: 0,
      })),
    };
  });

  const existingVocals = source.parsedChart.vocalTracks?.parts?.vocals;
  const vocalsPart = {
    ...(existingVocals ?? {
      staticLyricPhrases: [],
      starPowerSections: [],
      rangeShifts: [],
      lyricShifts: [],
      textEvents: [],
    }),
    notePhrases,
    // Clear staticLyricPhrases so scan-chart's writer doesn't union them
    // with the new notePhrases and emit duplicate lyrics.
    staticLyricPhrases: [],
  };

  const doc: ChartDocument = {
    ...source,
    parsedChart: {
      ...source.parsedChart,
      vocalTracks: {
        ...source.parsedChart.vocalTracks,
        parts: {
          ...source.parsedChart.vocalTracks?.parts,
          vocals: vocalsPart,
        },
      },
    },
  };

  return doc;
}

/** Decode audio into an interleaved Float32 PCM buffer for waveform display. */
async function decodeAudioForWaveform(
  data: Uint8Array,
): Promise<{interleaved: Float32Array; channels: number} | null> {
  try {
    const ctx = new AudioContext({sampleRate: 44100});
    try {
      const buf = data.slice(0).buffer as ArrayBuffer;
      const decoded = await ctx.decodeAudioData(buf);
      const channels = decoded.numberOfChannels;
      const length = decoded.length;
      const interleaved = new Float32Array(length * channels);
      for (let ch = 0; ch < channels; ch++) {
        const channelData = decoded.getChannelData(ch);
        for (let i = 0; i < length; i++) {
          interleaved[i * channels + ch] = channelData[i];
        }
      }
      return {interleaved, channels};
    } finally {
      await ctx.close();
    }
  } catch (err) {
    console.warn('Could not decode audio for waveform display', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

interface EditorData {
  chart: ParsedChart;
  chartDoc: ChartDocument;
  audioManager: AudioManager;
  audioData?: Float32Array;
  audioChannels: number;
  durationSeconds: number;
}

export default function AddLyricsClient() {
  return (
    <ChartEditorProvider
      capabilities={ADD_LYRICS_CAPABILITIES}
      activeScope={DEFAULT_VOCALS_SCOPE}>
      <LyricsAlignInner />
    </ChartEditorProvider>
  );
}

// Lyric/phrase entity kinds counted toward "manual moves" before export.
const LYRIC_MOVE_KINDS: ReadonlySet<string> = new Set([
  'lyric',
  'phrase-start',
  'phrase-end',
]);

function LyricsAlignInner() {
  const {state, dispatch, audioManagerRef} = useChartEditorContext();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [chart, setChart] = useState<LoadedChart | null>(null);
  const [lyrics, setLyrics] = useState('');
  const [alignedLines, setAlignedLines] = useState<LyricLine[]>([]);
  const [alignedSyllables, setAlignedSyllables] = useState<AlignedSyllable[]>(
    [],
  );
  const [alignSteps, setAlignSteps] = useState<AlignStepState[]>(ALIGN_STEPS);
  const [showLyricsWarning, setShowLyricsWarning] = useState(false);
  /**
   * Float32 16kHz mono PCM of the vocals stem used for alignment. Either
   * the chart's existing stem (resampled) or the AI-separated stem from
   * Demucs. Used as the highway's waveform source — never written into
   * the downloaded chart.
   */
  const [vocalsWaveform, setVocalsWaveform] = useState<Float32Array | null>(
    null,
  );
  const [editorData, setEditorData] = useState<EditorData | null>(null);
  const [showIntroModal, setShowIntroModal] = useState(false);
  const initStartedRef = useRef(false);

  // Open the intro modal once per browser, the first time the user
  // lands in the editor. Versioned key so a future copy update (v2)
  // re-fires once for returning users.
  useEffect(() => {
    if (!editorData) return;
    const KEY = 'add-lyrics:editor-intro-shown-v1';
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem(KEY)) return;
    setShowIntroModal(true);
    localStorage.setItem(KEY, '1');
  }, [editorData]);

  const updateAlignStep = useCallback(
    (key: AlignStepState['key'], update: Partial<AlignStepState>) => {
      setAlignSteps(prev =>
        prev.map(s => (s.key === key ? {...s, ...update} : s)),
      );
    },
    [],
  );

  // Tick once a second so each in-flight step's elapsed-fallback ETA
  // re-renders even when no new progress message has arrived. Cheap;
  // the interval only runs while alignment is processing.
  const [, setProcessingTick] = useState(0);
  useEffect(() => {
    if (status !== 'processing') return;
    const id = setInterval(() => setProcessingTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Preload alignment model in worker once chart is loaded
  useEffect(() => {
    if (status !== 'input' || initStartedRef.current) return;
    initStartedRef.current = true;

    (async () => {
      try {
        const {init} = await import('@/lib/lyrics-align/aligner');
        await init(msg => console.log('[aligner init]', msg));
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn('Failed to preload alignment model:', message);
      }
    })();
  }, [status]);

  // Tear down any AudioManager + audio decode state when leaving the results
  // view (Re-enter lyrics, chart reload) or unmounting the page.
  useEffect(() => {
    return () => {
      if (editorData) {
        editorData.audioManager.destroy();
      }
    };
  }, [editorData]);

  const handleChartLoaded = useCallback((loaded: LoadedFiles) => {
    setStatus('loading-chart');
    setError(null);

    try {
      const result = loadChartFromFiles(loaded);
      setChart(result);

      // Check for existing lyrics and warn
      const existingLyrics =
        result.chartDoc.parsedChart.vocalTracks.parts.vocals?.notePhrases.flatMap(
          p => p.lyrics,
        ) ?? [];
      if (existingLyrics.length > 0) {
        setShowLyricsWarning(true);
      }

      setStatus('input');
      track({
        event: 'add_lyrics_chart_loaded',
        sourceFormat: result.sourceFormat,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to load chart';
      setError(message);
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
        detail: undefined,
        progress: undefined,
        etaSeconds: undefined,
        startTime: undefined,
        endTime: undefined,
      })),
    );
    setStatus('processing');
    track({event: 'add_lyrics_align_started'});
    const alignStartedAt = Date.now();

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
        const blob = new Blob([songFile.data as Uint8Array<ArrayBuffer>], {
          type: mime,
        });
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

        vocals16k = await runDemucsInWorker(audioBuffer, p =>
          updateAlignStep('separate', {
            detail: p.message,
            progress: p.percent,
            etaSeconds: p.etaSeconds,
          }),
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

      // Stash a *copy* of the vocal stem for the highway waveform
      // display. alignVocals posts vocals16k into a worker and detaches
      // the underlying ArrayBuffer, which would leave the React-state
      // reference empty and the waveform invisible. Cloning is cheap
      // (~5 MB for a 5-minute song at 16kHz) and keeps the highway buffer
      // independent of the alignment pipeline. Never serialized into the
      // downloaded chart.
      setVocalsWaveform(new Float32Array(vocals16k));

      const {alignVocals} = await import('@/lib/lyrics-align/aligner');

      let result = await alignVocals(vocals16k, lyrics, msg => {
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

      // Tier-2 fallback: when pass-1 used the chart's bundled vocals stem
      // and the alignment was catastrophic (lowConfidenceFrac >= 0.75),
      // retry with a fresh Demucs separation against a reconstructed mix.
      // Only escalate if there's something new to try — pass 1 already
      // ran Demucs, or there's only one stem to mix → no point.
      const canEscalate =
        result.lowConfidence &&
        chart.vocalsFile != null &&
        chart.audioFiles.length >= 2;

      if (canEscalate) {
        const lowPct = Math.round(result.lowConfidenceFrac * 100);
        updateAlignStep('align', {
          description: `Confidence was low (${lowPct}% of syllables). Trying again with a fresh separation.`,
        });
        setAlignSteps(prev => [...prev, ...TIER2_STEPS.map(s => ({...s}))]);

        updateAlignStep('separate2', {
          status: 'active',
          detail: 'Mixing chart stems for re-separation...',
          startTime: Date.now(),
        });

        const stemInputs = chart.audioFiles.map(f => ({
          data: f.data,
          mimeType: getMimeForExtension(getExtension(f.fileName)),
        }));
        const mixedBuffer = await mixStemsToAudioBuffer(stemInputs);

        updateAlignStep('separate2', {
          detail: 'Starting Demucs worker...',
        });

        const vocals16k_2 = await runDemucsInWorker(mixedBuffer, p =>
          updateAlignStep('separate2', {
            detail: p.message,
            progress: p.percent,
            etaSeconds: p.etaSeconds,
          }),
        );
        updateAlignStep('separate2', {
          status: 'done',
          detail: `${(vocals16k_2.length / 16000).toFixed(1)}s mono 16kHz — re-separated`,
          endTime: Date.now(),
        });

        setVocalsWaveform(new Float32Array(vocals16k_2));

        updateAlignStep('align2', {
          status: 'active',
          startTime: Date.now(),
        });
        const result2 = await alignVocals(vocals16k_2, lyrics, msg => {
          if (msg.startsWith('Done:')) {
            updateAlignStep('align2', {
              status: 'done',
              endTime: Date.now(),
            });
          }
        });

        // Use the second pass unconditionally — first-pass timings were
        // already discarded above when we set vocalsWaveform.
        result = result2;
      }

      setAlignSteps(prev =>
        prev.map(s => ({
          ...s,
          status:
            s.status === 'pending' || s.status === 'active' ? 'done' : s.status,
          endTime: s.endTime ?? Date.now(),
        })),
      );

      setAlignedLines(result.lines);
      setAlignedSyllables(result.syllables);
      setStatus('done');
      track({
        event: 'add_lyrics_align_completed',
        totalMs: Date.now() - alignStartedAt,
        lowConfidence: result.lowConfidence ? 1 : 0,
        lowConfidenceFrac: Math.round(result.lowConfidenceFrac * 100) / 100,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus('error');
      const failedStep =
        alignSteps.find(s => s.status === 'active')?.key ?? 'unknown';
      setAlignSteps(prev =>
        prev.map(s =>
          s.status === 'active' ? {...s, status: 'error', detail: msg} : s,
        ),
      );
      track({event: 'add_lyrics_align_failed', step: failedStep});
    }
  }, [chart, lyrics, updateAlignStep, alignSteps]);

  const handleDownload = useCallback(() => {
    if (!chart || alignedSyllables.length === 0) return;

    try {
      const doc = applyAlignedLyricsToDoc(chart.chartDoc, alignedSyllables);

      // Write chart back to files
      const chartFiles = writeChartFolder(doc);

      // writeChartFolder emits notes.{chart,mid} + song.ini + every asset
      // from doc.assets (audio stems, album art, etc.) and skips any
      // chart-like file in the asset list. That covers the full export —
      // no need to merge in chart.rawFiles separately.
      const exportFiles = chartFiles.map(f => ({
        fileName: f.fileName,
        data: f.data,
      }));

      // Package in original format, using the original filename
      const ext = chart.sourceFormat === 'sng' ? '.sng' : '.zip';

      let blob: Blob;
      if (chart.sourceFormat === 'sng') {
        const sngBytes = exportAsSng(exportFiles);
        blob = new Blob([sngBytes as Uint8Array<ArrayBuffer>], {
          type: 'application/octet-stream',
        });
      } else {
        blob = exportAsZip(exportFiles);
      }

      const filename = chart.originalName + ext;

      downloadBlob(blob, filename);

      const manualMoveCount = state.undoStack.filter(
        cmd =>
          cmd instanceof MoveEntitiesCommand && LYRIC_MOVE_KINDS.has(cmd.kind),
      ).length;
      track({
        event: 'add_lyrics_exported',
        format: chart.sourceFormat === 'sng' ? 'sng' : 'zip',
        manualMoveCount,
      });

      toast.success('Chart exported with lyrics');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    }
  }, [chart, alignedSyllables, state.undoStack]);

  const showEditor = status === 'done' && alignedLines.length > 0;

  // Prepare the ChartEditor view when alignment completes. Builds a fresh
  // ChartDocument with the aligned lyrics applied, a running AudioManager,
  // and a decoded PCM buffer for the waveform display.
  useEffect(() => {
    if (!showEditor || !chart || alignedSyllables.length === 0) return;
    if (editorData) return; // already prepared

    let cancelled = false;
    let createdAudioManager: AudioManager | null = null;
    (async () => {
      try {
        const nextDoc = applyAlignedLyricsToDoc(
          chart.chartDoc,
          alignedSyllables,
        );

        const audioManager = new AudioManager(chart.audioFiles, () => {
          dispatch({type: 'SET_PLAYING', isPlaying: false});
        });
        createdAudioManager = audioManager;
        await audioManager.ready;
        if (cancelled) {
          audioManager.destroy();
          return;
        }
        audioManager.setChartDelay(
          getChartDelayMs(nextDoc.parsedChart.metadata) / 1000,
        );

        // Highway waveform: prefer the same vocals buffer used during
        // alignment (16kHz mono Float32 from `vocalsWaveform`). Falls back
        // to decoding the song mix only if alignment somehow ran without
        // populating that state. The waveform display is a visual cue, so
        // a 16kHz mono source plots fine across the song duration.
        const waveform: {interleaved: Float32Array; channels: number} | null =
          vocalsWaveform
            ? {interleaved: vocalsWaveform, channels: 1}
            : await decodeAudioForWaveform(chart.audioFiles[0].data);
        if (cancelled) {
          audioManager.destroy();
          return;
        }

        const durationSeconds = audioManager.duration;

        audioManagerRef.current = audioManager;
        dispatch({type: 'SET_CHART_DOC', chartDoc: nextDoc});

        setEditorData({
          chart: nextDoc.parsedChart as ParsedChart,
          chartDoc: nextDoc,
          audioManager,
          audioData: waveform?.interleaved,
          audioChannels: waveform?.channels ?? 1,
          durationSeconds,
        });

        // add-lyrics defaults to the waveform highway since the user is
        // syncing lyrics to vocal energy, not navigating notes.
        dispatch({type: 'SET_HIGHWAY_MODE', mode: 'waveform'});
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to prepare chart editor:', err);
        toast.error(
          err instanceof Error ? err.message : 'Failed to prepare preview',
        );
        createdAudioManager?.destroy();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    showEditor,
    chart,
    alignedSyllables,
    editorData,
    vocalsWaveform,
    dispatch,
    audioManagerRef,
  ]);

  const cloneHeroMetadata = useMemo<ChartResponseEncore | null>(() => {
    if (!chart) return null;
    const md = chart.chartDoc.parsedChart.metadata;
    return {
      name: md.name ?? 'Unknown',
      artist: md.artist ?? 'Unknown',
      charter: md.charter ?? 'Unknown',
      md5: '',
      hasVideoBackground: false,
      albumArtMd5: '',
      notesData: {} as ChartResponseEncore['notesData'],
      modifiedTime: '',
      file: '',
    } as ChartResponseEncore;
  }, [chart]);

  const getChartText = useCallback(async (): Promise<string> => {
    if (!editorData) throw new Error('No chart prepared');
    const files = writeChartFolder(editorData.chartDoc);
    const chartFile = files.find(f => f.fileName === 'notes.chart');
    if (!chartFile)
      throw new Error('writeChartFolder did not produce notes.chart');
    return new TextDecoder().decode(chartFile.data);
  }, [editorData]);

  if (showEditor && chart) {
    const md = chart.chartDoc.parsedChart.metadata;
    const songName = md.name ?? 'Unknown';
    const artistName = md.artist ?? 'Unknown';
    const charterName = md.charter ?? 'Unknown';
    return (
      <main className="h-screen w-screen flex flex-col bg-background overflow-hidden">
        <div className="shrink-0 border-b bg-background px-4 py-2 flex items-center gap-3 flex-wrap">
          <div className="min-w-0 mr-auto">
            <h1 className="text-sm font-semibold truncate">
              {removeStyleTags(songName)}
              <span className="text-muted-foreground font-normal"> by </span>
              {removeStyleTags(artistName)}
            </h1>
            <p className="text-xs text-muted-foreground">
              {alignedLines.reduce((n, l) => n + l.syllables.length, 0)}{' '}
              syllables aligned into {alignedLines.length} lines
            </p>
          </div>
          <span className="hidden sm:inline text-xs text-muted-foreground">
            Drag any lyric to fix its timing
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (editorData) {
                editorData.audioManager.destroy();
              }
              audioManagerRef.current = null;
              setEditorData(null);
              setAlignedLines([]);
              setAlignedSyllables([]);
              setVocalsWaveform(null);
              setStatus('input');
              track({event: 'add_lyrics_realign'});
            }}>
            Re-enter lyrics
          </Button>
          <Button size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" />
            Download .{chart.sourceFormat === 'sng' ? 'sng' : 'zip'}
          </Button>
        </div>
        <Dialog open={showIntroModal} onOpenChange={setShowIntroModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Your lyrics are aligned</DialogTitle>
              <DialogDescription>
                A few things worth knowing before you fine-tune.
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <Move className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <span>
                  <strong>Drag any lyric</strong> on the highway to nudge its
                  timing. Useful when the aligner picked the wrong onset.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <AudioWaveform className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <span>
                  The waveform on the highway is the{' '}
                  <strong>isolated vocal stem</strong>, not the full song mix —
                  easier to spot where each line should sit.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Download className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <span>
                  When the timing looks right, hit <strong>Download</strong> in
                  the top-right to get the updated chart.
                </span>
              </li>
            </ul>
            <DialogFooter>
              <Button onClick={() => setShowIntroModal(false)}>Got it</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <div className="flex-1 min-h-0">
          {editorData && cloneHeroMetadata ? (
            <ChartEditor
              metadata={cloneHeroMetadata}
              chart={editorData.chart}
              audioManager={editorData.audioManager}
              audioData={editorData.audioData}
              audioChannels={editorData.audioChannels}
              durationSeconds={editorData.durationSeconds}
              sections={editorData.chart.sections}
              songName={songName}
              artistName={artistName}
              charterName={charterName}
              getChartText={getChartText}
              hideHeader
            />
          ) : (
            <div className="flex items-center justify-center gap-3 h-full">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground" />
              <p className="text-muted-foreground">Preparing preview...</p>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background w-full">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">
            Add Lyrics To A Chart
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Paste your lyrics — they&rsquo;re automatically synced to the audio,
            syllable-by-syllable. Runs entirely in your browser.
          </p>
        </header>

        {/* Step 1: Landing — flow diagram + drop zone */}
        {(status === 'idle' || (status === 'error' && !chart)) && (
          <div className="space-y-8">
            {/* Flow diagram */}
            <div className="bg-muted rounded-xl p-6">
              <div className="flex items-center justify-between">
                <FlowStep Icon={FolderOpen} label="Open" desc="Your chart" />
                <FlowArrow />
                <FlowStep
                  Icon={ClipboardPaste}
                  label="Paste"
                  desc="Song lyrics"
                />
                <FlowArrow />
                <FlowStep Icon={AudioWaveform} label="Align" desc="Automatic" />
                <FlowArrow />
                <FlowStep
                  Icon={Download}
                  label="Download"
                  desc="Updated chart"
                />
              </div>
            </div>

            <ChartDropZone onLoaded={handleChartLoaded} id="add-lyrics-chart" />
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

        {/* Steps 2-3: chart loaded — info header stays visible during input AND processing */}
        {chart &&
          (status === 'input' ||
            status === 'processing' ||
            (status === 'error' && chart)) && (
            <div className="space-y-6">
              {/* Chart info */}
              <div className="bg-muted rounded-lg p-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">
                    {removeStyleTags(
                      chart.chartDoc.parsedChart.metadata.name ?? 'Unknown',
                    )}{' '}
                    <span className="text-muted-foreground font-normal">
                      by
                    </span>{' '}
                    {removeStyleTags(
                      chart.chartDoc.parsedChart.metadata.artist ?? 'Unknown',
                    )}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Charted by{' '}
                    {removeStyleTags(
                      chart.chartDoc.parsedChart.metadata.charter ?? 'Unknown',
                    )}{' '}
                    &middot; {chart.audioFiles.length} audio file
                    {chart.audioFiles.length !== 1 ? 's' : ''}
                    {chart.vocalsFile &&
                      ' (vocals stem available)'} &middot;{' '}
                    {chart.sourceFormat === 'sng'
                      ? '.sng'
                      : chart.sourceFormat === 'zip'
                        ? '.zip'
                        : 'folder'}
                  </p>
                </div>
                {status === 'input' && (
                  <ReplaceChartButton onLoaded={handleChartLoaded} />
                )}
              </div>

              {/* Processing card. Renders inside the same column so the
                  song info header stays at the top while the steps run. */}
              {status === 'processing' && (
                <ProcessingView
                  title="Adding lyrics to your chart"
                  steps={alignStepsToProcessingSteps(alignSteps)}
                  error={error}
                  className="max-w-none"
                />
              )}

              {/* Existing lyrics warning */}
              {status !== 'processing' && showLyricsWarning && (
                <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 flex items-start gap-3">
                  <TriangleAlert className="h-4 w-4 mt-0.5 text-yellow-700 dark:text-yellow-300 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
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
                </div>
              )}

              {/* Lyrics textarea + Align button. Hidden during processing
                  so the step list is the only thing in view. */}
              {status !== 'processing' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Paste Lyrics
                    </label>
                    <p className="text-xs text-muted-foreground mb-2">
                      All pasted text becomes lyrics, so don&apos;t include
                      non-lyric symbols or section headers like [Verse]. One
                      line per phrase.
                    </p>
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
                    size="lg"
                    className="w-full sm:w-auto">
                    Align Lyrics
                  </Button>
                </>
              )}

              {error && <p className="text-destructive text-sm">{error}</p>}
            </div>
          )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Flow diagram bits
// ---------------------------------------------------------------------------

function FlowStep({
  Icon,
  label,
  desc,
}: {
  Icon: LucideIcon;
  label: string;
  desc: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 min-w-0">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-background">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </span>
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
// Replace-chart button
// ---------------------------------------------------------------------------

/**
 * Compact replace-chart control for the chart-loaded state. Replaces
 * the full ChartDropZone, which would otherwise duplicate the loaded
 * card and make users wonder if the upload took.
 *
 * Folder picker is the primary action — it's the more common path
 * users reach for when picking a Clone Hero chart. .zip / .sng falls
 * back to a hidden file input via a small text link beneath.
 */
function ReplaceChartButton({
  onLoaded,
}: {
  onLoaded: (result: LoadedFiles) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      const format = detectFormat(file);
      if (!format) {
        toast.error('Please pick a .zip or .sng file');
        return;
      }
      setIsLoading(true);
      try {
        const result =
          format === 'zip' ? await readZipFile(file) : await readSngFile(file);
        onLoaded(result);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to read file');
      } finally {
        setIsLoading(false);
      }
    },
    [onLoaded],
  );

  const handlePickFolder = useCallback(async () => {
    if (isLoading) return;
    try {
      const dirHandle = await window.showDirectoryPicker({
        id: 'add-lyrics-chart',
      });
      setIsLoading(true);
      const result = await readChartDirectory(dirHandle);
      onLoaded(result);
    } catch (e) {
      const err = e as DOMException;
      if (err?.name === 'AbortError') return;
      toast.error(err?.message ?? 'Failed to read directory');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, onLoaded]);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handlePickFolder}
        disabled={isLoading}>
        <FolderOpen className="h-4 w-4 mr-2" />
        {isLoading ? 'Reading...' : 'Choose new chart'}
      </Button>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isLoading}
        className="text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50">
        or pick a .zip / .sng file
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,.sng"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
