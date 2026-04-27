'use client';

import {useCallback, useEffect, useMemo, useState} from 'react';
import {defaultIniChartModifiers, parseChartFile} from '@eliwhite/scan-chart';
import {Loader2, AlertCircle} from 'lucide-react';
import {toast} from 'sonner';

import {AudioManager} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import {
  getProject,
  readProjectText,
  projectFileExists,
  loadAudioMeta,
  type ProjectMetadata,
  type AudioStorageMeta,
} from '@/lib/drum-transcription/storage/opfs';
import {encodeWavBlob} from '@/lib/drum-transcription/audio/wav-encoder';
import {readChart, writeChartFolder} from '@/lib/chart-edit';
import {useHotkey} from '@tanstack/react-hotkeys';
import {
  useChartEditorContext,
  getSelectedIds,
} from '@/components/chart-editor/ChartEditorContext';
import {useEditorKeyboard} from '@/components/chart-editor/hooks/useEditorKeyboard';
import {useAutoSave} from '@/components/chart-editor/hooks/useAutoSave';
import {noteId} from '@/components/chart-editor/commands';
import ChartEditor from '@/components/chart-editor/ChartEditor';
import type {AudioSource} from '@/components/chart-editor/ExportDialog';
import {
  useDrumTranscriptionContext,
  DrumTranscriptionProvider,
} from '../contexts/DrumTranscriptionContext';
import ConfidencePanel from './ConfidencePanel';
import StemVolumeControls from './StemVolumeControls';
import {getDrumNotes} from '@/lib/chart-edit';
import {buildTimedTempos} from '@/lib/drum-transcription/timing';
import type {DrumNote} from '@/lib/chart-edit';

/** Drum-transcription always parses charts with pro-drums interpretation
 *  — the editor is drum-only and pro-drums tom/cymbal modifiers are
 *  meaningful regardless of any upstream song.ini. */
const PRO_DRUMS_MODIFIERS = {
  ...defaultIniChartModifiers,
  pro_drums: true,
} as const;

type LoadingState = 'loading' | 'ready' | 'error';

interface EditorAppProps {
  projectId: string;
}

/**
 * Top-level editor layout for drum-transcription.
 *
 * Loads chart + audio from OPFS, creates AudioManager, and wraps
 * DrumTranscriptionProvider around the shared ChartEditor shell.
 * Passes ConfidencePanel and StemVolumeControls as leftPanelChildren.
 */
export default function EditorApp({projectId}: EditorAppProps) {
  return (
    <DrumTranscriptionProvider>
      <EditorAppInner projectId={projectId} />
    </DrumTranscriptionProvider>
  );
}

