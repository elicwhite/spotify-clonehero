'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
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
  readProjectBinary,
  writeProjectBinary,
  findProjectChartFile,
  editedVariant,
  updateProject,
  loadAudioMeta,
  loadFullMixPcm,
  readSongOpus,
  readOriginalAudio,
  readProjectAssets,
  readPackageInfo,
  type ProjectMetadata,
  type AudioStorageMeta,
} from '@/lib/drum-transcription/storage/opfs';
import {loadDecodedOnsets} from '@/lib/drum-transcription/pipeline/decoded-onsets';
import type {DecodedOnsetsFile} from '@/lib/drum-transcription/ml/types';
import {
  loadDrumStem,
  hasVocalsStem,
  loadVocalsStem,
} from '@/lib/drum-transcription/ml/roformer-separation';
import {
  decodeAudio,
  interleaveAudioBuffer,
} from '@/lib/drum-transcription/audio/decoder';
import {padPcmStart} from '@/lib/drum-transcription/audio/pad-pcm';
import {encodeWavBlob} from '@/lib/audio/wav-encoder';
import {encodePcmToOpus} from '@/lib/audio/opus-encoder';
import {
  readChart,
  writeChartFolder,
  getAudioAnchor,
  setAudioAnchor,
} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {useHotkey} from '@tanstack/react-hotkeys';
import {useChartEditorContext} from '@/components/chart-editor/ChartEditorContext';
import {useEditorKeyboard} from '@/components/chart-editor/hooks/useEditorKeyboard';
import {useAutoSave} from '@/components/chart-editor/hooks/useAutoSave';
import ChartEditor from '@/components/chart-editor/ChartEditor';
import type {AudioSource} from '@/components/chart-editor/ExportDialog';
import AddLyricsDialog from '@/components/chart-editor/AddLyricsDialog';
import StemVolumeControls from './StemVolumeControls';
import LeadingSilenceButton from './LeadingSilenceButton';
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
 * Build (or rebuild) an AudioManager from ORIGINAL (unpadded) PCM buffers and
 * a pad-sample count (0064 addendum §5). Pads the full mix + drum stem PCM,
 * WAV-encodes them, and constructs a fresh AudioManager. Used both at project
 * load and whenever the chart's `audioAnchor` changes at runtime.
 */
async function buildPaddedAudioManager(
  padSamples: number,
  aMeta: AudioStorageMeta,
  fullMixPcm: Float32Array,
  drumStemPcm: Float32Array | null,
  chartDoc: ChartDocument,
  onSongEnded: () => void,
): Promise<{
  audioManager: AudioManager;
  paddedFullMixPcm: Float32Array;
  paddedDrumStemPcm: Float32Array | null;
}> {
  const paddedFullMixPcm = padPcmStart(fullMixPcm, padSamples, aMeta.channels);
  const fullMixWav = encodeWavBlob(
    paddedFullMixPcm,
    aMeta.sampleRate,
    aMeta.channels,
  );
  const fullMixArray = new Uint8Array(await fullMixWav.arrayBuffer());
  const audioFiles: {fileName: string; data: Uint8Array}[] = [
    {fileName: 'song.wav', data: fullMixArray},
  ];

  let paddedDrumStemPcm: Float32Array | null = null;
  if (drumStemPcm) {
    paddedDrumStemPcm = padPcmStart(drumStemPcm, padSamples, aMeta.channels);
    const stemWav = encodeWavBlob(
      paddedDrumStemPcm,
      aMeta.sampleRate,
      aMeta.channels,
    );
    const stemArray = new Uint8Array(await stemWav.arrayBuffer());
    audioFiles.push({fileName: 'drums.wav', data: stemArray});
  }

  const audioManager = new AudioManager(audioFiles, onSongEnded);
  await audioManager.ready;
  audioManager.setChartDelay(
    getChartDelayMs(chartDoc.parsedChart.metadata) / 1000,
  );

  return {audioManager, paddedFullMixPcm, paddedDrumStemPcm};
}

/** Sample-quantized pad amount for `anchor`, or 0 when there is none. */
function anchorPadSamples(
  anchor: {ms: number} | null,
  sampleRate: number,
): number {
  if (!anchor || anchor.ms <= 0) return 0;
  return Math.round((anchor.ms * sampleRate) / 1000);
}

