/**
 * The drum-transcription pipeline's progress, expressed in the assist
 * engine's reporting vocabulary (`run-to-steps.ts`).
 *
 * `runner.ts` reports a single `{step, progress}` enum + scalar. The
 * `transcribe-drums` task projects it through this one mapper onto the step
 * table its run needs — the full pipeline (five steps) for the
 * `/drum-transcription` home screen's upload/chart/resume runs, the
 * regeneration subset (three steps) for the in-editor re-run — so there is
 * exactly one place where a pipeline step becomes a rendered step.
 *
 * This is drum-transcription-specific and therefore lives with the pipeline
 * it describes; `lib/assist/run-to-steps.ts` is the generic half.
 */

import type {PlannedStep, StepProgressEvent} from '@/lib/assist/run-to-steps';
import type {PipelineProgress} from './stages';

/**
 * The full pipeline as the home screen reports it, from a fresh upload
 * through transcription.
 */
export const PIPELINE_PLANNED_STEPS: readonly PlannedStep[] = [
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
 * The subset an in-editor regeneration reports: the audio is already stored
 * and decoded, so the run starts at separation. The runtime wait stays on
 * the list because a regeneration still waits for ONNX Runtime before its
 * first worker; dropping it would leave the card blank for that whole wait.
 */
export const REGENERATE_PLANNED_STEPS: readonly PlannedStep[] =
  PIPELINE_PLANNED_STEPS.filter(s => s.key !== 'decoding');

/**
 * One pipeline tick as a step event. 'ready' means the whole run finished;
 * 'idle'/'error' mean nothing is in flight. Any other step names itself —
 * a step a given step table doesn't list (e.g. 'decoding' during a
 * regeneration) resolves to "nothing in flight" for that table, which is
 * exactly right: that work isn't part of what the table promised to show.
 */
export function pipelineProgressToStepEvent(
  p: PipelineProgress,
): StepProgressEvent {
  if (p.step === 'ready') return {activeKey: null, terminal: 'done'};
  if (p.step === 'idle' || p.step === 'error') return {activeKey: null};
  return {
    activeKey: p.step,
    progress: p.progress,
    etaSeconds: p.etaSeconds,
    detail: p.detail,
  };
}
