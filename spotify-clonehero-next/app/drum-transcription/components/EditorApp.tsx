'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {parseChartFile} from '@eliwhite/scan-chart';
import {Loader2, AlertCircle} from 'lucide-react';
import {toast} from 'sonner';

import {AudioManager} from '@/lib/preview/audioManager';
import {
  getProject,
  readProjectText,
  projectFileExists,
  loadAudioMeta,
  type ProjectMetadata,
  type AudioStorageMeta,
} from '@/lib/drum-transcription/storage/opfs';
import {useEditorContext} from '../contexts/EditorContext';
import SheetMusic from '@/app/sheet-music/[slug]/SheetMusic';
import CloneHeroRenderer from '@/app/sheet-music/[slug]/CloneHeroRenderer';
import TransportControls from './TransportControls';
import WaveformDisplay from './WaveformDisplay';

type ParsedChart = ReturnType<typeof parseChartFile>;

/** Pro drums modifiers for scan-chart parsing. */
const PRO_DRUMS_MODIFIERS = {
  song_length: 0,
  hopo_frequency: 0,
  eighthnote_hopo: false,
  multiplier_note: 0,
  sustain_cutoff_threshold: -1,
  chord_snap_threshold: 0,
  five_lane_drums: false,
  pro_drums: true,
} as const;

type LoadingState = 'loading' | 'ready' | 'error';

interface EditorAppProps {
  projectId: string;
}

/**
 * Top-level editor layout. Loads chart + audio from OPFS,
 * creates AudioManager, and renders SheetMusic + CloneHeroRenderer
 * side by side with transport controls.
 */