/**
 * Top-level editor layout for drum-transcription.
 *
 * Loads chart + audio from OPFS, creates AudioManager, and renders the
 * shared ChartEditor shell. Passes StemVolumeControls as leftPanelChildren.
 */
export default function EditorApp({projectId, onRegenerate}: EditorAppProps) {
  const {state, dispatch, audioManagerRef} = useChartEditorContext();
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [, setLoadingStep] = useState<string>('Loading project metadata...');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [projectMeta, setProjectMeta] = useState<ProjectMetadata | null>(null);
  const [audioMeta, setAudioMeta] = useState<AudioStorageMeta | null>(null);
  const [audioPcm, setAudioPcm] = useState<Float32Array | null>(null);
  // Separated drum stem PCM — the highway's waveform surface shows this
  // instead of the full mix when separation has run.
  const [drumStemPcm, setDrumStemPcm] = useState<Float32Array | null>(null);
  // Separated vocals stem PCM (plan 0063 Round 2 §5) — background waveform
  // in the piano-roll's lyrics row. null when no vocals stem is cached yet
  // (legacy projects, or projects that haven't run Add Lyrics/separation).
  const [vocalsStemPcm, setVocalsStemPcm] = useState<Float32Array | null>(null);
  const [audioChannels, setAudioChannels] = useState(2);
  const [durationSeconds, setDurationSeconds] = useState(0);
  // Mirrors audioManagerRef (shared via context for event-handler reads)
  // into render-visible state so ChartEditor and StemVolumeControls
  // receive a stable prop without reading ref.current during render.
  const [audioManager, setAudioManager] = useState<AudioManager | null>(null);
  // Retained decoded onsets (plan 0061 §3a) for the piano-roll's half/double
  // RE-PREDICT op. null when this project was never transcribed by this app
  // (the control then falls back to RESNAP with a disclosure).
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
  // True while the AudioManager is being rebuilt after the chart's
  // `audioAnchor` changed (leading-silence apply/undo/redo, or a grid-glue
  // tempo edit near the start) — 0064 addendum §5/§3.
  const [audioRebuilding, setAudioRebuilding] = useState(false);

  // ORIGINAL (unpadded) decoded PCM, retained across the session so the
  // anchor-change effect can re-pad from source rather than compounding
  // padding on top of a previously-padded buffer.
  const originalFullMixPcmRef = useRef<Float32Array | null>(null);
  const originalDrumStemPcmRef = useRef<Float32Array | null>(null);
  const originalVocalsStemPcmRef = useRef<Float32Array | null>(null);
  // Pad-sample count the CURRENT audioManager/audioPcm/drumStemPcm state was
  // built with — compared against the doc's live anchor to detect drift.
  const padSamplesRef = useRef(0);
  // Guards overlapping anchor-change rebuilds (rapid undo/redo).
  const rebuildTokenRef = useRef(0);

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

    // Mirror the doc's audio anchor into project metadata (0064 addendum
    // §1) so a reload re-derives the same padded audio. Cheap and
    // idempotent — runs on every autosave.
    await updateProject(projectId, {
      audioAnchor: getAudioAnchor(state.chartDoc) ?? null,
    });
  }, [projectId, state.chartDoc]);

  // Auto-save hook (uses shared hook, passes the save function)
  const {save} = useAutoSave(
    loadingState === 'ready' && !regenerating ? saveFn : null,
  );

  // Register shared editor keyboard shortcuts
  useEditorKeyboard(save);

  // -----------------------------------------------------------------------
  // Drum-transcription-specific keyboard shortcuts via useHotkey
  // -----------------------------------------------------------------------

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

  // Decode the cached vocals stem (Round 2 §5) into PCM for the piano-roll
  // lyrics row's background waveform, padded to match the current audio
  // anchor. Called at project load AND again after the Add Lyrics dialog
  // runs separation, so a stem produced mid-session shows up without a
  // reload. No-op when no vocals stem is cached (legacy projects that
  // haven't separated yet). `padSamples` defaults to the currently-built
  // audio's pad amount (`padSamplesRef.current`) so a mid-session refresh
  // (post Add-Lyrics) stays consistent with the live AudioManager.
  const refreshVocalsStem = useCallback(
    async (padSamples?: number) => {
      try {
        if (!(await hasVocalsStem(projectId))) return;
        const vocalsOpus = await loadVocalsStem(projectId);
        // Cached stem bytes are always a plain-ArrayBuffer view, never
        // SharedArrayBuffer-backed (mirrors the same cast in `saveFn`).
        const vocalsBuffer = await new Blob([
          vocalsOpus as Uint8Array<ArrayBuffer>,
        ]).arrayBuffer();
        const decoded = await decodeAudio(vocalsBuffer);
        // interleaveAudioBuffer always emits TARGET_CHANNELS (2) — pad by
        // that, not the source AudioBuffer's (possibly mono) channel count.
        const pcm = interleaveAudioBuffer(decoded);
        originalVocalsStemPcmRef.current = pcm;
        const pad = padSamples ?? padSamplesRef.current;
        setVocalsStemPcm(padPcmStart(pcm, pad, 2));
      } catch (err) {
        console.warn('Failed to load vocals stem for waveform:', err);
      }
    },
    [projectId],
  );

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
        let chartDoc = readChart(
          [{fileName: chartFileName, data: chartBytes}],
          {pro_drums: true},
        );

        // 3a. Re-attach the persisted audio anchor (0064 addendum §1), if
        // any, before this doc is ever dispatched. Absent/undefined ⇒ no
        // padding, current behavior.
        const persistedAnchor = meta.audioAnchor ?? null;
        if (persistedAnchor) {
          chartDoc = setAudioAnchor(chartDoc, persistedAnchor);
        }

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

        // 6c. Load original package format (chart-flow feature), to
        // preselect the export dialog's format. Absent for audio-only
        // projects.
        try {
          const info = await readPackageInfo(projectId);
          if (info) setPackageSourceFormat(info.sourceFormat);
        } catch (err) {
          console.warn('Failed to load package info:', err);
        }

        // 8. Load audio metadata
        const aMeta = await loadAudioMeta(projectId);
        if (cancelled) return;
        setAudioMeta(aMeta);

        const padSamples = anchorPadSamples(persistedAnchor, aMeta.sampleRate);
        padSamplesRef.current = padSamples;
        setDurationSeconds(
          (aMeta.durationMs + (persistedAnchor?.ms ?? 0)) / 1000,
        );

        // 9. Load the full mix as PCM for waveform visualization (decodes
        // song.opus in memory for current projects; reads full.pcm directly
        // for legacy ones). This is the ORIGINAL (unpadded) audio — the
        // stored audio at rest is never touched (0064 addendum §5).
        const pcmData = await loadFullMixPcm(projectId);
        if (cancelled) return;
        originalFullMixPcmRef.current = pcmData;
        setAudioChannels(aMeta.channels);

        // Load the separated drum stem (fingerprint cache, with legacy
        // per-project fallback) if separation has run.
        setLoadingStep('Loading stems...');
        let originalDrumStemPcm: Float32Array | null = null;
        try {
          originalDrumStemPcm = await loadDrumStem(projectId);
          if (cancelled) return;
        } catch {
          // Stem not available, skip
        }
        originalDrumStemPcmRef.current = originalDrumStemPcm;

        // Load the separated vocals stem (Round 2 §5), for the piano-roll
        // lyrics row's background waveform only — not registered with
        // AudioManager (it's not a playback source). Opportunistic: absent
        // on legacy projects, or ones that haven't run separation/Add Lyrics.
        await refreshVocalsStem(padSamples);
        if (cancelled) return;

        // 10. Create AudioManager from the (padded) audio files.
        setLoadingStep('Preparing audio...');
        const {
          audioManager: newAudioManager,
          paddedFullMixPcm,
          paddedDrumStemPcm,
        } = await buildPaddedAudioManager(
          padSamples,
          aMeta,
          pcmData,
          originalDrumStemPcm,
          chartDoc,
          () => dispatch({type: 'SET_PLAYING', isPlaying: false}),
        );
        if (cancelled) {
          newAudioManager.destroy();
          return;
        }

        setAudioPcm(paddedFullMixPcm);
        if (paddedDrumStemPcm) setDrumStemPcm(paddedDrumStemPcm);

        audioManagerRef.current = newAudioManager;
        setAudioManager(newAudioManager);

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

  // Rebuild the AudioManager (and padded waveform PCM) whenever the chart's
  // `audioAnchor` changes at runtime — the leading-silence button's apply,
  // its undo/redo, or a grid-glue tempo edit near the start (0064 addendum
  // §3/§5). Compares against `padSamplesRef.current` (the pad amount the
  // CURRENT AudioManager was built with) so this only fires on an actual
  // change, never on unrelated chart edits.
  useEffect(() => {
    if (loadingState !== 'ready') return;
    if (!state.chartDoc || !audioMeta) return;
    if (!originalFullMixPcmRef.current) return;

    const anchor = getAudioAnchor(state.chartDoc);
    const nextPadSamples = anchorPadSamples(anchor, audioMeta.sampleRate);
    if (nextPadSamples === padSamplesRef.current) return;

    let cancelled = false;
    const token = ++rebuildTokenRef.current;
    const chartDocForRebuild = state.chartDoc;
    const aMeta = audioMeta;

    (async () => {
      setAudioRebuilding(true);
      try {
        const oldManager = audioManagerRef.current;
        const wasPlaying = oldManager?.isPlaying ?? false;
        const chartTimePos = oldManager?.chartTime ?? 0;
        if (oldManager) await oldManager.pause();

        const {
          audioManager: newManager,
          paddedFullMixPcm,
          paddedDrumStemPcm,
        } = await buildPaddedAudioManager(
          nextPadSamples,
          aMeta,
          originalFullMixPcmRef.current!,
          originalDrumStemPcmRef.current,
          chartDocForRebuild,
          () => dispatch({type: 'SET_PLAYING', isPlaying: false}),
        );

        if (cancelled || token !== rebuildTokenRef.current) {
          newManager.destroy();
          return;
        }

        audioManagerRef.current = newManager;
        setAudioManager(newManager);
        setAudioPcm(paddedFullMixPcm);
        if (paddedDrumStemPcm) setDrumStemPcm(paddedDrumStemPcm);
        if (originalVocalsStemPcmRef.current) {
          // Vocals PCM is always TARGET_CHANNELS (2) interleaved (see
          // refreshVocalsStem) regardless of the full-mix channel count.
          setVocalsStemPcm(
            padPcmStart(originalVocalsStemPcmRef.current, nextPadSamples, 2),
          );
        }
        setDurationSeconds(newManager.duration);
        padSamplesRef.current = nextPadSamples;

        await newManager.seekToChartTime(chartTimePos);
        if (wasPlaying) await newManager.resume();

        oldManager?.destroy();
      } catch (err) {
        console.error(
          'Failed to rebuild audio after leading-silence change:',
          err,
        );
        toast.error('Failed to update audio for the leading-silence change');
      } finally {
        if (!cancelled) setAudioRebuilding(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.chartDoc, audioMeta, loadingState]);

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
  // Stems live in the fingerprint-keyed stem cache; the full mix is
  // `audio/song.opus` (current projects) or `audio/full.pcm` (legacy).
  //
  // `includeStems` (from the export dialog) selects between:
  //   true  → separated drums.opus + accompaniment song.opus, Opus-encoded
  //           from the stem PCM via WebCodecs.
  //   false → the user's original uploaded file, byte-for-byte, as song.<ext>
  //           (song.opus verbatim for current projects).
  //
  // When the chart carries an `audioAnchor` (leading silence applied, 0064
  // addendum §6), every returned source is padded so the exported audio
  // matches the chart's shifted note timing — the verbatim/passthrough
  // shortcuts above are only valid when there's no anchor. The stored audio
  // at rest (song.opus, stem cache) is never modified; padding happens on a
  // decoded copy at export time.
  const getAudioSources = useCallback(
    async ({includeStems}: {includeStems: boolean}): Promise<AudioSource[]> => {
      const sources: AudioSource[] = [];
      const aMeta = audioMeta;
      if (!aMeta) return sources;

      const anchor = state.chartDoc ? getAudioAnchor(state.chartDoc) : null;
      const padSamples = anchorPadSamples(anchor, aMeta.sampleRate);

      const toOpus = (pcm: Float32Array): Promise<Uint8Array> =>
        encodePcmToOpus(pcm, aMeta.sampleRate, aMeta.channels);

      // Current projects store the full mix pre-encoded as Opus — reuse it
      // verbatim rather than decoding + re-encoding. Only valid when there's
      // no anchor (verbatim bytes can't reflect a pad).
      const songOpus = padSamples > 0 ? null : await readSongOpus(projectId);

      const readFullMixPcm = async (): Promise<Float32Array | null> => {
        try {
          return await loadFullMixPcm(projectId);
        } catch {
          return null;
        }
      };

      // Original audio: the uploaded file, unmodified, named song.<ext> — or,
      // when padded, the decoded+padded mix re-encoded as song.opus (the
      // bytes are no longer the original file, so the verbatim name doesn't
      // apply).
      if (!includeStems) {
        if (songOpus) {
          sources.push({fileName: 'song.opus', data: songOpus});
          return sources;
        }
        if (padSamples > 0) {
          let pcm = await readFullMixPcm();
          if (!pcm) {
            const original = await readOriginalAudio(projectId);
            if (original) {
              const decoded = await decodeAudio(original.data);
              pcm = interleaveAudioBuffer(decoded);
            }
          }
          if (pcm) {
            const padded = padPcmStart(pcm, padSamples, aMeta.channels);
            const opus = await toOpus(padded);
            sources.push({
              fileName: 'song.opus',
              data: opus.buffer as ArrayBuffer,
            });
          }
          return sources;
        }
        const original = await readOriginalAudio(projectId);
        if (original) {
          const ext = original.extension || 'mp3';
          sources.push({fileName: `song.${ext}`, data: original.data});
          return sources;
        }
        // Older projects have no stored original: fall back to Opus full mix.
        const fullPcm = await readFullMixPcm();
        if (fullPcm) {
          const opus = await toOpus(fullPcm);
          sources.push({
            fileName: 'song.opus',
            data: opus.buffer as ArrayBuffer,
          });
        }
        return sources;
      }

      // Drum stem → drums.opus (fingerprint cache, legacy fallback), padded
      // to match the anchor.
      let drumsPcm: Float32Array | null = null;
      try {
        drumsPcm = await loadDrumStem(projectId);
      } catch {
        drumsPcm = null;
      }
      if (drumsPcm) {
        if (padSamples > 0) {
          drumsPcm = padPcmStart(drumsPcm, padSamples, aMeta.channels);
        }
        const opus = await toOpus(drumsPcm);
        sources.push({
          fileName: 'drums.opus',
          data: opus.buffer as ArrayBuffer,
        });
      }

      // Accompaniment: only the drum stem is ever separated, so this is
      // always the full mix.
      if (songOpus) {
        sources.push({fileName: 'song.opus', data: songOpus});
        return sources;
      }
      let accompaniment = await readFullMixPcm();
      if (accompaniment) {
        if (padSamples > 0) {
          accompaniment = padPcmStart(
            accompaniment,
            padSamples,
            aMeta.channels,
          );
        }
        const opus = await toOpus(accompaniment);
        sources.push({
          fileName: 'song.opus',
          data: opus.buffer as ArrayBuffer,
        });
      }

      return sources;
    },
    [projectId, audioMeta, state.chartDoc],
  );

  // Passthrough assets from an existing chart package (chart-flow feature),
  // for export round-tripping. Returns [] for audio-only projects.
  const getExtraAssets = useCallback(async () => {
    return readProjectAssets(projectId);
  }, [projectId]);

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
      lyricsWaveData={vocalsStemPcm ?? undefined}
      lyricsWaveChannels={2}
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
        packageSourceFormat === 'sng'
          ? 'sng'
          : packageSourceFormat
            ? 'zip'
            : undefined
      }
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
                      cached audio. All note edits and review progress for this
                      project will be discarded.
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
          <StemVolumeControls audioManager={audioManager} />
          {audioMeta && (
            <LeadingSilenceButton
              sampleRate={audioMeta.sampleRate}
              disabled={audioRebuilding}
            />
          )}
          <div className="pt-4 border-t">
            <AddLyricsDialog
              projectId={projectId}
              onVocalsStemChanged={refreshVocalsStem}
            />
          </div>
        </>
      }
    />
  );
}
