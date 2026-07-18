/**
 * Pipeline runner for the drum transcription feature.
 *
 * Orchestrates the full flow:
 *   audio upload -> decode -> BS-Roformer drum-stem separation
 *     -> resample 44.1k -> 48k -> ML drum transcription (stereo CRNN)
 *     -> chart generation
 *
 * Each step checks OPFS for existing output before running, enabling
 * resumability if the user closes the tab mid-pipeline.
 */

import {decodeAudio, interleaveAudioBuffer} from '../audio/decoder';
import {createAudioMetadata, TARGET_SAMPLE_RATE} from '../audio/types';
import {
  createProject,
  storeAudio,
  storeOriginalAudio,
  updateProject,
  loadAudioForDemucs,
  hasStoredAudio,
  writeProjectBinary,
  writeProjectJSON,
  readProjectJSON,
  projectFileExists,
  hasProjectChartFile,
  writePackageInfo,
  writeProjectAssets,
  deleteProjectFile,
  getProject,
  editedVariant,
  CHART_FILE_BASENAMES,
  type ProjectMetadata,
  type PackageInfo,
} from '../storage/opfs';
import {
  separateDrums,
  hasDrumStem,
  loadDrumStem,
  type DrumSeparationProgress,
} from '../ml/roformer-separation';
import {
  planarStereoToCrnnInput,
  CRNN_SAMPLE_RATE,
} from './crnn-audio-prep';
import {runTempoPipelineFromPcm} from '@/lib/tempo-map/pipeline-client';
import type {
  LinkSegSections,
  PipelineProgress as TempoPipelineProgress,
  Synctrack,
} from '@/lib/tempo-map/types';
import {CrnnTranscriber, type DrumTranscriber} from '../ml/transcriber';
import {writeChartFolder} from '@/lib/chart-edit';
import type {ChartDocument, File as FileEntry} from '@/lib/chart-edit';
import {
  buildChartDocument,
  buildChartDocumentFromExistingChart,
  buildConfidenceData,
  RESOLUTION,
  DEFAULT_BPM,
  type StoredSynctrack,
} from './chart-builder';
import type {PhaseAlignResult} from './phase-align';
import {loadPhaseAlignConfig} from '../ml/phase-align-config';
import type {TranscriptionResult} from '../ml/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineStep =
  | 'idle'
  | 'loading-runtime'
  | 'decoding'
  | 'separating'
  | 'tempo-mapping'
  | 'transcribing'
  | 'ready'
  | 'error';

export interface PipelineProgress {
  step: PipelineStep;
  /** Progress within the current step, 0-1. */
  progress: number;
  /** Project ID once created. */
  projectId?: string | undefined;
  /** Project name. */
  projectName?: string | undefined;
  /** Error message if step === 'error'. */
  error?: string | undefined;
  /**
   * Estimated seconds remaining within the current step. Provided when
   * the underlying step has a meaningful estimate (e.g. the separator's
   * exponential moving average over segment durations).
   */
  etaSeconds?: number | undefined;
  /** Optional human-readable detail line for the active step. */
  detail?: string | undefined;
}

export type PipelineProgressCallback = (progress: PipelineProgress) => void;

// ---------------------------------------------------------------------------
// Audio prep for the CRNN transcriber
// ---------------------------------------------------------------------------

/**
 * Load the audio to transcribe (drum stem if separated, else full mix) and
 * resample it to interleaved stereo at 48 kHz for the CRNN transcriber, via
 * the SAME resample step /tempo's tempo-track.ts uses on its in-memory
 * separation output (crnn-audio-prep.ts).
 *
 * Both the stored drum stem and stored full-mix audio are interleaved stereo
 * at TARGET_SAMPLE_RATE (44.1 kHz).
 */
async function loadTranscriptionAudio48k(
  projectId: string,
): Promise<Float32Array> {
  let interleaved44k: Float32Array;
  try {
    interleaved44k = await loadDrumStem(projectId);
  } catch {
    // Stems unavailable (e.g. separation was skipped/failed):
    // fall back to the full audio mix (already stereo interleaved).
    interleaved44k = await loadAudioForDemucs(projectId);
  }

  const n = Math.floor(interleaved44k.length / 2);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = interleaved44k[i * 2];
    right[i] = interleaved44k[i * 2 + 1];
  }

  return planarStereoToCrnnInput(left, right, TARGET_SAMPLE_RATE);
}

