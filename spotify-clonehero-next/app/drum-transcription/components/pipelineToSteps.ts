/**
 * Adapter: PipelineProgress → ProcessingStep[].
 *
 * The drum-transcription pipeline reports progress as a single
 * `{step, progress}` enum + scalar. ProcessingView consumes a normalized
 * step list. This module owns the mapping plus per-step wall-clock
 * tracking for `durationMs` (on completion) and `etaSeconds` (live
 * estimate during the active step).
 *
 * ETA strategy: prefer source-provided when the worker computes it
 * (Demucs already does, via EMA); otherwise fall back to
 * `elapsedSec * (1 - p) / p` smoothed with a single-pole low-pass.
 *
 * `StepTimer` is mutable on purpose: it lives in a useRef across
 * renders so smoothed ETA values aren't reset every tick.
 */

import type {ProcessingStep} from '@/components/ProcessingView';
import type {
  PipelineProgress,
  PipelineStep,
} from '@/lib/drum-transcription/pipeline/runner';

interface StepConfig {
  key: PipelineStep;
  label: string;
  description: string;
}

const PIPELINE_STEPS: StepConfig[] = [
  {
    key: 'loading-runtime',
    label: 'Loading ML Runtime',
    description: 'Loading ONNX Runtime and ML models',
  },
  {
    key: 'decoding',
    label: 'Decoding Audio',
    description: 'Converting to stereo PCM',
  },
  {
    key: 'separating',
    label: 'Separating Stems',
    description: 'Isolating drums with BS-Roformer (~336 MB model)',
  },
  {
    key: 'tempo-mapping',
    label: 'Building Tempo Map',
    description: 'Detecting beats and fitting tempo changes',
  },
  {
    key: 'transcribing',
    label: 'Transcribing Drums',
    description: 'Detecting drum hits with the CRNN model',
  },
];

/**
 * Index of the active step, with terminal states normalized: 'ready' means
 * every step is behind us (render all as done, not stuck), while
 * idle/error report -1 (nothing in flight).
 */
function activeStepIndex(progress: PipelineProgress): number {
  if (progress.step === 'ready') return PIPELINE_STEPS.length;
  return PIPELINE_STEPS.findIndex(s => s.key === progress.step);
}

interface PerStepTiming {
  startedAt?: number;
  completedAt?: number;
  /** Single-pole low-pass smoothed ETA seconds. */
  smoothedEtaSeconds?: number;
}

export type PipelineStepTimer = Map<PipelineStep, PerStepTiming>;

export function createPipelineStepTimer(): PipelineStepTimer {
  return new Map();
}

const ETA_SMOOTH_ALPHA = 0.3;

export function pipelineProgressToSteps(
  progress: PipelineProgress,
  timer: PipelineStepTimer,
  now: number = Date.now(),
): ProcessingStep[] {
  const currentIndex = activeStepIndex(progress);

  return PIPELINE_STEPS.map((cfg, index) => {
    const timing = timer.get(cfg.key) ?? {};
    let status: ProcessingStep['status'];
    let stepProgress: number | undefined;
    let etaSeconds: number | undefined;
    let durationMs: number | undefined;
    let detail: string | undefined;

    if (currentIndex < 0) {
      // Step is 'idle' / 'ready' / 'error' — nothing in flight.
      status = 'pending';
    } else if (index < currentIndex) {
      status = 'done';
      durationMs =
        timing.startedAt !== undefined && timing.completedAt !== undefined
          ? timing.completedAt - timing.startedAt
          : undefined;
    } else if (index === currentIndex) {
      status = 'active';
      stepProgress = progress.progress;
      detail = progress.detail;
      // Track step start the first time we see it active.
      if (timing.startedAt === undefined) {
        timing.startedAt = now;
        timer.set(cfg.key, timing);
      }
      // Prefer worker-provided ETA when present (Demucs computes one
      // from segment-duration EMA). Fall back to elapsed * (1-p)/p
      // smoothed when only `progress` is available.
      if (progress.etaSeconds !== undefined) {
        etaSeconds = progress.etaSeconds;
      } else if (stepProgress > 0.05 && timing.startedAt !== undefined) {
        const elapsedSec = (now - timing.startedAt) / 1000;
        const rawEta = (elapsedSec * (1 - stepProgress)) / stepProgress;
        const prev = timing.smoothedEtaSeconds ?? rawEta;
        const smoothed =
          prev * (1 - ETA_SMOOTH_ALPHA) + rawEta * ETA_SMOOTH_ALPHA;
        timing.smoothedEtaSeconds = smoothed;
        timer.set(cfg.key, timing);
        etaSeconds = smoothed;
      }
    } else {
      status = 'pending';
    }

    return {
      key: cfg.key,
      label: cfg.label,
      description: cfg.description,
      status,
      progress: stepProgress,
      etaSeconds,
      durationMs,
      detail,
    };
  });
}

/**
 * Mark all steps before/equal to `currentStep` as completed in the
 * timer. Used when the pipeline transitions forward — the runner emits
 * progress on the new step but doesn't separately notify us that the
 * previous one finished.
 */
export function markStepCompletions(
  progress: PipelineProgress,
  timer: PipelineStepTimer,
  now: number = Date.now(),
): void {
  const currentIndex = activeStepIndex(progress);
  if (currentIndex < 0) return;
  for (let i = 0; i < currentIndex; i++) {
    const cfg = PIPELINE_STEPS[i];
    const timing = timer.get(cfg.key) ?? {};
    if (timing.completedAt === undefined) {
      timing.completedAt = now;
      // If we never saw `startedAt` (skipped past instantly), use now -1ms
      // so durationMs is non-negative.
      if (timing.startedAt === undefined) timing.startedAt = now;
      timer.set(cfg.key, timing);
    }
  }
}