function EditorAppInner({projectId}: {projectId: string}) {
  const {state, dispatch, audioManagerRef} = useChartEditorContext();
  const {dtState, dtDispatch} = useDrumTranscriptionContext();
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [, setLoadingStep] = useState<string>('Loading project metadata...');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [projectMeta, setProjectMeta] = useState<ProjectMetadata | null>(null);
  const [audioMeta, setAudioMeta] = useState<AudioStorageMeta | null>(null);
  const [audioPcm, setAudioPcm] = useState<Float32Array | null>(null);
  const [audioChannels, setAudioChannels] = useState(2);
  const [durationSeconds, setDurationSeconds] = useState(0);
  // Mirrors audioManagerRef (shared via context for event-handler reads)
  // into render-visible state so ChartEditor and StemVolumeControls
  // receive a stable prop without reading ref.current during render.
  const [audioManager, setAudioManager] = useState<AudioManager | null>(null);

  // Build the save function for auto-save
  const saveFn = useCallback(async () => {
    if (!state.chartDoc) return;

    const root = await navigator.storage.getDirectory();
    const nsDir = await root.getDirectoryHandle('drum-transcription');
    const projectDir = await nsDir.getDirectoryHandle(projectId);

    // Save edited chart
    const files = writeChartFolder(state.chartDoc);
    const chartText = new TextDecoder().decode(
      files.find(f => f.fileName === 'notes.chart')!.data,
    );
    const chartFile = await projectDir.getFileHandle('notes.edited.chart', {
      create: true,
    });
    const chartWritable = await chartFile.createWritable();
    await chartWritable.write(chartText);
    await chartWritable.close();

    // Save review progress
    const reviewJson = JSON.stringify({
      reviewed: Array.from(dtState.reviewedNoteIds),
    });
    const reviewFile = await projectDir.getFileHandle('review-progress.json', {
      create: true,
    });
    const reviewWritable = await reviewFile.createWritable();
    await reviewWritable.write(reviewJson);
    await reviewWritable.close();
  }, [projectId, state.chartDoc, dtState.reviewedNoteIds]);

  // Auto-save hook (uses shared hook, passes the save function)
  const {save} = useAutoSave(loadingState === 'ready' ? saveFn : null);

  // Jump to low-confidence note
  const jumpToLowConfidence = useCallback(
    (direction: 'next' | 'prev') => {
      if (!state.chartDoc) return;
      const track = state.chartDoc.parsedChart.trackData.find(
        t => t.instrument === 'drums' && t.difficulty === 'expert',
      );
      if (!track || dtState.confidence.size === 0) return;

      const threshold = dtState.confidenceThreshold;
      const currentMs = (audioManagerRef.current?.currentTime ?? 0) * 1000;

      const timedTempos = buildTimedTempos(
        state.chartDoc.parsedChart.tempos,
        state.chartDoc.parsedChart.resolution,
      );
      const resolution = state.chartDoc.parsedChart.resolution;

      const lowConfNotes: {note: DrumNote; ms: number}[] = [];
      for (const note of getDrumNotes(track)) {
        const id = noteId(note);
        const conf = dtState.confidence.get(id);
        if (conf !== undefined && conf < threshold) {
          let tempoIdx = 0;
          for (let i = 1; i < timedTempos.length; i++) {
            if (timedTempos[i].tick <= note.tick) tempoIdx = i;
            else break;
          }
          const tempo = timedTempos[tempoIdx];
          const ms =
            tempo.msTime +
            ((note.tick - tempo.tick) * 60000) /
              (tempo.beatsPerMinute * resolution);
          lowConfNotes.push({note, ms});
        }
      }

      if (lowConfNotes.length === 0) return;
      lowConfNotes.sort((a, b) => a.ms - b.ms);

      let target: {note: DrumNote; ms: number} | undefined;
      if (direction === 'next') {
        target = lowConfNotes.find(n => n.ms > currentMs + 50);
        if (!target) target = lowConfNotes[0];
      } else {
        for (let i = lowConfNotes.length - 1; i >= 0; i--) {
          if (lowConfNotes[i].ms < currentMs - 50) {
            target = lowConfNotes[i];
            break;
          }
        }
        if (!target) target = lowConfNotes[lowConfNotes.length - 1];
      }

      if (target) {
        const am = audioManagerRef.current;
        if (am) {
          am.play({time: target.ms / 1000});
        }
        dispatch({
          type: 'SET_SELECTION',
          kind: 'note',
          ids: new Set([noteId(target.note)]),
        });
      }
    },
    [
      state.chartDoc,
      dtState.confidence,
      dtState.confidenceThreshold,
      audioManagerRef,
      dispatch,
    ],
  );

  // Callback for when notes are modified (mark reviewed)
  const handleNotesModified = useCallback(
    (noteIds: string[]) => {
      dtDispatch({type: 'MARK_REVIEWED', noteIds});
    },
    [dtDispatch],
  );

  // Register shared editor keyboard shortcuts
  useEditorKeyboard(save, handleNotesModified);

  // -----------------------------------------------------------------------
  // Drum-transcription-specific keyboard shortcuts via useHotkey
  // -----------------------------------------------------------------------

  // Enter - confirm/review selected notes
  useHotkey(
    'Enter',
    () => {
      const selected = getSelectedIds(state, 'note');
      if (selected.size > 0) {
        dtDispatch({
          type: 'MARK_REVIEWED',
          noteIds: Array.from(selected),
        });
      }
    },
    {enabled: getSelectedIds(state, 'note').size > 0},
  );

  // N - jump to next low-confidence note
  useHotkey('N', () => {
    jumpToLowConfidence('next');
  });

  // Shift+N - jump to previous low-confidence note
  useHotkey('Shift+N', () => {
    jumpToLowConfidence('prev');
  });

  // D - toggle drums solo
  useHotkey('D', () => {
    dispatch({
      type: 'SET_SOLO_TRACK',
      track: state.soloTrack === 'drums' ? null : 'drums',
    });
  });

  // M - toggle mute drums
  useHotkey('M', () => {
    dispatch({type: 'TOGGLE_MUTE_TRACK', track: 'drums'});
  });

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
        const parsed = parseChartFile(chartBytes, 'chart', PRO_DRUMS_MODIFIERS);

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

        // 5. Build editable ChartDocument from chart bytes. Force pro_drums
        // so the chartDoc parses with the same interpretation we validated
        // with PRO_DRUMS_MODIFIERS just above; otherwise edits run against
        // a different interpretation than the validation pass.
        const chartDoc = readChart(
          [{fileName: 'notes.chart', data: chartBytes}],
          {pro_drums: true},
        );

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
            dtDispatch({type: 'SET_CONFIDENCE', confidence: confMap});
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
            dtDispatch({
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

        audioManager.setChartDelay(
          getChartDelayMs(chartDoc.parsedChart.metadata) / 1000,
        );
        audioManagerRef.current = audioManager;
        setAudioManager(audioManager);

        // 11. Update editor state. ChartDoc carries the parsed chart;
        // consumers derive the active track via selectActiveTrack().
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
      audioManagerRef.current?.destroy();
      audioManagerRef.current = null;
      setAudioManager(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Build a minimal metadata object for CloneHeroRenderer.
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

  // Provide chart text for export
  const getChartText = useCallback(async (): Promise<string> => {
    let chartText: string;
    const hasEdited = await projectFileExists(projectId, 'notes.edited.chart');
    if (hasEdited) {
      chartText = await readProjectText(projectId, 'notes.edited.chart');
    } else {
      chartText = await readProjectText(projectId, 'notes.chart');
    }
    return chartText;
  }, [projectId]);

  // Provide audio sources for export
  const getAudioSources = useCallback(async (): Promise<AudioSource[]> => {
    const sources: AudioSource[] = [];
    const aMeta = audioMeta;
    if (!aMeta) return sources;

    const {encodeWav} = await import(
      '@/lib/drum-transcription/audio/wav-encoder'
    );

    // Drum stem
    try {
      const {readProjectBinary} = await import(
        '@/lib/drum-transcription/storage/opfs'
      );
      const drumsPcmBuffer = await readProjectBinary(projectId, 'drums.pcm');
      const drumsPcm = new Float32Array(drumsPcmBuffer);
      const drumsWav = encodeWav(drumsPcm, aMeta.sampleRate, aMeta.channels);
      sources.push({fileName: 'drums.wav', data: drumsWav});
    } catch {
      // No drums stem
    }

    // Accompaniment (mix bass+other+vocals, or fall back to full mix)
    try {
      const {readProjectBinary} = await import(
        '@/lib/drum-transcription/storage/opfs'
      );
      const stemNames = ['bass', 'other', 'vocals'];
      const stemBuffers: Float32Array[] = [];

      for (const stemName of stemNames) {
        try {
          const buffer = await readProjectBinary(projectId, `${stemName}.pcm`);
          stemBuffers.push(new Float32Array(buffer));
        } catch {
          // Stem not available
        }
      }

      if (stemBuffers.length > 0) {
        const maxLength = Math.max(...stemBuffers.map(b => b.length));
        const mixed = new Float32Array(maxLength);
        for (const stem of stemBuffers) {
          for (let i = 0; i < stem.length; i++) {
            mixed[i] += stem[i];
          }
        }
        for (let i = 0; i < mixed.length; i++) {
          mixed[i] = Math.max(-1, Math.min(1, mixed[i]));
        }
        const songWav = encodeWav(mixed, aMeta.sampleRate, aMeta.channels);
        sources.push({fileName: 'song.wav', data: songWav});
      } else {
        const fullPcmBuffer = await readProjectBinary(projectId, 'full.pcm');
        const fullPcm = new Float32Array(fullPcmBuffer);
        const songWav = encodeWav(fullPcm, aMeta.sampleRate, aMeta.channels);
        sources.push({fileName: 'song.wav', data: songWav});
      }
    } catch {
      // Can't create accompaniment
    }

    return sources;
  }, [projectId, audioMeta]);

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

  const chart = state.chartDoc?.parsedChart ?? null;
  if (!chart || !audioManager || !cloneHeroMetadata) {
    return null;
  }

  return (
    <ChartEditor
      metadata={cloneHeroMetadata}
      chart={chart}
      audioManager={audioManager}
      audioData={audioPcm ?? undefined}
      audioChannels={audioChannels}
      durationSeconds={durationSeconds}
      sections={chart.sections}
      songName={projectMeta?.name ?? 'Untitled'}
      dirty={state.dirty}
      getChartText={getChartText}
      getAudioSources={getAudioSources}
      onNotesModified={handleNotesModified}
      confidence={dtState.confidence}
      showConfidence={dtState.showConfidence}
      confidenceThreshold={dtState.confidenceThreshold}
      reviewedNoteIds={dtState.reviewedNoteIds}
      leftPanelChildren={
        <>
          <ConfidencePanel />
          <StemVolumeControls audioManager={audioManager} />
        </>
      }
    />
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
