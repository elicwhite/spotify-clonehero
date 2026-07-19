'use client';

import {useCallback, useEffect, useMemo, useState} from 'react';
import {Loader2, AlertCircle, RefreshCw} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
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

import {AudioManager} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import {
  getProject,
  readProjectText,
  readProjectBinary,
  writeProjectBinary,
  readProjectJSON,
  projectFileExists,
  findProjectChartFile,
  editedVariant,
  updateProject,
  loadAudioMeta,
  readOriginalAudio,
  readProjectAssets,
  readPackageInfo,
  type ProjectMetadata,
  type AudioStorageMeta,
} from '@/lib/drum-transcription/storage/opfs';
import {SYNCTRACK_FILE} from '@/lib/drum-transcription/pipeline/runner';
import {loadDecodedOnsets} from '@/lib/drum-transcription/pipeline/decoded-onsets';
import type {DecodedOnsetsFile} from '@/lib/drum-transcription/ml/types';
import {loadDrumStem} from '@/lib/drum-transcription/ml/roformer-separation';
import type {StoredSynctrack} from '@/lib/drum-transcription/pipeline/chart-builder';
import {computeSongConfidence} from '@/lib/drum-transcription/confidence-gauge';
import ConfidenceGauge from './ConfidenceGauge';
import {encodeWavBlob} from '@/lib/audio/wav-encoder';
import {encodePcmToOpus} from '@/lib/audio/opus-encoder';
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
import {cn} from '@/lib/utils';

type LoadingState = 'loading' | 'ready' | 'error';

interface EditorAppProps {
  projectId: string;
  /**
   * Re-run the beat grid + predicted notes for this project (using the
   * cached separated stem). Invoked after the user confirms the destructive
   * warning; the parent owns the pipeline run and remounts the editor.
   * Omit to hide the Regenerate button.
   */
  onRegenerate?: (() => void) | undefined;
}

/**
 * Top-level editor layout for drum-transcription.
 *
 * Loads chart + audio from OPFS, creates AudioManager, and wraps
 * DrumTranscriptionProvider around the shared ChartEditor shell.
 * Passes ConfidencePanel and StemVolumeControls as leftPanelChildren.
 */
export default function EditorApp({projectId, onRegenerate}: EditorAppProps) {
  return (
    <DrumTranscriptionProvider>
      <EditorAppInner projectId={projectId} onRegenerate={onRegenerate} />
    </DrumTranscriptionProvider>
  );
}

