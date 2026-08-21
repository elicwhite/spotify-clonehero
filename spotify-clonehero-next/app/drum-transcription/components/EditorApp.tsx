'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Loader2, AlertCircle} from 'lucide-react';
import {toast} from 'sonner';

import {
  isAlbumArtFileName,
  withAlbumArt,
  type AlbumArtFile,
} from '@/lib/album-art';

import {
  getProject,
  readProjectBinary,
  writeProjectBinary,
  projectFileExists,
  findProjectChartFile,
  SONG_INI_FILE_NAME,
  updateProject,
  loadAudioMeta,
  loadFullMixPcm,
  readSongOpus,
  readOriginalAudio,
  readProjectAssets,
  writeProjectAssets,
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
  readProjectAudioBytes,
  ensureProjectStemFingerprint,
} from '@/lib/drum-transcription/ml/roformer-separation';
import type {AssistAudio} from '@/lib/assist/tasks/types';
import {
  decodeAudio,
  interleaveAudioBuffer,
} from '@/lib/drum-transcription/audio/decoder';
import {padPcmStart} from '@/lib/drum-transcription/audio/pad-pcm';
import {encodePcmToOpus} from '@/lib/audio/opus-encoder';
import {
  chartDocToFolderFiles,
  readChart,
  writeChartFileAs,
  getAudioAnchor,
  setAudioAnchor,
} from '@/lib/chart-edit';
import {
  documentIdentityFields,
  getAssistProvenance,
  setTempoStamp,
  withAssistProvenance,
  withSongIniFields,
  type SongMetadataValue,
} from '@/lib/chart-editor-core';
import {useChartEditorContext} from '@/components/chart-editor/ChartEditorContext';
import {useEditorKeyboard} from '@/components/chart-editor/hooks/useEditorKeyboard';
import {useAutoSave} from '@/components/chart-editor/hooks/useAutoSave';
import {
  usePaddedAudio,
  anchorPadSamples,
  stemPcm,
  type AudioStemInput,
} from '@/components/chart-editor/hooks/usePaddedAudio';
import ChartEditor from '@/components/chart-editor/ChartEditor';
import {
  editedVariant,
  type ChartFileFormat,
} from '@/lib/chart-files/chart-file-names';
import type {AudioSource} from '@/components/chart-editor/ExportDialog';
import {useAssistRunnerContext} from '@/components/assist/AssistRunnerProvider';
import {useProjectToolsApplied} from '@/components/chart-editor/hooks/useToolsApplied';
import type {AssistTaskKey} from '@/lib/assist/tasks/types';
import {useAssistRunActivity} from '@/components/assist/useAssistRunner';
import {audioSamples} from '@/components/chart-editor/audioSamples';
import {stemOriginsOf} from '@/components/chart-editor/sidebar/StemsMixer';

type LoadingState = 'loading' | 'ready' | 'error';

interface EditorAppProps {
  projectId: string;
  /**
   * Whether to offer re-running drum transcription. The control lives in the
   * shared Chart Assist section's Drum transcription card, which runs the
   * `transcribe-drums` assist task in place against the chart's own
   * SyncTrack and applies the result via `ReplaceDrumTrackCommand` — the
   * editor never unmounts. Offered on a project whose grid the user supplied
   * too: transcribing against that grid is exactly what it is for.
   */
  showRegenerate?: boolean | undefined;
}

/**
 * Top-level editor layout for drum-transcription.
 *
 * Loads chart + audio from OPFS, creates AudioManager, and renders the
 * shared ChartEditor shell, including the sidebar's Stems mixer wiring
 * (`stemsMixer`: stem origins, drop-to-add, and the
 * drums-locked-during-regenerate treatment).
 */
