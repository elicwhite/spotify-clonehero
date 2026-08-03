'use client';

/**
 * Owns the `AbortController` and drives `AssistStore` for one active assist
 * run (plan 0074 Design B). `start` plans the step list, runs the task, and
 * maps every progress tick through `run-to-steps.ts` into the store; only
 * `AssistRunCard` (and busy-marked matrix/piano-roll row headers) subscribe
 * to the resulting state, so progress ticks never re-render the rest of the
 * editor.
 *
 * In the editor there is exactly one of these, held by `AssistRunnerProvider`
 * beside `ChartEditorProvider`, so "one active run per runner" means one
 * active run across the whole editor.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AssistStore,
  IDLE_ASSIST_RUN_STATE,
  type AssistRunState,
  type AssistRunStatus,
} from '@/lib/assist/assist-store';
import type {
  AssistContext,
  AssistTaskDef,
  AssistTaskKey,
} from '@/lib/assist/tasks';
import {isAbortError} from '@/lib/workers/abortable-worker';
import {
  createStepTimer,
  markStepCompletions,
  stepProgressToSteps,
  type PlannedStep,
  type StepProgressEvent,
} from '@/lib/assist/run-to-steps';

/** How long a finished run's step list stays on screen before the card
 *  clears itself. Errors don't auto-clear (the message is the point) — they
 *  clear on `dismiss`. */
const TERMINAL_FLASH_MS = 4000;

/** Rejection message when a second run is requested while one is in flight.
 *  Surfaced to the user by the caller (toast / dialog error line). */
export const ASSIST_RUN_BUSY_MESSAGE =
  'Another assist task is already running. Wait for it to finish, or cancel it first.';

export interface AssistRunnerControls {
  /** The run's external store. Pass it to `ConnectedAssistRunCard` (or any
   *  other subscriber) instead of subscribing here: a component that reads
   *  `state` re-renders on every progress tick. */
  store: AssistStore;
  /**
   * Starts a task run. Callers pass the task itself, so the returned promise
   * carries that task's own result type — no registry lookup, no cast, and
   * no "task not implemented" failure mode: a task that doesn't exist yet
   * isn't a value anyone can pass.
   *
   * Resolves with the task's result on success and rejects otherwise — a
   * `DOMException` named `AbortError` on cancel, or the task's own error.
   * `state.status` reaches the same outcome ('success' | 'cancelled' |
   * 'error') regardless of whether the caller awaits this promise; callers
   * that only care about the rendered step list may ignore it.
   *
   * Rejects immediately with {@link ASSIST_RUN_BUSY_MESSAGE} when a run is
   * already in flight, leaving that run untouched.
   */
  start: <Result>(
    task: AssistTaskDef<Result>,
    ctx: AssistContext,
  ) => Promise<Result>;
  /** Aborts the currently active run, if any. A no-op when idle. */
  cancel: () => void;
  /** Clears a finished run's card back to idle. A no-op while running. */
  dismiss: () => void;
}

/**
 * Owns a run without subscribing to its progress. The returned object's
 * members are referentially stable for the component's lifetime, so a
 * component using only this never re-renders from the run.
 */