// ---------------------------------------------------------------------------
// Stem separation progress mapping
// ---------------------------------------------------------------------------

/** Sub-ranges of the 'separating' step assigned to each separation sub-step,
 * so the dialog's bar moves monotonically instead of resetting to 0 when the
 * model download finishes and processing begins. */
const SEPARATION_STAGE_RANGES: Record<
  DrumSeparationProgress['step'],
  [number, number]
> = {
  'loading-model': [0, 0.15],
  processing: [0.15, 0.97],
  storing: [0.97, 1],
  done: [1, 1],
};

function separationProgressToFraction(p: DrumSeparationProgress): number {
  const [lo, hi] = SEPARATION_STAGE_RANGES[p.step];
  return lo + (hi - lo) * Math.min(1, Math.max(0, p.percent));
}

/**
 * Runs BS-Roformer drum-stem separation for a project, mapping progress into
 * the pipeline's 'separating' step. Separation requires WebGPU/ONNX and is
 * allowed to fail (e.g. WebGPU unavailable): failures are swallowed (logged)
 * so the caller falls back to transcribing the full audio mix rather than
 * failing the whole pipeline. Shared by all three entry points below
 * (runPipeline, runPipelineFromChart, resumePipeline) — each still owns its
 * own "already separated? skip" pre-check and progress bracketing, since
 * that differs slightly (e.g. runPipelineFromChart never resumes).
 */
async function separateDrumsStep(
  projectId: string,
  projectName: string,
  onProgress: PipelineProgressCallback,
): Promise<void> {
  try {
    const storedAudio = await loadAudioForDemucs(projectId);
    await separateDrums(projectId, storedAudio, sepProgress => {
      onProgress({
        step: 'separating',
        progress: separationProgressToFraction(sepProgress),
        etaSeconds: sepProgress.etaSeconds,
        projectId,
        projectName,
      });
    });
  } catch (err) {
    console.warn('Stem separation failed, continuing with full mix:', err);
    onProgress({step: 'separating', progress: 1, projectId, projectName});
  }
}

// ---------------------------------------------------------------------------
// Tempo mapping (reuses the /tempo pipeline)
// ---------------------------------------------------------------------------

/** Filename for the persisted predicted tempo map (StoredSynctrack). Exported
 * so other consumers (e.g. the F63 confidence gauge) can read it without
 * duplicating the string. */
export const SYNCTRACK_FILE = 'synctrack.json';

/** Sub-ranges of the 'tempo-mapping' step assigned to each tempo-pipeline
 * stage, so the dialog's bar moves monotonically through the whole step. */
const TEMPO_STAGE_RANGES: Record<
  TempoPipelineProgress['stage'],
  [number, number]
> = {
  'download-separation-model': [0, 0.05],
  separate: [0.05, 0.3],
  'download-beat-model': [0.3, 0.4],
  'beats-fullmix': [0.4, 0.62],
  'beats-drums': [0.62, 0.88],
  sections: [0.88, 0.96],
  convert: [0.96, 1],
};

const TEMPO_STAGE_DETAIL: Record<TempoPipelineProgress['stage'], string> = {
  'download-separation-model': 'Downloading separation model',
  separate: 'Separating drums',
  'download-beat-model': 'Downloading beat-detection model',
  'beats-fullmix': 'Detecting beats (full mix)',
  'beats-drums': 'Detecting beats (drum stem)',
  sections: 'Labeling song sections',
  convert: 'Fitting tempo map',
};

function tempoProgressToPipeline(p: TempoPipelineProgress): {
  progress: number;
  detail: string;
  etaSeconds?: number | undefined;
} {
  const [lo, hi] = TEMPO_STAGE_RANGES[p.stage];
  const within = p.percent ?? 0;
  const base = TEMPO_STAGE_DETAIL[p.stage];
  return {
    progress: lo + (hi - lo) * Math.min(1, Math.max(0, within)),
    detail: p.detail ? `${base} — ${p.detail}` : base,
    etaSeconds: p.etaSeconds,
  };
}

/**
 * Ensure a synctrack exists for the project, running the tempo-map pipeline
 * if needed (persisted to synctrack.json for resumability).
 *
 * Reuses the already-separated transcription drum stem (mono mean of the
 * stored stereo stem — identical to the tempo worker's own mono separation
 * output) so the tempo pipeline never runs a second GPU separation.
 *
 * Returns null on failure — the caller falls back to a flat-tempo chart.
 */
