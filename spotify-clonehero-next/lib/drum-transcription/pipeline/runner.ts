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
  writeProjectText,
  writeProjectJSON,
  readProjectJSON,
  projectFileExists,
  type ProjectMetadata,
} from '../storage/opfs';
import {
  separateDrums,
  hasDrumStem,
  loadDrumStem,
  type DrumSeparationProgress,
} from '../ml/roformer-separation';
import {resampleSoxr} from '@/lib/tempo-map/resampler-soxr';
import {runTempoPipelineFromPcm} from '@/lib/tempo-map/pipeline-client';
import type {
  PipelineProgress as TempoPipelineProgress,
  Synctrack,
} from '@/lib/tempo-map/types';
import {CrnnTranscriber, type DrumTranscriber} from '../ml/transcriber';
import {writeChartFolder} from '@/lib/chart-edit';
import {
  buildChartDocument,
  buildConfidenceData,
  RESOLUTION,
  DEFAULT_BPM,
  type StoredSynctrack,
} from './chart-builder';
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

/** The stereo CRNN model consumes 48 kHz audio (mel: 1024 FFT / 480 hop). */
const CRNN_SAMPLE_RATE = 48000;

/**
 * Load the audio to transcribe (drum stem if separated, else full mix) and
 * resample it to interleaved stereo at 48 kHz for the CRNN transcriber.
 *
 * Both the stored drum stem and stored full-mix audio are interleaved stereo
 * at TARGET_SAMPLE_RATE (44.1 kHz); each channel is resampled independently
 * with libsoxr (Web Audio's resampler is too lossy) and re-interleaved.
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

  const [left48, right48] = await Promise.all([
    resampleSoxr(left, TARGET_SAMPLE_RATE, CRNN_SAMPLE_RATE),
    resampleSoxr(right, TARGET_SAMPLE_RATE, CRNN_SAMPLE_RATE),
  ]);

  const outN = Math.min(left48.length, right48.length);
  const stereo48k = new Float32Array(outN * 2);
  for (let i = 0; i < outN; i++) {
    stereo48k[i * 2] = left48[i];
    stereo48k[i * 2 + 1] = right48[i];
  }
  return stereo48k;
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

// ---------------------------------------------------------------------------
// Tempo mapping (reuses the /tempo pipeline)
// ---------------------------------------------------------------------------

const SYNCTRACK_FILE = 'synctrack.json';

/** Sub-ranges of the 'tempo-mapping' step assigned to each tempo-pipeline
 * stage, so the dialog's bar moves monotonically through the whole step. */
const TEMPO_STAGE_RANGES: Record<
  TempoPipelineProgress['stage'],
  [number, number]
> = {
  'download-separation-model': [0, 0.05],
  separate: [0.05, 0.3],
  'download-beat-model': [0.3, 0.4],
  'beats-fullmix': [0.4, 0.65],
  'beats-drums': [0.65, 0.95],
  convert: [0.95, 1],
};