export function useAssistRunnerControls(): AssistRunnerControls {
  const [store] = useState(() => new AssistStore());

  const controllerRef = useRef<AbortController | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFlashTimer = useCallback(() => {
    if (flashTimerRef.current !== null) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const dismiss = useCallback(() => {
    if (store.getState().status === 'running') return;
    clearFlashTimer();
    store.setState(IDLE_ASSIST_RUN_STATE);
  }, [store, clearFlashTimer]);

  /** Clears the card a few seconds after a run finishes, unless another run
   *  has started in the meantime. */
  const scheduleFlashClear = useCallback(() => {
    clearFlashTimer();
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null;
      if (store.getState().status === 'running') return;
      store.setState(IDLE_ASSIST_RUN_STATE);
    }, TERMINAL_FLASH_MS);
  }, [store, clearFlashTimer]);

  const start = useCallback(
    <Result>(
      task: AssistTaskDef<Result>,
      ctx: AssistContext,
    ): Promise<Result> => {
      // One active run per runner, and one runner per editor: a second start
      // is refused rather than silently abandoning the run in flight.
      if (store.getState().status === 'running') {
        return Promise.reject(new Error(ASSIST_RUN_BUSY_MESSAGE));
      }

      const taskKey = task.key;

      clearFlashTimer();
      const controller = new AbortController();
      controllerRef.current = controller;
      // Claim 'running' synchronously, before the first await: the guard
      // above reads this same field, so anything asynchronous here would
      // leave a window in which a second start passes the guard, overwrites
      // `controllerRef`, and strands the first run's signal beyond the reach
      // of `cancel()` and the unmount abort. The step list starts empty and
      // is filled in once `planSteps` resolves.
      store.setState({task: taskKey, steps: [], status: 'running'});
      const signal = controller.signal;
      const timer = createStepTimer();
      // Guards against a *superseded* run writing over a newer one's state —
      // the flash-timer and dismiss races. A concurrent second run can't
      // happen: the busy guard refuses it.
      const isCurrent = () => controllerRef.current === controller;

      const runPromise = (async () => {
        let plannedSteps: PlannedStep[] = [];
        try {
          plannedSteps = await task.planSteps(ctx);

          if (isCurrent()) {
            store.setState({
              task: taskKey,
              steps: stepProgressToSteps(
                plannedSteps,
                {activeKey: null},
                timer,
              ),
              status: 'running',
            });
          }

          const reportProgress = (event: StepProgressEvent) => {
            if (!isCurrent()) return;
            markStepCompletions(plannedSteps, event, timer);
            store.setState({
              task: taskKey,
              steps: stepProgressToSteps(plannedSteps, event, timer),
              status: 'running',
            });
          };

          const result = await task.run(ctx, signal, reportProgress);
          if (isCurrent()) {
            store.setState({
              task: taskKey,
              steps: stepProgressToSteps(
                plannedSteps,
                {activeKey: null, terminal: 'done'},
                timer,
              ),
              status: 'success',
            });
            scheduleFlashClear();
          }
          return result;
        } catch (e) {
          if (isCurrent()) {
            const aborted = isAbortError(e);
            store.setState({
              task: taskKey,
              steps: store.getState().steps,
              status: aborted ? 'cancelled' : 'error',
              error: aborted
                ? undefined
                : e instanceof Error
                  ? e.message
                  : String(e),
            });
            // An error keeps its message on screen until dismissed; a
            // cancellation has nothing left to say.
            if (aborted) scheduleFlashClear();
          }
          throw e;
        }
      })();

      // Prevent an unhandled-rejection warning for callers who only care
      // about `state` and ignore the returned promise; a caller that DOES
      // await/`.catch()` this promise still observes the real rejection —
      // this only marks it as handled, it doesn't swallow it for them.
      runPromise.catch(() => {});

      return runPromise;
    },
    [store, clearFlashTimer, scheduleFlashClear],
  );

  // A run outlives the component that started it only as far as this: on
  // unmount (project closed, editor torn down) the in-flight workers are
  // terminated rather than left burning GPU with no controller to stop them.
  useEffect(() => {
    return () => {
      clearFlashTimer();
      controllerRef.current?.abort();
    };
  }, [clearFlashTimer]);

  return useMemo(
    () => ({store, start, cancel, dismiss}),
    [store, start, cancel, dismiss],
  );
}

/**
 * Subscribes to `store`'s full run state, INCLUDING its step list — so this
 * re-renders on every progress tick. Only the run card (and anything else
 * that actually renders progress) may call it; a component that just needs
 * "is a run active, and which one" must use {@link useAssistRunActivity}
 * instead (plan 0074 Design B: progress ticks must not re-render the world).
 */
export function useAssistRunState(store: AssistStore): AssistRunState {
  return useSyncExternalStore(
    store.subscribe,
    store.getState,
    () => IDLE_ASSIST_RUN_STATE,
  );
}

/** Which task the store's run belongs to and where that run stands — the
 *  identity of the run, without its steps. */
export interface AssistRunActivity {
  task: AssistTaskKey | null;
  status: AssistRunStatus;
}

/**
 * Subscribes to the run's IDENTITY only (`task` + `status`), as two separate
 * subscriptions so each snapshot stays a primitive: `useSyncExternalStore`
 * bails out of re-rendering whenever a notification carried nothing but new
 * step progress — which is every progress tick. Callers that gate UI on "my
 * task is running" use this so a run never re-renders sibling cards several
 * times a second.
 */
export function useAssistRunActivity(store: AssistStore): AssistRunActivity {
  const task = useSyncExternalStore(
    store.subscribe,
    () => store.getState().task,
    () => IDLE_ASSIST_RUN_STATE.task,
  );
  const status = useSyncExternalStore(
    store.subscribe,
    () => store.getState().status,
    () => IDLE_ASSIST_RUN_STATE.status,
  );
  return useMemo(() => ({task, status}), [task, status]);
}
