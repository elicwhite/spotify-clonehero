/**
 * Individual stages of the drum-transcription pipeline, plus the progress
 * contract they report through.
 *
 * Each function here does one thing (store the upload, load transcription
 * audio, separate the drum stem, ensure a synctrack) and knows nothing about
 * the order stages run in. `runner.ts` owns that ordering — the three entry
 * points (fresh upload / existing chart / resume+regenerate) differ only in
 * which of these they call and what they do with the results.
 */

import {
  loadFullMixPcm,
  projectFileExists,
  readProjectJSON,
  storeAudioOriginal,
  writeProjectJSON,
} from '../storage/opfs';
import {TARGET_SAMPLE_RATE, type AudioMetadata} from '../audio/types';
import {separateDrums, loadDrumStem} from '../ml/roformer-separation';
import type {DrumSeparationProgress} from '@/lib/audio-pipeline/separate-stems';
import {planarStereoToCrnnInput} from './crnn-audio-prep';
import {runTempoPipelineFromPcm} from '@/lib/tempo-map/pipeline-client';
import type {
  LinkSegSections,
  PipelineProgress as TempoPipelineProgress,
  Synctrack,
} from '@/lib/tempo-map/types';
import {isAbortError, makeAbortError} from '@/lib/workers/abortable-worker';
import {DEFAULT_BPM, type StoredSynctrack} from './chart-builder';

// ---------------------------------------------------------------------------
// Progress contract
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

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw makeAbortError();
}

// ---------------------------------------------------------------------------
// Upload storage (original audio at rest)
// ---------------------------------------------------------------------------

/**
 * Stores a freshly uploaded audio file verbatim ({@link storeAudioOriginal})
 * — the only audio storage new uploads use. Fingerprinting for the shared
 * stem cache hashes these same bytes; conversion to Opus, if needed, happens
 * only at export.
 */
export async function storeUploadedAudioOriginal(
  projectId: string,
  sourceBytes: ArrayBuffer,
  metadata: AudioMetadata,
  samplesPerChannel: number,
): Promise<void> {
  await storeAudioOriginal(projectId, sourceBytes, metadata, samplesPerChannel);
}

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
export async function loadTranscriptionAudio48k(
  projectId: string,
): Promise<Float32Array> {
  let interleaved44k: Float32Array;
  try {
    interleaved44k = await loadDrumStem(projectId);
  } catch {
    // Stems unavailable (e.g. separation was skipped/failed):
    // fall back to the full audio mix (already stereo interleaved).
    interleaved44k = await loadFullMixPcm(projectId);
  }

  const {left, right} = deinterleaveStereo(interleaved44k);
  return planarStereoToCrnnInput(left, right, TARGET_SAMPLE_RATE);
}

/** Splits an interleaved stereo buffer into planar channels. */
function deinterleaveStereo(interleaved: Float32Array): {
  left: Float32Array;
  right: Float32Array;
} {
  const n = Math.floor(interleaved.length / 2);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = interleaved[i * 2];
    right[i] = interleaved[i * 2 + 1];
  }
  return {left, right};
}

// ---------------------------------------------------------------------------
// Stem separation
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
 * failing the whole pipeline. Shared by all three entry points in runner.ts —
 * each still owns its own "already separated? skip" pre-check and progress
 * bracketing, since that differs slightly (e.g. runPipelineFromChart never
 * resumes).
 */
export async function separateDrumsStep(
  projectId: string,
  projectName: string,
  onProgress: PipelineProgressCallback,
  signal?: AbortSignal | undefined,
): Promise<void> {
  try {
    const storedAudio = await loadFullMixPcm(projectId);
    await separateDrums(
      projectId,
      storedAudio,
      sepProgress => {
        onProgress({
          step: 'separating',
          progress: separationProgressToFraction(sepProgress),
          etaSeconds: sepProgress.etaSeconds,
          projectId,
          projectName,
        });
      },
      signal,
    );
  } catch (err) {
    // A cancelled run is not a separation failure: propagate it so the
    // whole pipeline stops instead of falling back to the full mix.
    if (isAbortError(err)) throw err;
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

export interface SynctrackResult {
  synctrack: Synctrack;
  sections: LinkSegSections | null;
  /** Set in 'regenerate' mode, where the freshly predicted map is handed
   *  back instead of written: the caller persists it in the same write block
   *  as the run's other outputs, so a cancel leaves the project's existing
   *  map untouched. */
  pendingStored?: StoredSynctrack;
}

/**
 * How this run treats the project's persisted tempo map.
 *
 * - `'resume'`: reuse a persisted map when there is one, and persist a
 *   freshly predicted map immediately so an interruption later in the run
 *   doesn't throw the tempo-mapping work away.
 * - `'regenerate'`: ignore any persisted map, predict a fresh one, and hand
 *   it back in {@link SynctrackResult.pendingStored} rather than writing it,
 *   so a cancelled regeneration leaves the existing map in place.
 */
export type SynctrackMode = 'resume' | 'regenerate';

export interface EnsureSynctrackOptions {
  signal?: AbortSignal | undefined;
  mode?: SynctrackMode | undefined;
}

/**
 * Ensure a synctrack exists for the project, running the tempo-map pipeline
 * if needed.
 *
 * Reuses the already-separated transcription drum stem (mono mean of the
 * stored stereo stem — identical to the tempo worker's own mono separation
 * output) so the tempo pipeline never runs a second GPU separation.
 *
 * Returns null on failure — the caller falls back to a flat-tempo chart.
 */
export async function ensureSynctrack(
  projectId: string,
  projectName: string,
  sourceBytes: ArrayBuffer | null,
  onProgress: PipelineProgressCallback,
  options: EnsureSynctrackOptions = {},
): Promise<SynctrackResult | null> {
  const {signal, mode = 'resume'} = options;
  throwIfAborted(signal);

  if (
    mode === 'resume' &&
    (await projectFileExists(projectId, SYNCTRACK_FILE))
  ) {
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
    const fullMix = deinterleaveStereo(await loadFullMixPcm(projectId));

    // Planar stereo drum stem from the transcription stem, when present.
    let drumStemStereo: {left: Float32Array; right: Float32Array} | null = null;
    try {
      const stem = deinterleaveStereo(await loadDrumStem(projectId));
      if (stem.left.length === fullMix.left.length) {
        drumStemStereo = stem;
      }
    } catch {
      // No stem stored (separation skipped/failed): the tempo worker will
      // separate on its own (or fail, which we catch below).
    }

    const result = await runTempoPipelineFromPcm(
      {...fullMix, sampleRate: TARGET_SAMPLE_RATE},
      {
        // Detached buffers (decodeAudioData) have byteLength 0 — skip them.
        sourceBytes:
          sourceBytes && sourceBytes.byteLength > 0 ? sourceBytes : null,
        drumStemStereo,
        signal,
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
    if (mode === 'resume') {
      await writeProjectJSON(projectId, SYNCTRACK_FILE, stored);
    }

    onProgress({step: 'tempo-mapping', progress: 1, projectId, projectName});
    return {
      synctrack: result.synctrack,
      sections: result.sections,
      ...(mode === 'regenerate' ? {pendingStored: stored} : {}),
    };
  } catch (err) {
    // A cancelled run is not a tempo-mapping failure: propagate it instead
    // of falling back to a flat-tempo chart.
    if (isAbortError(err)) throw err;
    console.warn(
      `Tempo mapping failed, falling back to a flat ${DEFAULT_BPM} BPM chart:`,
      err,
    );
    onProgress({step: 'tempo-mapping', progress: 1, projectId, projectName});
    return null;
  }
}