interface SynctrackResult {
  synctrack: Synctrack;
  sections: LinkSegSections | null;
}

async function ensureSynctrack(
  projectId: string,
  projectName: string,
  sourceBytes: ArrayBuffer | null,
  onProgress: PipelineProgressCallback,
): Promise<SynctrackResult | null> {
  if (await projectFileExists(projectId, SYNCTRACK_FILE)) {
    try {
      const stored = await readProjectJSON<StoredSynctrack>(
        projectId,
        SYNCTRACK_FILE,
      );
      if (stored?.synctrack)
        return {synctrack: stored.synctrack, sections: stored.sections ?? null};
      // Parsed but missing the synctrack: fall through and recompute.
    } catch {
      // Corrupt file: fall through and recompute.
    }
  }

  onProgress({step: 'tempo-mapping', progress: 0, projectId, projectName});

  try {
    // Full mix, deinterleaved to planar 44.1 kHz stereo.
    const interleaved = await loadAudioForDemucs(projectId);
    const n = Math.floor(interleaved.length / 2);
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      left[i] = interleaved[i * 2];
      right[i] = interleaved[i * 2 + 1];
    }

    // Mono drum stem from the transcription stem, when present.
    let drumStemMono: Float32Array | null = null;
    try {
      const stem = await loadDrumStem(projectId);
      const sn = Math.floor(stem.length / 2);
      if (sn === n) {
        drumStemMono = new Float32Array(sn);
        for (let i = 0; i < sn; i++) {
          drumStemMono[i] = (stem[i * 2] + stem[i * 2 + 1]) * 0.5;
        }
      }
    } catch {
      // No stem stored (separation skipped/failed): the tempo worker will
      // separate on its own (or fail, which we catch below).
    }

    const result = await runTempoPipelineFromPcm(
      {left, right, sampleRate: TARGET_SAMPLE_RATE},
      {
        // Detached buffers (decodeAudioData) have byteLength 0 — skip them.
        sourceBytes:
          sourceBytes && sourceBytes.byteLength > 0 ? sourceBytes : null,
        drumStemMono,
        onProgress: p => {
          const mapped = tempoProgressToPipeline(p);
          onProgress({
            step: 'tempo-mapping',
            progress: mapped.progress,
            etaSeconds: mapped.etaSeconds,
            detail: mapped.detail,
            projectId,
            projectName,
          });
        },
      },
    );

    const stored: StoredSynctrack = {
      synctrack: result.synctrack,
      meterStats: result.meterStats,
      drumOnsetOffsetMs: result.drumOnsetOffsetMs,
      sections: result.sections,
    };
    await writeProjectJSON(projectId, SYNCTRACK_FILE, stored);

    onProgress({step: 'tempo-mapping', progress: 1, projectId, projectName});
    return {synctrack: result.synctrack, sections: result.sections};
  } catch (err) {
    console.warn(
      `Tempo mapping failed, falling back to a flat ${DEFAULT_BPM} BPM chart:`,
      err,
    );
    onProgress({step: 'tempo-mapping', progress: 1, projectId, projectName});
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

/**
 * Run the full drum transcription pipeline.
 *
 * @param audioFile - The audio file (File or ArrayBuffer) to process.
 * @param fileName - Display name for the project.
 * @param onProgress - Callback for progress updates.
 * @param transcriber - Optional transcriber implementation. If omitted, uses CrnnTranscriber.
 * @returns The project ID.
 */
export async function runPipeline(
  audioFile: File | ArrayBuffer,
  fileName: string,
  onProgress: PipelineProgressCallback,
  transcriber?: DrumTranscriber,
): Promise<string> {
  const txr = transcriber ?? createDefaultTranscriber();

  // Step 1: Decode audio and create project
  onProgress({step: 'decoding', progress: 0, projectName: fileName});

  let projectId: string;
  let projectMeta: ProjectMetadata;

  // Get the raw ArrayBuffer from the input
  const arrayBuffer =
    audioFile instanceof File ? await audioFile.arrayBuffer() : audioFile;

  // Create a File object for metadata extraction if we have an ArrayBuffer
  const file =
    audioFile instanceof File
      ? audioFile
      : new File([arrayBuffer], fileName, {type: 'audio/mpeg'});

  // Keep a copy of the source bytes for the tempo pipeline's stem cache:
  // decodeAudioData detaches the buffer it is given.
  const sourceBytes = arrayBuffer.slice(0);

  // Decode the audio
  const audioBuffer = await decodeAudio(arrayBuffer);
  const metadata = createAudioMetadata(file, audioBuffer);

  onProgress({step: 'decoding', progress: 0.5, projectName: fileName});

  // Create project and store audio
  projectMeta = await createProject(metadata.name);
  projectId = projectMeta.id;

  const interleavedPcm = interleaveAudioBuffer(audioBuffer);
  await storeAudio(projectId, interleavedPcm, metadata, audioBuffer.length);

  // Persist the untouched upload so it can be exported as the original audio.
  await storeOriginalAudio(projectId, sourceBytes, metadata.originalFileName);

  onProgress({
    step: 'decoding',
    progress: 1,
    projectId,
    projectName: metadata.name,
  });

  // Step 2: Stem separation
  // Stem separation requires ONNX Runtime + WebGPU. If unavailable (e.g.
  // dev mode without model loaded), we skip it gracefully and the
  // transcription step will fall back to using the full audio mix.
  const stemsExist = await hasDrumStem(projectId);
  if (!stemsExist) {
    onProgress({
      step: 'separating',
      progress: 0,
      projectId,
      projectName: metadata.name,
    });

    await updateProject(projectId, {stage: 'separating'});
    await separateDrumsStep(projectId, metadata.name, onProgress);
  }

  onProgress({
    step: 'separating',
    progress: 1,
    projectId,
    projectName: metadata.name,
  });

  // Step 3: Tempo mapping (reuses the /tempo pipeline; the pre-separated
  // drum stem avoids a second GPU separation). Falls back to a flat-tempo
  // chart on failure.
  const chartExists = await hasProjectChartFile(projectId);
  let synctrack: Synctrack | null = null;
  let sections: LinkSegSections | null = null;
  if (!chartExists) {
    const st = await ensureSynctrack(
      projectId,
      metadata.name,
      sourceBytes,
      onProgress,
    );
    synctrack = st?.synctrack ?? null;
    sections = st?.sections ?? null;
  }

  // Step 4: Transcription
  if (!chartExists) {
    onProgress({
      step: 'transcribing',
      progress: 0,
      projectId,
      projectName: metadata.name,
    });

    await updateProject(projectId, {stage: 'transcribing'});

    // Load the drum stem (or full-mix fallback) as interleaved stereo,
    // resampled 44.1k -> 48k for the stereo CRNN.
    const drumAudioStereo = await loadTranscriptionAudio48k(projectId);

    // Run transcription
    const result: TranscriptionResult = await txr.transcribe(
      drumAudioStereo,
      CRNN_SAMPLE_RATE,
      txrProgress => {
        onProgress({
          step: 'transcribing',
          progress: txrProgress.percent,
          projectId,
          projectName: metadata.name,
        });
      },
    );

    // Build ChartDocument from transcription results under the real tempo
    // map (or flat DEFAULT_BPM when tempo mapping failed). PHASE-ALIGN's
    // dev override (localStorage) is read once here, at pipeline start.
    const phaseAlignOut: {result?: PhaseAlignResult} = {};
    const chartDoc = buildChartDocument(
      result.events,
      metadata.name,
      result.durationSeconds,
      synctrack,
      sections,
      loadPhaseAlignConfig(),
      phaseAlignOut,
    );

    // Serialize the chart. This path always builds a fresh ParsedChart with
    // format:'chart' (buildChartDocument, unlike buildChartDocumentFromExistingChart,
    // has no source format to preserve), but find by content type rather
    // than hardcoding the name, so this stays symmetric with the chart-flow
    // write below.
    const files = writeChartFolder(chartDoc);
    const chartFile = files.find(
      f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
    );
    if (!chartFile) {
      throw new Error('writeChartFolder did not produce a chart file');
    }

    // Write confidence.json before the chart file: the chart file's presence
    // is the resume gate, so writing it last guarantees a crash never leaves
    // the chart present with confidence.json missing on resume. Both derive
    // from the same events and tempo map — the SAME phase-align shift
    // buildChartDocument applied above, so confidence keys match the
    // chart's snapped ticks exactly.
    const confidenceData = buildConfidenceData(
      result.events,
      chartDoc.parsedChart.tempos,
      RESOLUTION,
      'audio',
      phaseAlignOut.result?.shiftMs ?? 0,
    );
    await writeProjectJSON(projectId, 'confidence.json', confidenceData);
    await writeProjectBinary(projectId, chartFile.fileName, chartFile.data);
  }

  // Mark project as ready for editing
  await updateProject(projectId, {stage: 'editing', gridSource: 'predicted'});

  onProgress({
    step: 'ready',
    progress: 1,
    projectId,
    projectName: metadata.name,
  });

  return projectId;
}

// ---------------------------------------------------------------------------
// Pipeline runner — existing-chart flow (chart-flow feature)
// ---------------------------------------------------------------------------

/** Input for {@link runPipelineFromChart}: an already-parsed chart package. */
export interface ExistingChartPipelineInput {
  /** The parsed existing chart (its SyncTrack is the provided grid). */
  chartDoc: ChartDocument;
  /** The audio file to transcribe (e.g. the package's primary song file). */
  audioFile: File;
  /** Original package identity, for re-export in the same shape. */
  packageInfo: PackageInfo;
  /**
   * Every other file from the original package (not the chart/ini files, not
   * `audioFile`) — album art, video, secondary audio, etc. Stored verbatim
   * so export can round-trip them.
   */
  extraAssets: FileEntry[];
}

/**
 * Run the drum transcription pipeline against an EXISTING chart package.
 *
 * Unlike {@link runPipeline} (audio-only: predicts a tempo map from scratch),
 * this path reuses the supplied chart's own SyncTrack for note placement —
 * the tempo-mapping step is skipped entirely, never a model-predicted one.
 * Feature extraction and model inference (stem separation, CRNN transcribe)
 * are otherwise identical. Scoring against a provided grid instead of a
 * predicted one is worth ~+0.08 edit_rate_w offline (PIPELINE_AUDIT.md), so
 * this is a meaningfully better result whenever the user already has a
 * chart, not just a convenience.
 *
 * The existing chart's other tracks/sections/metadata/ini fields are left
 * untouched; only the Expert Drums track is added or replaced (see
 * {@link buildChartDocumentFromExistingChart}).
 */
export async function runPipelineFromChart(
  input: ExistingChartPipelineInput,
  onProgress: PipelineProgressCallback,
  transcriber?: DrumTranscriber,
): Promise<string> {
  const txr = transcriber ?? createDefaultTranscriber();
  const {chartDoc, audioFile, packageInfo, extraAssets} = input;

  const projectName =
    chartDoc.parsedChart.metadata.name || packageInfo.originalName;

  // Step 1: Decode audio and create project (identical to runPipeline).
  onProgress({step: 'decoding', progress: 0, projectName});

  const arrayBuffer = await audioFile.arrayBuffer();
  const sourceBytes = arrayBuffer.slice(0);
  const audioBuffer = await decodeAudio(arrayBuffer);
  const metadata = createAudioMetadata(audioFile, audioBuffer);

  onProgress({step: 'decoding', progress: 0.5, projectName});

  const projectMeta = await createProject(projectName);
  const projectId = projectMeta.id;

  const interleavedPcm = interleaveAudioBuffer(audioBuffer);
  await storeAudio(projectId, interleavedPcm, metadata, audioBuffer.length);
  await storeOriginalAudio(projectId, sourceBytes, metadata.originalFileName);

  // Persist the package identity + passthrough assets up front so a crash
  // mid-pipeline doesn't lose the "write back in the same shape" info.
  await writePackageInfo(projectId, packageInfo);
  await writeProjectAssets(projectId, extraAssets);

  onProgress({
    step: 'decoding',
    progress: 1,
    projectId,
    projectName: metadata.name,
  });

  // Step 2: Stem separation (identical to runPipeline, including the
  // already-separated pre-check — inert today since this is always a fresh
  // project, but kept for consistency with the other two entry points).
  const stemsExist = await hasDrumStem(projectId);
  if (!stemsExist) {
    onProgress({
      step: 'separating',
      progress: 0,
      projectId,
      projectName: metadata.name,
    });
    await updateProject(projectId, {stage: 'separating'});
    await separateDrumsStep(projectId, metadata.name, onProgress);
  }
  onProgress({
    step: 'separating',
    progress: 1,
    projectId,
    projectName: metadata.name,
  });

  // Step 3: Tempo mapping is SKIPPED — the existing chart's own SyncTrack is
  // the provided grid (never a model-predicted one).

  // Step 4: Transcription, chart-built against the PROVIDED grid.
  onProgress({
    step: 'transcribing',
    progress: 0,
    projectId,
    projectName: metadata.name,
  });
  await updateProject(projectId, {stage: 'transcribing'});

  const drumAudioStereo = await loadTranscriptionAudio48k(projectId);
  const result: TranscriptionResult = await txr.transcribe(
    drumAudioStereo,
    CRNN_SAMPLE_RATE,
    txrProgress => {
      onProgress({
        step: 'transcribing',
        progress: txrProgress.percent,
        projectId,
        projectName: metadata.name,
      });
    },
  );

  const finalChartDoc = buildChartDocumentFromExistingChart(
    chartDoc,
    result.events,
    result.durationSeconds,
  );

  // The chart-flow feature preserves the source chart's own format (see
  // buildChartDocumentFromExistingChart) — a MIDI-sourced upload produces
  // notes.mid here, not notes.chart. Find by content type, not by a
  // hardcoded name, so both formats write out symmetrically.
  const files = writeChartFolder(finalChartDoc);
  const chartFile = files.find(
    f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
  );
  if (!chartFile) {
    throw new Error('writeChartFolder did not produce a chart file');
  }

  const confidenceData = buildConfidenceData(
    result.events,
    finalChartDoc.parsedChart.tempos,
    finalChartDoc.parsedChart.resolution || RESOLUTION,
    'chart',
  );
  await writeProjectJSON(projectId, 'confidence.json', confidenceData);
  await writeProjectBinary(projectId, chartFile.fileName, chartFile.data);

  await updateProject(projectId, {stage: 'editing', gridSource: 'provided'});

  onProgress({
    step: 'ready',
    progress: 1,
    projectId,
    projectName: metadata.name,
  });

  return projectId;
}

/**
 * Resume a pipeline for an existing project that was interrupted.
 *
 * Checks which steps are complete and resumes from the first incomplete step.
 */
export async function resumePipeline(
  projectId: string,
  onProgress: PipelineProgressCallback,
  transcriber?: DrumTranscriber,
): Promise<string> {
  const txr = transcriber ?? createDefaultTranscriber();

  const meta = await getProject(projectId);

  // Check what's already done
  const hasAudio = await hasStoredAudio(projectId);
  const hasStems = await hasDrumStem(projectId);
  const hasChart = await hasProjectChartFile(projectId);

  if (!hasAudio) {
    throw new Error(
      `Project ${projectId} has no audio stored. Cannot resume pipeline.`,
    );
  }

  // This generic resume path always rebuilds the chart against a freshly
  // predicted tempo map (see Step 3/4 below) — it doesn't know how to
  // reconstruct an existing-chart project's original ParsedChart (other
  // tracks, sections, ini fields). Resuming an interrupted "existing chart"
  // pipeline that way would silently drop the provided-grid guarantee, so
  // refuse rather than corrupt it; the user re-uploads the chart package
  // instead (chart-flow resume is a known follow-up, not yet supported).
  if (meta.gridSource === 'provided' && !hasChart) {
    throw new Error(
      'This project was created from an existing chart and was interrupted ' +
        'before finishing. Resuming an existing-chart pipeline is not yet ' +
        'supported — please re-upload the chart package to restart it.',
    );
  }

  // Step 2: Stem separation (if needed)
  if (!hasStems) {
    onProgress({
      step: 'separating',
      progress: 0,
      projectId,
      projectName: meta.name,
    });

    await updateProject(projectId, {stage: 'separating'});
    await separateDrumsStep(projectId, meta.name, onProgress);
  }

  // Step 3: Tempo mapping (if needed). Resumed projects have no source
  // bytes in scope (only OPFS PCM), so the tempo worker's stem cache
  // isn't seeded — the pre-separated stem still avoids re-separation.
  let synctrack: Synctrack | null = null;
  let sections: LinkSegSections | null = null;
  if (!hasChart) {
    const st = await ensureSynctrack(projectId, meta.name, null, onProgress);
    synctrack = st?.synctrack ?? null;
    sections = st?.sections ?? null;
  }

  // Step 4: Transcription (if needed)
  if (!hasChart) {
    onProgress({
      step: 'transcribing',
      progress: 0,
      projectId,
      projectName: meta.name,
    });

    await updateProject(projectId, {stage: 'transcribing'});

    // Load stereo audio for transcription (drum stem or full mix, at 48 kHz)
    const drumAudioStereo = await loadTranscriptionAudio48k(projectId);

    const result: TranscriptionResult = await txr.transcribe(
      drumAudioStereo,
      CRNN_SAMPLE_RATE,
      txrProgress => {
        onProgress({
          step: 'transcribing',
          progress: txrProgress.percent,
          projectId,
          projectName: meta.name,
        });
      },
    );

    const phaseAlignOut: {result?: PhaseAlignResult} = {};
    const chartDoc = buildChartDocument(
      result.events,
      meta.name,
      result.durationSeconds,
      synctrack,
      sections,
      loadPhaseAlignConfig(),
      phaseAlignOut,
    );

    const files = writeChartFolder(chartDoc);
    const chartFile = files.find(
      f => f.fileName === 'notes.chart' || f.fileName === 'notes.mid',
    );
    if (!chartFile) {
      throw new Error('writeChartFolder did not produce a chart file');
    }

    // Write confidence.json before the chart file: the chart file's presence
    // is the resume gate, so writing it last guarantees a crash never leaves
    // the chart present with confidence.json missing on resume. Both derive
    // from the same events and tempo map — the SAME phase-align shift
    // buildChartDocument applied above.
    const confidenceData = buildConfidenceData(
      result.events,
      chartDoc.parsedChart.tempos,
      RESOLUTION,
      'audio',
      phaseAlignOut.result?.shiftMs ?? 0,
    );
    await writeProjectJSON(projectId, 'confidence.json', confidenceData);
    await writeProjectBinary(projectId, chartFile.fileName, chartFile.data);
  }

  await updateProject(projectId, {stage: 'editing', gridSource: 'predicted'});

  onProgress({
    step: 'ready',
    progress: 1,
    projectId,
    projectName: meta.name,
  });

  return projectId;
}

// ---------------------------------------------------------------------------
// Regeneration
// ---------------------------------------------------------------------------

/**
 * Derived artifacts deleted by {@link regenerateProject} so that
 * {@link resumePipeline}'s gates recompute the tempo map and predicted notes.
 * Covers both chart formats plus their edited (autosave) variants — the
 * edited variant must go too, since findProjectChartFile prefers it and a
 * leftover one would shadow the regenerated chart.
 */
export const REGENERATED_ARTIFACT_FILES: readonly string[] = [
  SYNCTRACK_FILE,
  'confidence.json',
  'review-progress.json',
  CHART_FILE_BASENAMES.chart,
  CHART_FILE_BASENAMES.mid,
  editedVariant(CHART_FILE_BASENAMES.chart),
  editedVariant(CHART_FILE_BASENAMES.mid),
];

/**
 * Regenerate a project's beat grid (predicted tempo map) and predicted notes
 * from its stored audio, discarding all edits and review progress.
 *
 * The separated drum stem is reused from the fingerprint-keyed stem cache
 * (resumePipeline's separation gate sees it as already done), so this only
 * re-runs tempo mapping + transcription — no GPU separation.
 *
 * Only valid for predicted-grid projects: a provided-grid (chart-flow)
 * project's grid is the user's own chart, and this generic path cannot
 * reconstruct its original ParsedChart (same restriction as resume).
 */
export async function regenerateProject(
  projectId: string,
  onProgress: PipelineProgressCallback,
  transcriber?: DrumTranscriber,
): Promise<string> {
  const meta = await getProject(projectId);
  if (meta.gridSource === 'provided') {
    throw new Error(
      'This project was created from an existing chart; its grid came from ' +
        'that chart, so there is nothing to regenerate.',
    );
  }

  for (const fileName of REGENERATED_ARTIFACT_FILES) {
    await deleteProjectFile(projectId, fileName);
  }
  await updateProject(projectId, {stage: 'transcribing'});

  return resumePipeline(projectId, onProgress, transcriber);
}

// ---------------------------------------------------------------------------
// Transcriber selection
// ---------------------------------------------------------------------------

/**
 * Creates the default transcriber — uses CrnnTranscriber (CRNN model).
 * The constructor is safe to call without ONNX loaded; it only
 * accesses the runtime during transcribe() via the Web Worker.
 */
function createDefaultTranscriber(): DrumTranscriber {
  return new CrnnTranscriber();
}

// Chart document construction lives in ./chart-builder (unit-testable
// without pulling in the transcriber/worker machinery).
