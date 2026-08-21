'use client';

/**
 * Records which assist tasks have been run against the open project, so the
 * export event can report the tools the shipped chart was actually built
 * with (plan 0105).
 *
 * It watches the editor's single assist runner rather than each surface that
 * can start a task: cards, the Chart Matrix row and the Add Lyrics dialog all
 * share that one runner, so one observer covers every in-editor run and no
 * future surface can be added without being counted.
 *
 * The list lives on the project record, not in a second copy here. A mirror
 * would need reseeding whenever a different project opened, and a mirror that
 * missed a reseed would credit one chart's tools to the next.
 *
 * One instance serves exactly one project: both hosts key the editor by
 * project id, so `projectId` cannot change under a mounted instance. The
 * runner is deliberately NOT keyed — it lives above the editor and survives
 * that remount — which is why the edge trigger below is still needed even
 * though nothing else here has to defend against a project switch.
 *
 * Landing-page runs are deliberately outside this. They happen before the
 * project exists, and the tool that did that work is what the project's
 * `origin` already says.
 */

import {useEffect, useRef} from 'react';

import type {AssistRunStatus} from '@/lib/assist/assist-store';
import type {AssistTaskKey} from '@/lib/assist/tasks/types';
import type {AssistRunnerControls} from '@/components/assist/useAssistRunner';

/** Shared empty list, so a project with no recorded tools hands the same
 *  reference to every render rather than a fresh array. */
export const NO_TOOLS_APPLIED: readonly AssistTaskKey[] = [];

/** The part of a project record this cares about, whichever store owns it. */
interface HasToolsApplied {
  toolsApplied?: AssistTaskKey[] | undefined;
}

export function useProjectToolsApplied<M extends HasToolsApplied>({
  runner,
  projectId,
  projectMeta,
  setProjectMeta,
  updateProject,
}: {
  runner: AssistRunnerControls;
  /** Null before a project is open; nothing is recorded until it is. */
  projectId: string | null;
  projectMeta: M | null;
  setProjectMeta: (update: (prev: M | null) => M | null) => void;
  /** The owning store's metadata writer. */
  updateProject: (
    projectId: string,
    patch: {toolsApplied: AssistTaskKey[]},
  ) => Promise<unknown>;
}): readonly AssistTaskKey[] {
  const toolsApplied = projectMeta?.toolsApplied ?? NO_TOOLS_APPLIED;

  /**
   * The status seen on the previous notification, so this reacts to a run
   * REACHING success rather than to the runner sitting at it.
   *
   * The difference is a data-loss bug, not a nicety. A finished run's status
   * lingers for `TERMINAL_FLASH_MS` after the run ends, and the runner lives
   * above the editor — so opening a different project inside that window
   * mounts a fresh instance of this hook against a store already sitting at
   * `success`, and a level-triggered observer would record the previous
   * project's run onto the new one.
   */
  const previousStatus = useRef<AssistRunStatus | null>(null);

  /**
   * What this hook has already written.
   *
   * The subscription closes over the `toolsApplied` of the render that
   * installed it, and a second run can finish before React has re-rendered
   * with the first one's result. Unioning against this means the second
   * write extends the first instead of replacing it.
   */
  const written = useRef<AssistTaskKey[]>([]);

  /**
   * Whether a run was already in flight when this hook mounted.
   *
   * The runner outlives the editor, and nothing cancels a run when the
   * editor unmounts — so a user who starts a long run on one project, goes
   * back, and opens another leaves this hook watching a run that belongs to
   * the chart they left. Adopting its success would write that chart's tool
   * onto this one and permanently corrupt the record.
   *
   * Set once per mount rather than per re-subscribe: the effect re-runs
   * whenever the project's metadata identity changes, which happens mid
   * session on any save, and resetting it there would drop legitimate
   * records.
   */
  const inheritedRun = useRef<boolean | null>(null);

  // Subscribed to the store directly rather than through
  // `useAssistRunActivity`. A React-rendered view of the status can coalesce
  // `running` and `success` into one update for a task that settles in
  // microtasks, and the edge would be lost with it. Every `setState` on the
  // store produces exactly one notification here.
  const {store} = runner;
  useEffect(() => {
    // Whatever the runner is doing at the moment this subscribes is the
    // baseline, never an edge — that is what stops a run finished under the
    // previous project from being recorded against this one.
    previousStatus.current = store.getState().status;
    inheritedRun.current ??= store.getState().status === 'running';

    return store.subscribe(() => {
      const {task, status} = store.getState();
      const wasRunning = previousStatus.current === 'running';
      previousStatus.current = status;

      // Whatever that inherited run ends as — success, cancelled or error —
      // it is not this project's, and once it has ended the runner is free
      // for a run that is. Cleared on ANY exit from `running`, not just on
      // success, or an inherited run that failed would suppress every real
      // run after it.
      if (wasRunning && status !== 'running' && inheritedRun.current) {
        inheritedRun.current = false;
        return;
      }

      if (!wasRunning || status !== 'success') return;
      if (task === null || projectId === null) return;

      const known = [...new Set([...toolsApplied, ...written.current])];
      if (known.includes(task)) return;

      const next = [...known, task];
      written.current = next;
      updateProject(projectId, {toolsApplied: next})
        .then(() =>
          setProjectMeta(prev => (prev ? {...prev, toolsApplied: next} : prev)),
        )
        .catch(err => {
          // Forget the write that did not land. Left claiming the tool was
          // recorded, `known` would suppress every retry for the rest of the
          // session and the field would stay permanently short. A chart is
          // still not worth failing to export because an analytics write
          // missed.
          written.current = known;
          console.warn('Could not record the applied tool:', err);
        });
    });
  }, [store, projectId, toolsApplied, setProjectMeta, updateProject]);

  return toolsApplied;
}
