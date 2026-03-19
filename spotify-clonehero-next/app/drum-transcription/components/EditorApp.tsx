'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
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
import {encodeWavBlob} from '@/lib/drum-transcription/audio/wav-encoder';
import {parsedChartToDocument} from '@/lib/drum-transcription/chart-io/parsed-to-doc';
import {useEditorContext} from '../contexts/EditorContext';
import {useEditorKeyboard} from '../hooks/useEditorKeyboard';
import {useAutoSave} from '../hooks/useAutoSave';
import TransportControls from './TransportControls';
import WaveformDisplay from './WaveformDisplay';
import ExportDialog from './ExportDialog';
import HighwayEditor from './HighwayEditor';
import EditToolbar from './EditToolbar';
import NoteInspector from './NoteInspector';
import ConfidencePanel from './ConfidencePanel';
import StemVolumeControls from './StemVolumeControls';
import LoopControls from './LoopControls';

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
 * creates AudioManager, and renders the editing UI with
 * HighwayEditor, SheetMusic, transport controls, editing tools,
 * confidence panel, stem controls, and loop controls.
 */
export default function EditorApp({projectId}: EditorAppProps) {
  const {state, dispatch, audioManagerRef} = useEditorContext();
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [loadingStep, setLoadingStep] = useState<string>(
    'Loading project metadata...',
  );
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [projectMeta, setProjectMeta] = useState<ProjectMetadata | null>(null);
  const [audioMeta, setAudioMeta] = useState<AudioStorageMeta | null>(null);
  const [audioPcm, setAudioPcm] = useState<Float32Array | null>(null);
  const [audioChannels, setAudioChannels] = useState(2);
  const [durationSeconds, setDurationSeconds] = useState(0);

  // Auto-save hook
  const {save} = useAutoSave(loadingState === 'ready' ? projectId : null);

  // Register keyboard shortcuts for editing (pass save function)
  useEditorKeyboard(save);

  // Load data from OPFS
  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      try {
        // 1. Load project metadata
        setLoadingStep('Loading project metadata...');
        const meta = await getProject(projectId);
        if (cancelled) return;
        setProjectMeta(meta);

        // 2. Load chart - prefer edited version, fall back to generated
        setLoadingStep('Loading chart data...');
        let loadedChartText: string;
        const hasEdited = await projectFileExists(
          projectId,
          'notes.edited.chart',
        );
        if (hasEdited) {
          loadedChartText = await readProjectText(
            projectId,
            'notes.edited.chart',
          );
        } else {
          loadedChartText = await readProjectText(projectId, 'notes.chart');
        }
        if (cancelled) return;

        // 3. Parse chart
        const chartBytes = new TextEncoder().encode(loadedChartText);
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

        // 5. Build editable ChartDocument from parsed chart
        const chartDoc = parsedChartToDocument(parsed, loadedChartText);

        // 6. Load confidence data (if available)
        try {
          const hasConfidence = await projectFileExists(
            projectId,
            'confidence.json',
          );
          if (hasConfidence) {
            const confText = await readProjectText(
              projectId,
              'confidence.json',
            );
            const confData = JSON.parse(confText) as {
              notes: Record<string, number>;
            };
            const confMap = new Map<string, number>(
              Object.entries(confData.notes),
            );
            dispatch({type: 'SET_CONFIDENCE', confidence: confMap});
          }
        } catch (err) {
          console.warn('Failed to load confidence data:', err);
        }

        // 7. Load review progress (if available)
        try {
          const hasReview = await projectFileExists(
            projectId,
            'review-progress.json',
          );
          if (hasReview) {
            const reviewText = await readProjectText(
              projectId,
              'review-progress.json',
            );
            const reviewData = JSON.parse(reviewText) as {reviewed: string[]};
            dispatch({
              type: 'SET_REVIEWED_NOTES',
              noteIds: new Set(reviewData.reviewed),
            });
          }
        } catch (err) {
          console.warn('Failed to load review progress:', err);
        }

        // 8. Load audio metadata
        const aMeta = await loadAudioMeta(projectId);
        if (cancelled) return;
        setAudioMeta(aMeta);
        setDurationSeconds(aMeta.durationMs / 1000);

        // 9. Load raw PCM for waveform visualization
        const audioDir = await getAudioDir(projectId);
        const pcmHandle = await audioDir.getFileHandle('full.pcm');
        const pcmFile = await pcmHandle.getFile();
        const pcmData = new Float32Array(await pcmFile.arrayBuffer());
        if (cancelled) return;
        setAudioPcm(pcmData);
        setAudioChannels(aMeta.channels);

        // 10. Create AudioManager from the audio files
        // Always load the full mix as "song.wav" so there's always a
        // complete audio track. Then load any separated stems on top —
        // AudioManager merges all files with "drums" in the name into
        // a single drums track, and other stems become separate tracks.
        setLoadingStep('Preparing audio...');
        const fullMixWav = encodeWavBlob(
          pcmData,
          aMeta.sampleRate,
          aMeta.channels,
        );
        const fullMixArray = new Uint8Array(await fullMixWav.arrayBuffer());
        const audioFiles: {fileName: string; data: Uint8Array}[] = [
          {fileName: 'song.wav', data: fullMixArray},
        ];

        // Load separated stems if Demucs has run
        setLoadingStep('Loading stems...');
        const stemNames = ['drums', 'bass', 'other', 'vocals'];
        for (const stemName of stemNames) {
          try {
            const stemDir = await getStemsDir(projectId);
            const stemHandle = await stemDir.getFileHandle(`${stemName}.pcm`);
            const stemFile = await stemHandle.getFile();
            const stemPcm = new Float32Array(await stemFile.arrayBuffer());
            const stemWav = encodeWavBlob(
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

        // 11. Update editor state
        dispatch({type: 'SET_CHART', chart: parsed, track: drumTrack});
        dispatch({type: 'SET_CHART_DOC', chartDoc});
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

  // Build a minimal metadata object for CloneHeroRenderer.
  // Memoized so the reference is stable across renders (prevents
  // DrumHighwayPreview from tearing down and rebuilding the 3D renderer).
  const cloneHeroMetadata = useMemo(
    () =>
      projectMeta
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
        : null,
    [projectMeta],
  );

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
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* Highway — full width/height, the primary editing surface */}
      <HighwayEditor
        metadata={cloneHeroMetadata}
        chart={chart}
        audioManager={audioManagerRef.current}
        className="h-full w-full"
      />

      {/* Overlaid panels — positioned on edges over the dark highway space */}

      {/* Top bar: toolbar + project name + export */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <h2 className="text-sm font-semibold text-white/90 truncate">
            {projectMeta?.name ?? 'Untitled'}
          </h2>
          {state.dirty && (
            <span className="text-xs text-amber-400" title="Unsaved changes">
              *
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <EditToolbar />
          <LoopControls audioManager={audioManagerRef.current} />
          <ExportDialog
            projectId={projectId}
            songName={projectMeta?.name ?? 'Untitled'}
          />
        </div>
      </div>

      {/* Left panel: note inspector + confidence + stem controls */}
      <div className="absolute top-12 left-2 bottom-24 z-10 w-[260px] flex flex-col gap-2 overflow-y-auto pointer-events-auto">
        <NoteInspector />
        <ConfidencePanel />
        <StemVolumeControls audioManager={audioManagerRef.current} />
      </div>

      {/* Bottom bar: transport + waveform in a single row */}
      <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-2 bg-black/80 backdrop-blur-sm">
          <TransportControls
            audioManager={audioManagerRef.current}
            durationSeconds={durationSeconds}
            sections={chart.sections}
          />
          {audioPcm && (
            <WaveformDisplay
              audioData={audioPcm}
              channels={audioChannels}
              audioManager={audioManagerRef.current}
              durationSeconds={durationSeconds}
              className="flex-1 min-w-0"
            />
          )}
        </div>
      </div>
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