export default function EditorApp({
  projectId,
  showRegenerate = false,
}: EditorAppProps) {
  const {state, dispatch} = useChartEditorContext();
  // The editor's single runner (shared with the Chart Assist cards and the
  // Add Lyrics dialog). `useAssistRunActivity` subscribes to the run's
  // identity only — never its step list — so a run in flight doesn't
  // re-render this whole component on every progress tick (Design B).
  const assistRunner = useAssistRunnerContext();
  const {store: assistStore} = assistRunner;
  const assistActivity = useAssistRunActivity(assistStore);
  // A drum-transcription run rewrites the project's chart and deletes its
  // review progress, so autosave has to stand down for its duration or a
  // stale save would rewrite what the pipeline just replaced. The stand-down
  // ends when the run leaves `running`, which is a moment before the Chart
  // Assist card applies `ReplaceDrumTrackCommand`. Nothing can save in that
  // gap: the card applies the command synchronously in the continuation that
  // resolved the run, so React batches the runner's status change and the
  // doc swap into one render, and autosave is debounced besides.
  const regenerating =
    assistActivity.task === 'transcribe-drums' &&
    assistActivity.status === 'running';
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [, setLoadingStep] = useState<string>('Loading project metadata...');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [projectMeta, setProjectMeta] = useState<ProjectMetadata | null>(null);
  // Which assist tasks this chart has been through, for the export event.
  // Wrapped, not inline: a new function identity every render would tear
  // down and re-install the hook's store subscription every render.
  const recordTools = useCallback(
    (id: string, patch: {toolsApplied: AssistTaskKey[]}) =>
      updateProject(id, patch),
    [],
  );
  const toolsApplied = useProjectToolsApplied({
    runner: assistRunner,
    projectId,
    projectMeta,
    setProjectMeta,
    updateProject: recordTools,
  });
  const [audioMeta, setAudioMeta] = useState<AudioStorageMeta | null>(null);
  // Separated vocals stem PCM (plan 0063 Round 2 §5) — background waveform
  // in the piano-roll's lyrics row. null when no vocals stem is cached yet
  // (legacy projects, or projects that haven't run Add Lyrics/separation).
  const [vocalsStemPcm, setVocalsStemPcm] = useState<Float32Array | null>(null);
  const [audioChannels, setAudioChannels] = useState(2);
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
  // Audio source for the Chart Assist Tempo map and Lyrics cards. Goes
  // through the same two authorities the rest of the project does —
  // `readProjectAudioBytes` for "which bytes are this project's audio" and
  // `ensureProjectStemFingerprint` for the key its stems are cached under —
  // so a run reuses the stems this project already produced instead of
  // separating the same audio a second time. The bytes stay behind
  // `loadOriginalBytes` so a run resolved entirely from the stem cache never
  // reads them.
  const loadAssistAudio = useCallback(
    async (): Promise<AssistAudio> => ({
      stemFingerprint: await ensureProjectStemFingerprint(projectId),
      loadOriginalBytes: async () =>
        new Uint8Array(await readProjectAudioBytes(projectId)),
    }),
    [projectId],
  );

  // ORIGINAL (unpadded) full-mix + drum-stem PCM, retained across the
  // session — passed to `usePaddedAudio`, which re-pads from source on
  // every `audioAnchor` change rather than compounding padding on top of a
  // previously-padded buffer. State (not refs): `usePaddedAudio` reads
  // these during render, and refs can't be read there.
  const [originalFullMixPcm, setOriginalFullMixPcm] =
    useState<Float32Array | null>(null);
  const [originalDrumStemPcm, setOriginalDrumStemPcm] =
    useState<Float32Array | null>(null);
  // ORIGINAL (unpadded) vocals-stem PCM — only ever read from effects/
  // callbacks (never during render), so a ref is fine.
  const originalVocalsStemPcmRef = useRef<Float32Array | null>(null);

  // Stems dropped onto the Stems mixer's drop-zone row at runtime (plan 0074
  // Phase 5). Merged into `paddedAudioStems` below, so adding one triggers
  // `usePaddedAudio`'s stem-list rebuild the same way an anchor change does.
  const [userAddedStems, setUserAddedStems] = useState<AudioStemInput[]>([]);

  // The chart's album art, read from (and written back into) the project's
  // passthrough assets. null while loading and for a chart without art —
  // the field renders the same "no art yet" state for both, and there is
  // nothing a user could do differently in between.
  const [albumArt, setAlbumArt] = useState<AlbumArtFile | null>(null);

  // Build the save function for auto-save
  const saveFn = useCallback(async () => {
    if (!state.chartDoc) return;

    // Save the edited chart, in whichever format the project's chart uses
    // (notes.edited.chart or notes.edited.mid) — never force one onto the
    // other. Raw bytes are written directly; text-decoding-then-encoding a
    // .mid chart would corrupt it. The `song.ini` from the same
    // serialization goes beside it, since neither chart format carries the
    // `diff_*` intensities, `icon`, `loading_phrase` or custom keys the
    // song-details dialog edits — and on a `.mid` project it is the only
    // file that carries the song's name, artist and charter at all.
    const {chart: chartFileOut, ini} = chartDocToFolderFiles(state.chartDoc);
    // The ini goes first: a torn save then leaves stale chart content under
    // fresh metadata, and the merge on load lets the chart win on everything
    // it can express. The reverse order would read as a lost edit.
    await writeProjectBinary(projectId, SONG_INI_FILE_NAME, ini.data);
    await writeProjectBinary(
      projectId,
      editedVariant(chartFileOut.fileName),
      chartFileOut.data,
    );

    // Mirror the doc's audio anchor into project metadata (0064 addendum
    // §1) so a reload re-derives the same padded audio. Cheap and
    // idempotent — runs on every autosave.
    await updateProject(projectId, {
      audioAnchor: getAudioAnchor(state.chartDoc) ?? null,
      // Assist provenance can't ride the chart file (`.chart`/`.mid` have no
      // slot for it), so the project metadata is where it persists — same
      // mirroring as the anchor above, so a reload keeps any staleness
      // prompt or "Keep as-is" dismissal the user was looking at.
      assistProvenance: getAssistProvenance(state.chartDoc) ?? null,
      // The record's identity is a display denormalization for the projects
      // list; the document is the truth, so it is refreshed from the same
      // document this save wrote.
      ...documentIdentityFields(state.chartDoc),
    });
  }, [projectId, state.chartDoc]);

  // Auto-save hook (uses shared hook, passes the save function)
  const {save} = useAutoSave(
    loadingState === 'ready' && !regenerating ? saveFn : null,
  );

  // Register shared editor keyboard shortcuts
  useEditorKeyboard(save);

  // Decode the cached vocals stem (Round 2 §5) into PCM for the piano-roll
  // lyrics row's background waveform, padded to match the current audio
  // anchor. Called at project load, and again after an Add Lyrics run that
  // aligned against the cached roformer vocals, so the waveform appears for
  // a stem this session hasn't picked up yet. No-op when no vocals stem is
  // cached (legacy projects, or ones whose lyrics came from the Demucs
  // fallback, which caches nothing). `padSamples` defaults to the chart's
  // current `audioAnchor` pad amount so a mid-session refresh stays
  // consistent with the live AudioManager.
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
        const pad =
          padSamples ??
          (state.chartDoc && audioMeta
            ? anchorPadSamples(
                getAudioAnchor(state.chartDoc),
                audioMeta.sampleRate,
              )
            : 0);
        setVocalsStemPcm(padPcmStart(pcm, pad, 2));
      } catch (err) {
        console.warn('Failed to load vocals stem for waveform:', err);
      }
    },
    [projectId, state.chartDoc, audioMeta],
  );

  // Re-pad the vocals-stem waveform whenever the chart's `audioAnchor`
  // changes (leading-silence apply/undo/redo, or a grid-glue tempo edit near
  // the start) — mirrors `usePaddedAudio`'s rebuild trigger, gated on the
  // numeric pad amount so a note-only edit never re-copies the PCM.
  const vocalsPadSamplesRef = useRef(0);
  useEffect(() => {
    if (!state.chartDoc || !audioMeta || !originalVocalsStemPcmRef.current) {
      return;
    }
    const nextPadSamples = anchorPadSamples(
      getAudioAnchor(state.chartDoc),
      audioMeta.sampleRate,
    );
    if (nextPadSamples === vocalsPadSamplesRef.current) return;
    vocalsPadSamplesRef.current = nextPadSamples;
    setVocalsStemPcm(
      padPcmStart(originalVocalsStemPcmRef.current, nextPadSamples, 2),
    );
  }, [state.chartDoc, audioMeta]);

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
        // Publish this chart's provenance before anything can start a run or
        // an export against it. Without it every export from this editor
        // would report an unset origin, and the tool with the second-largest
        // funnel would be invisible in its own numbers (plan 0105).
        // `?? null`, not a guess at `'drum-transcription'`: a project
        // written before the field existed is not evidence of which tool
        // made it, and `unset` has to keep meaning exactly one thing.
        dispatch({type: 'SET_CHART_ORIGIN', origin: meta.origin ?? null});

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

        // 3-i. Merge the project's own `song.ini` back in. It is the only
        // file that carries the `diff_*` intensities and custom keys the
        // song-details dialog edits, and on a `.mid` project the only one
        // carrying the song's name, artist and charter at all. A project
        // saved before the editor wrote one has none, and loads from the
        // chart alone exactly as it did before.
        if (await projectFileExists(projectId, SONG_INI_FILE_NAME)) {
          const iniBuf = await readProjectBinary(projectId, SONG_INI_FILE_NAME);
          if (cancelled) return;
          chartDoc = withSongIniFields(chartDoc, {
            fileName: SONG_INI_FILE_NAME,
            data: new Uint8Array(iniBuf),
          });
        }

        // 3a. Re-attach the persisted audio anchor (0064 addendum §1), if
        // any, before this doc is ever dispatched. Absent/undefined ⇒ no
        // padding, current behavior.
        const persistedAnchor = meta.audioAnchor ?? null;
        if (persistedAnchor) {
          chartDoc = setAudioAnchor(chartDoc, persistedAnchor);
        }

        // 3b. Re-attach assist provenance (plan 0074 Design C). `.chart`/
        // `.mid` have nowhere to carry it, so the project's OPFS metadata is
        // the persistence layer for this page — mirrored on every autosave
        // the same way `audioAnchor` is. A project transcribed before this
        // field existed gets a stamp seeded from the chart as loaded: its
        // drums really were transcribed against the grid it ships with, so
        // "not stale until the grid moves" is the truthful starting point.
        // Grid-provided (chart-flow) projects are skipped — their drums came
        // from the user's own chart, not from a transcription run.
        if (meta.assistProvenance) {
          chartDoc = withAssistProvenance(chartDoc, meta.assistProvenance);
        } else if (meta.gridSource !== 'provided') {
          chartDoc = setTempoStamp(chartDoc, 'drum-transcription');
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
        vocalsPadSamplesRef.current = padSamples;

        // 9. Load the full mix as PCM for waveform visualization (decodes
        // song.opus in memory for current projects; reads full.pcm directly
        // for legacy ones). This is the ORIGINAL (unpadded) audio — the
        // stored audio at rest is never touched (0064 addendum §5).
        // `usePaddedAudio` (below) builds the padded AudioManager from this
        // once the chart doc is dispatched.
        const pcmData = await loadFullMixPcm(projectId);
        if (cancelled) return;
        setOriginalFullMixPcm(pcmData);
        setAudioChannels(aMeta.channels);

        // Load the separated drum stem (fingerprint cache, with legacy
        // per-project fallback) if separation has run.
        setLoadingStep('Loading stems...');
        let loadedDrumStemPcm: Float32Array | null = null;
        try {
          loadedDrumStemPcm = await loadDrumStem(projectId);
          if (cancelled) return;
        } catch {
          // Stem not available, skip
        }
        setOriginalDrumStemPcm(loadedDrumStemPcm);

        // Load the separated vocals stem (Round 2 §5), for the piano-roll
        // lyrics row's background waveform only — not registered with
        // AudioManager (it's not a playback source). Opportunistic: absent
        // on legacy projects, or ones that haven't run separation/Add Lyrics.
        await refreshVocalsStem(padSamples);
        if (cancelled) return;

        // 10. Update editor state. ChartDoc carries the parsed chart;
        // consumers derive the active track via selectActiveTrack().
        // `usePaddedAudio` builds the AudioManager once this lands.
        // Visibility comes with it: `SET_CHART_DOC` seeds the doc's
        // preferred track, which is Expert Drums for transcription output —
        // the one visible track the route model gives this editor.
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Padded-AudioManager lifecycle (initial build + rebuild on `audioAnchor`
  // changes) — 0064 addendum §5/§3, extracted into a shared hook so every
  // chart-editor host page gets the same leading-silence-aware audio.
  const paddedAudioStems = useMemo(
    () => [
      ...(originalDrumStemPcm
        ? [
            {
              name: 'drums',
              pcm: originalDrumStemPcm,
              origin: 'ai-separated' as const,
            },
          ]
        : []),
      ...userAddedStems,
    ],
    [originalDrumStemPcm, userAddedStems],
  );

  // Adds a dropped stem (StemsMixer's drop-zone row) to the padded-audio
  // stem list, which rebuilds the AudioManager to include it. The mixer
  // always hands over 44.1 kHz stereo PCM, while `buildPaddedAudioManager`
  // describes every track it builds with this project's `audioMeta` — a
  // mismatch would hand these samples to Web Audio under the wrong rate and
  // play the stem at the wrong speed, so reject it instead.
  const handleAddStem = useCallback(
    (input: {name: string; pcm: Float32Array; origin: 'user-added'}) => {
      if (
        audioMeta &&
        (audioMeta.sampleRate !== 44100 || audioMeta.channels !== 2)
      ) {
        toast.error('This project’s audio format cannot take added stems');
        return;
      }
      const {name, pcm, origin} = input;
      setUserAddedStems(prev => [...prev, {name, pcm, origin}]);
    },
    [audioMeta],
  );

  const {
    audioManager,
    fullMixPcm: audioPcm,
    stems: audioStems,
    durationSeconds,
    rebuilding: audioRebuilding,
  } = usePaddedAudio({
    chartDoc: state.chartDoc,
    audioMeta,
    fullMixPcm: originalFullMixPcm,
    stems: paddedAudioStems,
    onSongEnded: () => dispatch({type: 'SET_PLAYING', isPlaying: false}),
  });
  const drumStemPcm = stemPcm(audioStems, 'drums');
  // Wrapped once per buffer — see `components/chart-editor/audioSamples.ts`.
  const fullMixSamples = useMemo(() => audioSamples(audioPcm), [audioPcm]);
  const drumStemSamples = useMemo(
    () => audioSamples(drumStemPcm),
    [drumStemPcm],
  );
  const vocalsSamples = useMemo(
    () => audioSamples(vocalsStemPcm),
    [vocalsStemPcm],
  );

  // Build a minimal metadata object for CloneHeroRenderer.
  const cloneHeroMetadata = useMemo(
    () =>
      projectMeta
        ? {
            name: projectMeta.name,
            artist: projectMeta.artist ?? '',
            charter: projectMeta.charter ?? '',
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

  // The header dialog has already written the edit into the chart doc, which
  // the autosave below persists along with every other edit. The same three
  // identity fields are the project record's own, and the shared project
  // list reads them from there, so they are mirrored across as three fields
  // rather than composed into one name.
  const handleMetadataChange = useCallback(
    async ({name, artist, charter}: SongMetadataValue) => {
      const updated = await updateProject(projectId, {name, artist, charter});
      setProjectMeta(updated);
      toast.success('Song details saved');
    },
    [projectId],
  );

  // Provide the chart file for export in the requested format, serialized
  // from the live in-memory chart doc via writeChartFileAs. Autosave is
  // debounced, so the persisted OPFS bytes can lag the doc while dirty —
  // reading them here (even on a same-format request) risks silently
  // dropping the user's latest edits. Only falls back to the persisted
  // bytes when there's no in-memory doc to serialize from.
  const getChartFile = useCallback(
    async ({
      format,
    }: {
      format: ChartFileFormat;
    }): Promise<{fileName: string; data: Uint8Array}> => {
      if (state.chartDoc) {
        return writeChartFileAs(state.chartDoc, format);
      }
      const fileName = await findProjectChartFile(projectId);
      if (!fileName) throw new Error('Project has no persisted chart file');
      const buf = await readProjectBinary(projectId, fileName);
      return {fileName, data: new Uint8Array(buf)};
    },
    [projectId, state.chartDoc],
  );

  // Provide audio sources for export.
  //
  // Stems live in the fingerprint-keyed stem cache; the full mix is
  // `audio/original.<ext>` (current projects), `audio/song.opus`
  // (opus-at-rest projects), or `audio/full.pcm` (legacy).
  //
  // `includeStems` (from the export dialog) selects between:
  //   true  → separated drums.opus + accompaniment song.opus, Opus-encoded
  //           from the stem PCM via WebCodecs.
  //   false → the user's original uploaded file, byte-for-byte, as
  //           song.<ext> (or song.opus verbatim for opus-at-rest projects).
  //
  // When the chart carries an `audioAnchor` (leading silence applied, 0064
  // addendum §6), every returned source is padded so the exported audio
  // matches the chart's shifted note timing — the verbatim/passthrough
  // shortcuts above are only valid when there's no anchor. The stored audio
  // at rest is never modified; padding happens on a decoded copy at export
  // time.
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
      // no anchor (verbatim bytes can't reflect a pad). Used by the
      // includeStems accompaniment branch below.
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
        // Current (original-at-rest) projects: emit the verbatim upload
        // byte-for-byte, no re-encode.
        const original = await readOriginalAudio(projectId);
        if (original) {
          const ext = original.extension || 'mp3';
          sources.push({fileName: `song.${ext}`, data: original.data});
          return sources;
        }
        // Opus-at-rest projects: reuse the stored Opus verbatim rather than
        // decoding + re-encoding.
        if (songOpus) {
          sources.push({fileName: 'song.opus', data: songOpus});
          return sources;
        }
        // Legacy projects have neither: fall back to Opus-encoding full.pcm.
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

  // Album art rides in the same passthrough assets export round-trips, so
  // both reading and writing it go through that one list rather than a
  // storage path of its own.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const assets = await readProjectAssets(projectId);
      const art = assets.find(a => isAlbumArtFileName(a.fileName)) ?? null;
      if (!cancelled) setAlbumArt(art);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleAlbumArtChange = useCallback(
    async (art: AlbumArtFile | null) => {
      // Re-read rather than trusting a cached list: an export or an import
      // may have touched the assets since this component mounted.
      const assets = await readProjectAssets(projectId);
      await writeProjectAssets(projectId, withAlbumArt(assets, art));
      setAlbumArt(art);
    },
    [projectId],
  );

  const albumArtSlot = useMemo(
    () => ({current: albumArt, onChange: handleAlbumArtChange}),
    [albumArt, handleAlbumArtChange],
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

  const chart = state.chartDoc?.parsedChart ?? null;
  if (!chart || !audioManager || !cloneHeroMetadata) {
    return null;
  }

  return (
    <ChartEditor
      chart={chart}
      toolsApplied={toolsApplied}
      audioManager={audioManager}
      audioData={fullMixSamples}
      highwayAudioData={drumStemSamples}
      audioChannels={audioChannels}
      lyricsWaveData={vocalsSamples}
      lyricsWaveChannels={2}
      durationSeconds={durationSeconds}
      decodedOnsets={decodedOnsets}
      sections={chart.sections}
      songName={chart.metadata.name || projectMeta?.name || 'Untitled'}
      artistName={chart.metadata.artist || undefined}
      charterName={chart.metadata.charter || undefined}
      onMetadataChange={handleMetadataChange}
      getChartFile={getChartFile}
      sourceChartFormat={packageSourceFormat ? chart.format : undefined}
      chartFormatSelectable
      getAudioSources={getAudioSources}
      getExtraAssets={getExtraAssets}
      albumArt={albumArtSlot}
      defaultExportFormat={
        packageSourceFormat === 'sng'
          ? 'sng'
          : packageSourceFormat
            ? 'zip'
            : undefined
      }
      chartAssist={{
        allowDrumRerun: showRegenerate,
        loadAudio: loadAssistAudio,
        audioSampleRate: audioMeta?.sampleRate,
        audioBusyReason: audioRebuilding ? 'Rebuilding audio' : undefined,
        onLyricsAlignedFromCachedVocals: refreshVocalsStem,
      }}
      stemsMixer={{
        stemOrigins: stemOriginsOf(audioStems),
        onAddStem: handleAddStem,
        // The drums track is locked while a transcribe-drums run is
        // rewriting it — mirrors the Chart Matrix's own busy treatment for
        // the same run, so the mixer row and the matrix cells lock
        // together; transport/A-B loop stay interactive throughout.
        lockedTrackNames: regenerating ? new Set(['drums']) : undefined,
      }}
    />
  );
}
