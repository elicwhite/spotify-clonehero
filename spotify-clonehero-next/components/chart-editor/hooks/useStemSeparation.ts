'use client';

/**
 * Runs the `separate-stems` task for the editor's two on-demand surfaces
 * (plan 0123), and packages what both of them need into the single object
 * `ChartEditor` threads down.
 *
 * Not `useAssistTaskRun`: that hook builds its input before the click and
 * reports one fixed `entrypoint`, and this run needs the model the user
 * chose and the surface they chose it from. Everything else — start on the
 * editor's shared runner, stay silent on cancel because the run card already
 * says "Cancelled.", toast on failure — matches it deliberately.
 *
 * Nothing is applied on success. The task's product is the stem cache, and
 * `useSeparatedStems` is already watching the runner for a separating task to
 * finish; it re-probes and the stems appear on the mixer.
 */

import {useCallback} from 'react';
import {toast} from 'sonner';

import {useAssistRunActivity} from '@/components/assist/useAssistRunner';
import type {AssistRunnerControls} from '@/components/assist/useAssistRunner';
import {
  separateStemsTask,
  type StemSeparationModel,
} from '@/lib/assist/tasks/separate-stems';
import type {LoadAssistAudio} from '@/lib/assist/tasks/types';
import {isAbortError} from '@/lib/workers/abortable-worker';
import {selectReportedOrigin} from '@/lib/chart-editor-core';
import {useWebGpuFp16Block} from '@/components/onnx/useWebGpuFp16';
import {blockedControlReason} from '@/components/onnx/webgpu-block';

import {useChartEditorContext} from '../ChartEditorContext';
import type {
  StemSeparationHostProps,
  StemSeparationRequest,
} from '../stemSeparation';
import type {StemSeparationOffer} from './useSeparatedStems';

export interface UseStemSeparationParams {
  /** The editor's shared assist runner. Required, not optional: the run
   *  activity is a subscription, and a hook cannot subscribe conditionally.
   *  A host with no runner simply does not call this. */
  runner: AssistRunnerControls;
  /** The host's assist-audio loader, or null when it has no audio to split. */
  loadAudio: LoadAssistAudio | null | undefined;
  /** Which separators would still add a stem, from `useSeparatedStems`. */
  offer: StemSeparationOffer;
  /** Set while the host is rebuilding its padded audio, so the buttons can
   *  explain why they are dead rather than starting a run against audio that
   *  is about to be replaced. Applies to every model; the per-model limit
   *  this hook adds is the graphics card's. */
  disabledReason?: string | undefined;
}

/**
 * The host object for `ChartEditor.stemSeparation`, or undefined when this
 * host cannot separate at all — which is what makes both surfaces draw
 * nothing without either of them knowing why.
 */
export function useStemSeparation({
  runner,
  loadAudio,
  offer,
  disabledReason,
}: UseStemSeparationParams): StemSeparationHostProps | undefined {
  const webGpuBlocked = useWebGpuFp16Block();
  const {state} = useChartEditorContext();
  const origin = selectReportedOrigin(state);
  // Subscribed to the run's identity only (task + status), never its steps,
  // so a run in flight never re-renders the editor on a progress tick — the
  // inline run card is the one component that does.
  const activity = useAssistRunActivity(runner.store);

  const onSeparate = useCallback(
    ({model, entrypoint}: StemSeparationRequest) => {
      if (!loadAudio) return;
      void (async () => {
        try {
          await runner.start(
            separateStemsTask,
            {audio: await loadAudio(), model},
            {origin, entrypoint},
          );
          toast.success('Stems separated');
        } catch (e) {
          if (isAbortError(e)) return;
          toast.error(e instanceof Error ? e.message : String(e));
        }
      })();
    },
    [runner, loadAudio, origin],
  );

  // Only BS-Roformer has fp16 weights. Demucs is fp32 and runs on any
  // adapter — and on the CPU when there is none — so a graphics card without
  // `shader-f16` loses the "great and slow" option and keeps the other one.
  // The host's own reason stops both. `blockedControlReason` owns which of
  // the two the user reads, the same way it does for the Chart Assist cards.
  const disabledReasonFor = useCallback(
    (model: StemSeparationModel): string | undefined =>
      blockedControlReason(
        model === 'roformer' ? webGpuBlocked : null,
        disabledReason,
        'this one',
      ),
    [disabledReason, webGpuBlocked],
  );

  if (!loadAudio) return undefined;

  return {
    offer,
    running:
      activity.task === separateStemsTask.key && activity.status === 'running',
    disabledReasonFor,
    onSeparate,
    store: runner.store,
    onCancel: runner.cancel,
    onDismiss: runner.dismiss,
  };
}