export default function EditorApp({projectId}: EditorAppProps) {
  const {state, dispatch, audioManagerRef, wavesurferRef} = useEditorContext();
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [projectMeta, setProjectMeta] = useState<ProjectMetadata | null>(null);
  const [audioMeta, setAudioMeta] = useState<AudioStorageMeta | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [rerenderKey, setRerenderKey] = useState('initial');
  const animationFrameRef = useRef<number>(0);
  const lastDispatchTimeRef = useRef(0);

  // Load data from OPFS
  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      try {
        // 1. Load project metadata
        const meta = await getProject(projectId);
        if (cancelled) return;
        setProjectMeta(meta);

        // 2. Load chart - prefer edited version, fall back to generated
        let chartText: string;
        const hasEdited = await projectFileExists(
          projectId,
          'notes.edited.chart',
        );
        if (hasEdited) {
          chartText = await readProjectText(projectId, 'notes.edited.chart');
        } else {
          chartText = await readProjectText(projectId, 'notes.chart');
        }
        if (cancelled) return;

        // 3. Parse chart
        const chartBytes = new TextEncoder().encode(chartText);
        const parsed = parseChartFile(
          chartBytes,
          'chart',
          PRO_DRUMS_MODIFIERS,
        );

        // 4. Find expert drums track
        const drumTrack = parsed.trackData.find(
          t => t.instrument === 'drums' && t.difficulty === 'expert',
        );
        if (!drumTrack) {
          throw new Error(
            'No Expert Drums track found in chart. Available tracks: ' +
              parsed.trackData
                .map(t => `${t.instrument}/${t.difficulty}`)
                .join(', '),
          );
        }

        // 5. Load audio metadata
        const aMeta = await loadAudioMeta(projectId);
        if (cancelled) return;
        setAudioMeta(aMeta);
        setDurationSeconds(aMeta.durationMs / 1000);

        // 6. Create audio blob from stored PCM for WaveSurfer visualization
        // Read the raw PCM and create a WAV blob for WaveSurfer
        const audioDir = await getAudioDir(projectId);
        const pcmHandle = await audioDir.getFileHandle('full.pcm');
        const pcmFile = await pcmHandle.getFile();
        const pcmData = new Float32Array(await pcmFile.arrayBuffer());

        // Create a WAV blob from PCM data for WaveSurfer
        const wavBlob = pcmToWavBlob(pcmData, aMeta.sampleRate, aMeta.channels);
        if (cancelled) return;
        setAudioBlob(wavBlob);

        // 7. Create AudioManager from the audio files
        // AudioManager expects Files format: {fileName: string, data: Uint8Array}[]
        const wavArray = new Uint8Array(await wavBlob.arrayBuffer());
        const audioFiles = [{fileName: 'song.wav', data: wavArray}];

        // Check for individual stems
        const stemNames = ['drums', 'bass', 'other', 'vocals'];
        for (const stemName of stemNames) {
          try {
            const stemDir = await getStemsDir(projectId);
            const stemHandle = await stemDir.getFileHandle(`${stemName}.pcm`);
            const stemFile = await stemHandle.getFile();
            const stemPcm = new Float32Array(await stemFile.arrayBuffer());
            const stemWav = pcmToWavBlob(
              stemPcm,
              aMeta.sampleRate,
              aMeta.channels,
            );
            const stemArray = new Uint8Array(await stemWav.arrayBuffer());
            audioFiles.push({
              fileName: `${stemName}.wav`,
              data: stemArray,
            });
          } catch {
            // Stem not available, skip
          }
        }

        const audioManager = new AudioManager(audioFiles, () => {
          dispatch({type: 'SET_PLAYING', isPlaying: false});
        });
        await audioManager.ready;
        if (cancelled) return;

        audioManagerRef.current = audioManager;

        // 8. Update editor state
        dispatch({type: 'SET_CHART', chart: parsed, track: drumTrack});
        setLoadingState('ready');
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof Error ? err.message : 'Failed to load project';
        console.error('EditorApp load error:', err);
        setErrorMessage(msg);
        setLoadingState('error');
        toast.error(msg);
      }
    }

    loadProject();

    return () => {
      cancelled = true;
      // Clean up AudioManager on unmount
      audioManagerRef.current?.destroy();
      audioManagerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Animation frame loop to sync current time from AudioManager to context
  useEffect(() => {
    function animationLoop() {
      const am = audioManagerRef.current;
      if (am) {
        const playing = am.isPlaying;
        const currentTimeMs = am.currentTime * 1000;

        // Update playing state
        dispatch({type: 'SET_PLAYING', isPlaying: playing});

        // Throttle time updates to ~30fps to avoid excess renders
        const now = performance.now();
        if (now - lastDispatchTimeRef.current > 33) {
          dispatch({type: 'SET_CURRENT_TIME', timeMs: currentTimeMs});
          lastDispatchTimeRef.current = now;
        }

        // Sync WaveSurfer visual position
        const ws = wavesurferRef.current;
        if (ws && durationSeconds > 0 && playing) {
          const progress = Math.max(
            0,
            Math.min(1, am.currentTime / durationSeconds),
          );
          ws.seekTo(progress);
        }
      }

      animationFrameRef.current = requestAnimationFrame(animationLoop);
    }

    animationFrameRef.current = requestAnimationFrame(animationLoop);
    return () => cancelAnimationFrame(animationFrameRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationSeconds]);

  // Handle measure click in SheetMusic
  const handleSelectMeasure = useCallback(
    (time: number) => {
      audioManagerRef.current?.play({time});
    },
    [audioManagerRef],
  );

  // Build a minimal metadata object for CloneHeroRenderer
  const cloneHeroMetadata = projectMeta
    ? {
        name: projectMeta.name,
        artist: '',
        charter: '',
        md5: '',
        hasVideoBackground: false,
        albumArtMd5: '',
        notesData: {} as any,
        modifiedTime: projectMeta.updatedAt,
        file: '',
      }
    : null;

  if (loadingState === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading project...</p>
      </div>
    );
  }

  if (loadingState === 'error') {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-sm text-destructive">{errorMessage}</p>
      </div>
    );
  }

  const {chart, track} = state;
  if (!chart || !track || !audioManagerRef.current || !cloneHeroMetadata) {
    return null;
  }

  return (
    <div className="flex flex-col h-full w-full gap-2 p-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 rounded-lg border bg-background">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold truncate">
            {projectMeta?.name ?? 'Untitled'}
          </h2>
        </div>
      </div>

      {/* WaveSurfer Panel */}
      {audioBlob && (
        <WaveformDisplay
          audioData={audioBlob}
          audioManager={audioManagerRef.current}
          durationSeconds={durationSeconds}
        />
      )}

      {/* Main content: SheetMusic + CloneHeroRenderer side by side */}
      <div className="flex flex-1 gap-2 min-h-0">
        <div className="flex-1 min-w-0 overflow-auto">
          <SheetMusic
            chart={chart}
            track={track}
            currentTime={state.currentTimeMs / 1000}
            showBarNumbers={true}
            enableColors={true}
            showLyrics={false}
            zoom={state.zoom}
            onSelectMeasure={handleSelectMeasure}
            triggerRerender={rerenderKey}
            practiceModeConfig={null}
            onPracticeMeasureSelect={() => {}}
            selectionIndex={null}
            audioManagerRef={audioManagerRef}
          />
        </div>

        <div className="w-[300px] shrink-0 h-full">
          <CloneHeroRenderer
            metadata={cloneHeroMetadata}
            chart={chart}
            track={track}
            audioManager={audioManagerRef.current}
          />
        </div>
      </div>

      {/* Transport Controls */}
      <TransportControls
        audioManager={audioManagerRef.current}
        durationSeconds={durationSeconds}
        sections={chart.sections}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// OPFS helpers
// ---------------------------------------------------------------------------

async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

async function getNamespaceDir(): Promise<FileSystemDirectoryHandle> {
  const root = await getOPFSRoot();
  return root.getDirectoryHandle('drum-transcription');
}

async function getProjectDir(
  projectId: string,
): Promise<FileSystemDirectoryHandle> {
  const ns = await getNamespaceDir();
  return ns.getDirectoryHandle(projectId);
}

async function getAudioDir(
  projectId: string,
): Promise<FileSystemDirectoryHandle> {
  const projectDir = await getProjectDir(projectId);
  return projectDir.getDirectoryHandle('audio');
}

async function getStemsDir(
  projectId: string,
): Promise<FileSystemDirectoryHandle> {
  const projectDir = await getProjectDir(projectId);
  return projectDir.getDirectoryHandle('stems');
}

// ---------------------------------------------------------------------------
// PCM to WAV conversion (for WaveSurfer / AudioManager)
// ---------------------------------------------------------------------------

/**
 * Convert interleaved Float32 PCM data to a WAV Blob.
 */
function pcmToWavBlob(
  pcmData: Float32Array,
  sampleRate: number,
  channels: number,
): Blob {
  const bytesPerSample = 2; // 16-bit
  const dataLength = pcmData.length * bytesPerSample;
  const headerLength = 44;
  const buffer = new ArrayBuffer(headerLength + dataLength);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Convert float32 to int16
  const offset = 44;
  for (let i = 0; i < pcmData.length; i++) {
    const sample = Math.max(-1, Math.min(1, pcmData[i]));
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(offset + i * 2, int16, true);
  }

  return new Blob([buffer], {type: 'audio/wav'});
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
