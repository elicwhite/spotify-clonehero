/**
 * The step-progress -> ProcessingStep[] adapter (plan 0074 Phase 1). The
 * single implementation: every surface that renders a step list, in-editor
 * or on a home screen, goes through here.
 *
 * A task drives `ProcessingView`'s step list from its OWN planned step list,
 * so the same per-step wall-clock tracking and
 * worker-ETA-passthrough-with-EMA-fallback serve any pipeline. The
 * drum-transcription pipeline's own step tables and progress mapping live in
 * `lib/drum-transcription/pipeline/step-mapping.ts`.
 */

import type {ProcessingStep} from '@/components/processing/StepRow';

/** One step in a task's step list, as predicted by `AssistTaskDef.planSteps`. */
export interface PlannedStep {
  key: string;
  label: string;
  description?: string | undefined;
  /**
   * True when an existence probe determined this step's work is already
   * cached and `run()` will skip it entirely. A cached step always renders
   * as instantly-done with a "cached" detail note, regardless of where the
   * active step currently is in the rest of the list.
   */
  cached?: boolean | undefined;
}

/**
 * One progress tick from a task's `run()`. `activeKey` names the currently
 * in-flight step (must match a `PlannedStep.key`); `null` with
 * `terminal: 'done'` means the whole run finished successfully (renders
 * every non-cached step as done); `null` with no `terminal` means nothing
 * is in flight (idle/error — mirrors the drum-transcription pipeline's
 * 'idle'/'error' states).
 */
export interface StepProgressEvent {
  activeKey: string | null;
  terminal?: 'done' | undefined;
  /** 0..1 progress within the active step. */
  progress?: number | undefined;
  /** Estimated seconds remaining in the active step, when the source has one. */
  etaSeconds?: number | undefined;
  /** Dynamic detail line for the active step. */
  detail?: string | undefined;
}

interface PerStepTiming {
  startedAt?: number;
  completedAt?: number;
  /** Single-pole low-pass smoothed ETA seconds. */
  smoothedEtaSeconds?: number;
}

export type StepTimer = Map<string, PerStepTiming>;

export function createStepTimer(): StepTimer {
  return new Map();
}

const ETA_SMOOTH_ALPHA = 0.3;

/**
 * Index of the active step among `plannedSteps`, with terminal states
 * normalized: `terminal: 'done'` means every step is behind us (render all
 * as done, not stuck), while `activeKey: null` with no terminal reports -1
 * (nothing in flight).
 */
function activeStepIndex(
  plannedSteps: readonly PlannedStep[],
  event: StepProgressEvent,
): number {
  if (event.terminal === 'done') return plannedSteps.length;
  if (event.activeKey === null) return -1;
  return plannedSteps.findIndex(s => s.key === event.activeKey);
}

export function stepProgressToSteps(
  plannedSteps: readonly PlannedStep[],
  event: StepProgressEvent,
  timer: StepTimer,
  now: number = Date.now(),
): ProcessingStep[] {
  const currentIndex = activeStepIndex(plannedSteps, event);

  return plannedSteps.map((cfg, index) => {
    if (cfg.cached) {
      return {
        key: cfg.key,
        label: cfg.label,
        description: cfg.description,
        status: 'done',
        detail: 'cached',
      };
    }

    const timing = timer.get(cfg.key) ?? {};
    let status: ProcessingStep['status'];
    let stepProgress: number | undefined;
    let etaSeconds: number | undefined;
    let durationMs: number | undefined;
    let detail: string | undefined;

    if (currentIndex < 0) {
      // Nothing in flight (idle/error).
      status = 'pending';
    } else if (index < currentIndex) {
      status = 'done';
      durationMs =
        timing.startedAt !== undefined && timing.completedAt !== undefined
          ? timing.completedAt - timing.startedAt
          : undefined;
    } else if (index === currentIndex) {
      status = 'active';
      stepProgress = event.progress;
      detail = event.detail;
      // Track step start the first time we see it active.
      if (timing.startedAt === undefined) {
        timing.startedAt = now;
        timer.set(cfg.key, timing);
      }
      // Prefer a source-provided ETA (e.g. the separation worker's own
      // segment-duration EMA) over the elapsed*(1-p)/p fallback below.
      if (event.etaSeconds !== undefined) {
        etaSeconds = event.etaSeconds;
      } else if (
        stepProgress !== undefined &&
        stepProgress > 0.05 &&
        timing.startedAt !== undefined
      ) {
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
 * Mark all non-cached steps before the active one as completed in the
 * timer. Used when a run transitions forward — the source emits progress
 * on the new step but doesn't separately notify us that the previous one
 * finished.
 */
export function markStepCompletions(
  plannedSteps: readonly PlannedStep[],
  event: StepProgressEvent,
  timer: StepTimer,
  now: number = Date.now(),
): void {
  const currentIndex = activeStepIndex(plannedSteps, event);
  if (currentIndex < 0) return;
  for (let i = 0; i < currentIndex; i++) {
    const cfg = plannedSteps[i];
    if (cfg.cached) continue;
    const timing = timer.get(cfg.key) ?? {};
    if (timing.completedAt === undefined) {
      timing.completedAt = now;
      // If we never saw `startedAt` (skipped past instantly), use `now` so
      // durationMs is non-negative.
      if (timing.startedAt === undefined) timing.startedAt = now;
      timer.set(cfg.key, timing);
    }
  }
}
