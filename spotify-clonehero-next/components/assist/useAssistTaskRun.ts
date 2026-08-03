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

import type {AssistContext, AssistTaskDef} from '@/lib/assist/tasks';
import {isAbortError} from '@/lib/workers/abortable-worker';
import {
  useAssistRunActivity,
  type AssistRunnerControls,
} from './useAssistRunner';

export interface AssistTaskRunOptions<Result> {
  /** Builds the task's run context. Async so a caller can load audio bytes
   *  (or anything else the task needs) first; a failure here is reported the
   *  same way a failed run is. */
  prepareContext: () => Promise<AssistContext>;
  /** Applies a successful run's result — typically executing the command
   *  that installs it. */
  applyResult: (result: Result) => void;
  /** Success toast copy. */
  successMessage: string;
}

export interface AssistTaskRun {
  /** True while this task's run is in flight. */
  running: boolean;
  /** Starts the run. Safe to hand straight to an `onClick`. */
  run: () => void;
}

export function useAssistTaskRun<Result>(
  runner: AssistRunnerControls,
  task: AssistTaskDef<Result>,
  {prepareContext, applyResult, successMessage}: AssistTaskRunOptions<Result>,
): AssistTaskRun {
  const activity = useAssistRunActivity(runner.store);

  async function start(): Promise<void> {
    try {
      const result = await runner.start(task, await prepareContext());
      applyResult(result);
      toast.success(successMessage);
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
