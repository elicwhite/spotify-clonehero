'use client';

/**
 * The run lifecycle every "run this task from a card" surface shares (plan
 * 0074 Design B/F): build the task's context, run it on the editor's shared
 * runner, apply the result, and report the outcome.
 *
 * Cancellation is deliberately silent — the run card the caller renders
 * already says "Cancelled.", so a toast would be a second voice saying the
 * same thing.
 *
 * `running` is true only while THIS task's run is IN FLIGHT. A finished run's
 * card lingers for a moment to show its outcome, and callers hide their
 * action only while `running`, so a cancelled run can be restarted without
 * waiting for that message to clear. It comes from
 * {@link useAssistRunActivity}, whose snapshot ignores step progress, so a
 * run in flight never re-renders the card several times a second.
 */

import {toast} from 'sonner';

import type {AssistTaskDef} from '@/lib/assist/tasks/types';
import {isAbortError} from '@/lib/workers/abortable-worker';
import {
  useAssistRunActivity,
  type AssistRunnerControls,
} from '@/components/assist/useAssistRunner';
import {selectReportedOrigin} from '@/lib/chart-editor-core';
import {useChartEditorContext} from '../ChartEditorContext';

export interface AssistTaskRunOptions<Result, Input> {
  /** Builds the task's input. Async so a caller can load audio bytes (or
   *  anything else the task needs) first; a failure here is reported the
   *  same way a failed run is. */
  prepareInput: () => Promise<Input>;
  /** Applies a successful run's result — typically executing the command
   *  that installs it. */
  applyResult: (result: Result) => void;
  /** Success toast copy. A function is given the run's result, so a task
   *  whose outcome varies can say what it actually did; returning null
   *  raises no toast, for a run that applied nothing and has already said so
   *  from `applyResult`. */
  successMessage: string | ((result: Result) => string | null);
}

export interface AssistTaskRun {
  /** True while this task's run is in flight. */
  running: boolean;
  /** Starts the run. Safe to hand straight to an `onClick`. */
  run: () => void;
}

export function useAssistTaskRun<Result, Input>(
  runner: AssistRunnerControls,
  task: AssistTaskDef<Result, Input>,
  {
    prepareInput,
    applyResult,
    successMessage,
  }: AssistTaskRunOptions<Result, Input>,
): AssistTaskRun {
  const activity = useAssistRunActivity(runner.store);
  // Both analytics dimensions are properties of this hook's situation, not of
  // its callers: it only ever renders inside the editor, and it only ever
  // serves the Chart Assist cards. Asking four cards to pass them would be
  // four chances to pass the wrong one (plan 0105).
  const {state} = useChartEditorContext();

  async function start(): Promise<void> {
    try {
      const result = await runner.start(task, await prepareInput(), {
        origin: selectReportedOrigin(state),
        entrypoint: 'assist-card',
      });
      applyResult(result);
      const message =
        typeof successMessage === 'function'
          ? successMessage(result)
          : successMessage;
      if (message !== null) toast.success(message);
    } catch (e) {
      if (isAbortError(e)) return;
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return {
    running: activity.task === task.key && activity.status === 'running',
    run: () => void start(),
  };
}