const TEMPO_STAGE_DETAIL: Record<TempoPipelineProgress['stage'], string> = {
  'download-separation-model': 'Downloading separation model',
  separate: 'Separating drums',
  'download-beat-model': 'Downloading beat-detection model',
  'beats-fullmix': 'Detecting beats (full mix)',
  'beats-drums': 'Detecting beats (drum stem)',
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
async function ensureSynctrack(
  projectId: string,
  projectName: string,
  sourceBytes: ArrayBuffer | null,
  onProgress: PipelineProgressCallback,
): Promise<Synctrack | null> {
  if (await projectFileExists(projectId, SYNCTRACK_FILE)) {
    try {
      const stored = await readProjectJSON<StoredSynctrack>(
        projectId,
        SYNCTRACK_FILE,
      );
      if (stored?.synctrack) return stored.synctrack;
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
    };
    await writeProjectJSON(projectId, SYNCTRACK_FILE, stored);

    onProgress({step: 'tempo-mapping', progress: 1, projectId, projectName});
    return result.synctrack;
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

    try {
      // Load the interleaved audio from OPFS
      const storedAudio = await loadAudioForDemucs(projectId);

      await separateDrums(projectId, storedAudio, sepProgress => {
        onProgress({
          step: 'separating',
          progress: separationProgressToFraction(sepProgress),
          etaSeconds: sepProgress.etaSeconds,
          projectId,
          projectName: metadata.name,
        });
      });
    } catch (err) {
      // Stem separation failed. Log the full error for debugging,
      // then continue — transcription will use the full audio mix.
      console.warn('Stem separation failed, continuing with full mix:', err);
      onProgress({
        step: 'separating',
        progress: 1,
        projectId,
        projectName: metadata.name,
      });
    }
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
  const chartExists = await projectFileExists(projectId, 'notes.chart');
  let synctrack: Synctrack | null = null;
  if (!chartExists) {
    synctrack = await ensureSynctrack(
      projectId,
      metadata.name,
      sourceBytes,
      onProgress,
    );
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
    // map (or flat DEFAULT_BPM when tempo mapping failed).
    const chartDoc = buildChartDocument(
      result.events,
      metadata.name,
      result.durationSeconds,
      synctrack,
    );

    // Serialize chart to .chart format.
    const files = writeChartFolder(chartDoc);
    const chartFile = files.find(f => f.fileName === 'notes.chart');
    if (!chartFile) {
      throw new Error('writeChartFolder did not produce notes.chart');
    }
    const chartText = new TextDecoder().decode(chartFile.data);

    // Write confidence.json before notes.chart: notes.chart is the resume
    // gate, so writing it last guarantees a crash never leaves the chart
    // present with confidence.json missing on resume. Both derive from the
    // same events and tempo map.
    const confidenceData = buildConfidenceData(
      result.events,
      chartDoc.parsedChart.tempos,
      RESOLUTION,
    );
    await writeProjectJSON(projectId, 'confidence.json', confidenceData);
    await writeProjectText(projectId, 'notes.chart', chartText);
  }

  // Mark project as ready for editing
  await updateProject(projectId, {stage: 'editing'});

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

  const {getProject} = await import('../storage/opfs');
  const meta = await getProject(projectId);

  // Check what's already done
  const hasAudio = await hasStoredAudio(projectId);
  const hasStems = await hasDrumStem(projectId);
  const hasChart = await projectFileExists(projectId, 'notes.chart');

  if (!hasAudio) {
    throw new Error(
      `Project ${projectId} has no audio stored. Cannot resume pipeline.`,
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

    try {
      const storedAudio = await loadAudioForDemucs(projectId);

      await separateDrums(projectId, storedAudio, sepProgress => {
        onProgress({
          step: 'separating',
          progress: separationProgressToFraction(sepProgress),
          projectId,
          projectName: meta.name,
        });
      });
    } catch (err) {
      console.warn('Stem separation failed, continuing with full mix:', err);
      onProgress({
        step: 'separating',
        progress: 1,
        projectId,
        projectName: meta.name,
      });
    }
  }

  // Step 3: Tempo mapping (if needed). Resumed projects have no source
  // bytes in scope (only OPFS PCM), so the tempo worker's stem cache
  // isn't seeded — the pre-separated stem still avoids re-separation.
  let synctrack: Synctrack | null = null;
  if (!hasChart) {
    synctrack = await ensureSynctrack(projectId, meta.name, null, onProgress);
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

    const chartDoc = buildChartDocument(
      result.events,
      meta.name,
      result.durationSeconds,
      synctrack,
    );

    const files = writeChartFolder(chartDoc);
    const chartFile = files.find(f => f.fileName === 'notes.chart');
    if (!chartFile) {
      throw new Error('writeChartFolder did not produce notes.chart');
    }
    const chartText = new TextDecoder().decode(chartFile.data);

    // Write confidence.json before notes.chart: notes.chart is the resume
    // gate, so writing it last guarantees a crash never leaves the chart
    // present with confidence.json missing on resume. Both derive from the
    // same events and tempo map.
    const confidenceData = buildConfidenceData(
      result.events,
      chartDoc.parsedChart.tempos,
      RESOLUTION,
    );
    await writeProjectJSON(projectId, 'confidence.json', confidenceData);
    await writeProjectText(projectId, 'notes.chart', chartText);
  }

  await updateProject(projectId, {stage: 'editing'});

  onProgress({
    step: 'ready',
    progress: 1,
    projectId,
    projectName: meta.name,
  });

  return projectId;
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