function EditorAppInner({projectId, onRegenerate}: EditorAppProps) {
  const {state, dispatch, audioManagerRef} = useChartEditorContext();
  const {dtState, dtDispatch} = useDrumTranscriptionContext();
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [, setLoadingStep] = useState<string>('Loading project metadata...');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [projectMeta, setProjectMeta] = useState<ProjectMetadata | null>(null);
  const [audioMeta, setAudioMeta] = useState<AudioStorageMeta | null>(null);
  const [audioPcm, setAudioPcm] = useState<Float32Array | null>(null);
  // Separated drum stem PCM — the highway's waveform surface shows this
  // instead of the full mix when separation has run.
  const [drumStemPcm, setDrumStemPcm] = useState<Float32Array | null>(null);
  const [audioChannels, setAudioChannels] = useState(2);
  const [durationSeconds, setDurationSeconds] = useState(0);
  // Mirrors audioManagerRef (shared via context for event-handler reads)
  // into render-visible state so ChartEditor and StemVolumeControls
  // receive a stable prop without reading ref.current during render.
  const [audioManager, setAudioManager] = useState<AudioManager | null>(null);
  // F63 confidence gauge input: BPM values from the PREDICTED tempo map, or
  // null when the chart's grid came from an existing chart the user
  // supplied (chart-flow path 3a) rather than a prediction — see
  // lib/drum-transcription/confidence-gauge.ts.
  const [predictedTempoBpms, setPredictedTempoBpms] = useState<
    number[] | null
  >(null);
  // Retained decoded onsets (plan 0061 §3a) for the piano-roll's half/double +
  // tap-tempo RE-PREDICT op. null when this project was never transcribed by
  // this app (the control then falls back to RESNAP with a disclosure).
  const [decodedOnsets, setDecodedOnsets] = useState<DecodedOnsetsFile | null>(
    null,
  );
  // Original package format (chart-flow feature), for preselecting the
  // export dialog's format. null for audio-only projects.
  const [packageSourceFormat, setPackageSourceFormat] = useState<
    'folder' | 'zip' | 'sng' | null
  >(null);
  // Regenerate confirmation dialog + in-flight flag. While regenerating,
  // autosave is disabled so a stale save can't rewrite the edited chart /
  // review progress after the pipeline has deleted them.
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Build the save function for auto-save
  const saveFn = useCallback(async () => {
    if (!state.chartDoc) return;

    const root = await navigator.storage.getDirectory();
    const nsDir = await root.getDirectoryHandle('drum-transcription');
    const projectDir = await nsDir.getDirectoryHandle(projectId);

    // Save edited chart, in whichever format the project's chart uses
    // (notes.edited.chart or notes.edited.mid) — never force one onto the
    // other. Raw bytes are written directly; text-decoding-then-encoding a
    // .mid chart would corrupt it.
    const files = writeChartFolder(state.chartDoc);
    const chartFileOut = files.find(
      f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
    );
    if (!chartFileOut) {
      throw new Error('writeChartFolder did not produce a chart file');
    }
    const chartFile = await projectDir.getFileHandle(
      editedVariant(chartFileOut.fileName),
      {create: true},
    );
    const chartWritable = await chartFile.createWritable();
    // See opfs.ts writeProjectBinary: our chart bytes are always a
    // plain-ArrayBuffer view, never SharedArrayBuffer-backed.
    await chartWritable.write(chartFileOut.data as Uint8Array<ArrayBuffer>);
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
  const {save} = useAutoSave(
    loadingState === 'ready' && !regenerating ? saveFn : null,
  );

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

        // 2. Load chart - prefer edited version, fall back to generated.
        // Format-agnostic: the project's persisted chart file is whichever
        // of notes.(edited.)chart / notes.(edited.)mid the source chart
        // used (findProjectChartFile prefers the edited variant). Read as
        // raw bytes — text-decoding a .mid file would corrupt it.
        setLoadingStep('Loading chart data...');
        const chartFileName = await findProjectChartFile(projectId);
        if (!chartFileName) {
          throw new Error('Project has no persisted chart file');
        }
        const chartBuf = await readProjectBinary(projectId, chartFileName);
        const chartBytes = new Uint8Array(chartBuf);
        if (cancelled) return;

        // 3. Build editable ChartDocument from chart bytes. Force pro_drums
        // — the editor is drum-only and pro-drums tom/cymbal modifiers are
        // meaningful regardless of any upstream song.ini. readChart detects
        // .chart vs .mid from chartFileName.
        const chartDoc = readChart(
          [{fileName: chartFileName, data: chartBytes}],
          {pro_drums: true},
        );

        // 4. Find expert drums track
        const drumTrack = chartDoc.parsedChart.trackData.find(
          t => t.instrument === 'drums' && t.difficulty === 'expert',
        );
        if (!drumTrack) {
          throw new Error(
            'No Expert Drums track found in chart. Available tracks: ' +
              chartDoc.parsedChart.trackData
                .map(t => `${t.instrument}/${t.difficulty}`)
                .join(', '),
          );
        }

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

        // 6a. Load retained decoded onsets (plan 0061 §3a). Present for any
        // project the ML transcriber ran on; null for a never-transcribed
        // (hand-authored/imported) chart, which makes the piano-roll's
        // half/double control fall back to RESNAP with a disclosure.
        try {
          const onsets = await loadDecodedOnsets(projectId);
          if (cancelled) return;
          setDecodedOnsets(onsets);
        } catch (err) {
          console.warn('Failed to load decoded onsets:', err);
        }

        // 6b. Load the predicted tempo map's BPM values for the F63
        // confidence gauge (chart-flow projects have no synctrack.json —
        // their grid came from the user's own chart, not a prediction).
        try {
          const hasSynctrack = await projectFileExists(
            projectId,
            SYNCTRACK_FILE,
          );
          if (hasSynctrack) {
            const stored = await readProjectJSON<StoredSynctrack>(
              projectId,
              SYNCTRACK_FILE,
            );
            setPredictedTempoBpms(
              stored.synctrack.tempos.map(t => t.bpm),
            );
          }
        } catch (err) {
          console.warn('Failed to load synctrack for confidence gauge:', err);
        }

        // 6c. Load original package format (chart-flow feature), to
        // preselect the export dialog's format. Absent for audio-only
        // projects.
        try {
          const info = await readPackageInfo(projectId);
          if (info) setPackageSourceFormat(info.sourceFormat);
        } catch (err) {
          console.warn('Failed to load package info:', err);
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

        // Load the separated drum stem (fingerprint cache, with legacy
        // per-project fallback) if separation has run.
        setLoadingStep('Loading stems...');
        try {
          const stemPcm = await loadDrumStem(projectId);
          if (cancelled) return;
          setDrumStemPcm(stemPcm);
          const stemWav = encodeWavBlob(
            stemPcm,
            aMeta.sampleRate,
            aMeta.channels,
          );
          const stemArray = new Uint8Array(await stemWav.arrayBuffer());
          audioFiles.push({fileName: 'drums.wav', data: stemArray});
        } catch {
          // Stem not available, skip
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

  // Persist edited song/artist/charter from the header dialog. Updates the
  // chart doc metadata (saved into the edited chart file's [Song] section,
  // notes.edited.chart or notes.edited.mid) and renames the project to
  // "Song by Artist" so the projects list reflects it.
  const handleMetadataChange = useCallback(
    async ({
      name,
      artist,
      charter,
    }: {
      name: string;
      artist: string;
      charter: string;
    }) => {
      if (!state.chartDoc) return;

      const updatedDoc = {
        ...state.chartDoc,
        parsedChart: {
          ...state.chartDoc.parsedChart,
          metadata: {
            ...state.chartDoc.parsedChart.metadata,
            name,
            artist,
            charter,
          },
        },
      };
      dispatch({type: 'SET_CHART_DOC', chartDoc: updatedDoc});

      // Persist the chart (metadata rides along in the [Song] section),
      // in whichever format this project's chart uses.
      const files = writeChartFolder(updatedDoc);
      const chartFileOut = files.find(
        f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
      );
      if (!chartFileOut) {
        throw new Error('writeChartFolder did not produce a chart file');
      }
      await writeProjectBinary(
        projectId,
        editedVariant(chartFileOut.fileName),
        chartFileOut.data,
      );

      // Rename the project — "Song by Artist" (charter is not included).
      const projectName = artist.trim() ? `${name} by ${artist}` : name;
      const updated = await updateProject(projectId, {name: projectName});
      setProjectMeta(updated);

      toast.success('Song details saved');
    },
    [projectId, state.chartDoc, dispatch],
  );

  // Provide the chart file for export, in whichever format this project's
  // chart uses (notes.chart text or notes.mid binary) — format-agnostic, so
  // a .mid-sourced chart-flow project exports without corruption.
  const getChartFile = useCallback(async (): Promise<{
    fileName: string;
    data: Uint8Array;
  }> => {
    const fileName = await findProjectChartFile(projectId);
    if (!fileName) throw new Error('Project has no persisted chart file');
    const buf = await readProjectBinary(projectId, fileName);
    return {fileName, data: new Uint8Array(buf)};
  }, [projectId]);

  // Provide audio sources for export.
  //
  // Stems live in the project's `stems/` subdirectory and the full mix in
  // `audio/full.pcm` — the same handles the loader uses above.
  //
  // `includeStems` (from the export dialog) selects between:
  //   true  → separated drums.opus + accompaniment song.opus, Opus-encoded
  //           from the stem PCM via WebCodecs.
  //   false → the user's original uploaded file, byte-for-byte, as song.<ext>.
  const getAudioSources = useCallback(
    async ({includeStems}: {includeStems: boolean}): Promise<AudioSource[]> => {
      const sources: AudioSource[] = [];
      const aMeta = audioMeta;
      if (!aMeta) return sources;

      const toOpus = (pcm: Float32Array): Promise<Uint8Array> =>
        encodePcmToOpus(pcm, aMeta.sampleRate, aMeta.channels);

      const readFullMix = async (): Promise<Float32Array | null> => {
        try {
          const audioDir = await getAudioDir(projectId);
          const handle = await audioDir.getFileHandle('full.pcm');
          const file = await handle.getFile();
          return new Float32Array(await file.arrayBuffer());
        } catch {
          return null;
        }
      };

      // Original audio: the uploaded file, unmodified, named song.<ext>.
      if (!includeStems) {
        const original = await readOriginalAudio(projectId);
        if (original) {
          const ext = original.extension || 'mp3';
          sources.push({fileName: `song.${ext}`, data: original.data});
          return sources;
        }
        // Older projects have no stored original: fall back to Opus full mix.
        const fullPcm = await readFullMix();
        if (fullPcm) {
          const opus = await toOpus(fullPcm);
          sources.push({
            fileName: 'song.opus',
            data: opus.buffer as ArrayBuffer,
          });
        }
        return sources;
      }

      // Drum stem → drums.opus (fingerprint cache, legacy fallback).
      let drumsPcm: Float32Array | null = null;
      try {
        drumsPcm = await loadDrumStem(projectId);
      } catch {
        drumsPcm = null;
      }
      if (drumsPcm) {
        const opus = await toOpus(drumsPcm);
        sources.push({
          fileName: 'drums.opus',
          data: opus.buffer as ArrayBuffer,
        });
      }

      // Accompaniment: only the drum stem is ever separated, so this is
      // always the full mix.
      const accompaniment = await readFullMix();
      if (accompaniment) {
        const opus = await toOpus(accompaniment);
        sources.push({
          fileName: 'song.opus',
          data: opus.buffer as ArrayBuffer,
        });
      }

      return sources;
    },
    [projectId, audioMeta],
  );

  // Passthrough assets from an existing chart package (chart-flow feature),
  // for export round-tripping. Returns [] for audio-only projects.
  const getExtraAssets = useCallback(async () => {
    return readProjectAssets(projectId);
  }, [projectId]);

  // F63 confidence gauge: fraction of low-confidence model frames (always
  // available) + predicted-tempo instability (null for the chart-flow path,
  // whose grid came from the user's own chart, not a prediction).
  const songConfidence = useMemo(
    () => computeSongConfidence(dtState.confidence.values(), predictedTempoBpms),
    [dtState.confidence, predictedTempoBpms],
  );
  const gridIsProvided = projectMeta?.gridSource === 'provided';

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
      highwayAudioData={drumStemPcm ?? undefined}
      audioChannels={audioChannels}
      durationSeconds={durationSeconds}
      decodedOnsets={decodedOnsets}
      sections={chart.sections}
      songName={chart.metadata.name || projectMeta?.name || 'Untitled'}
      artistName={chart.metadata.artist || undefined}
      charterName={chart.metadata.charter || undefined}
      onMetadataChange={handleMetadataChange}
      dirty={state.dirty}
      getChartFile={getChartFile}
      getAudioSources={getAudioSources}
      showStemChoice
      getExtraAssets={getExtraAssets}
      defaultExportFormat={
        packageSourceFormat === 'sng' ? 'sng' : packageSourceFormat ? 'zip' : undefined
      }
      onNotesModified={handleNotesModified}
      reviewedNoteIds={dtState.reviewedNoteIds}
      leftPanelChildren={
        <>
          {onRegenerate && !gridIsProvided && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                disabled={regenerating}
                onClick={() => setConfirmRegenerate(true)}>
                <RefreshCw
                  className={cn('h-4 w-4', regenerating && 'animate-spin')}
                />
                Regenerate
              </Button>
              <AlertDialog
                open={confirmRegenerate}
                onOpenChange={setConfirmRegenerate}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerate chart?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This re-runs the beat grid and predicted notes from the
                      cached audio. All note edits and review progress for
                      this project will be discarded.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        setConfirmRegenerate(false);
                        setRegenerating(true);
                        onRegenerate();
                      }}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Regenerate
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          <ConfidenceGauge
            confidence={songConfidence}
            gridIsProvided={gridIsProvided}
          />
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

