'use client';

/**
 * The one place difficulty generation is started and applied (plan 0074
 * Design D). Both surfaces that offer it — the Chart Matrix row's
 * "Generate H · M · E" bar and the Chart Assist recommendation card — call
 * this hook, so they start the same run, apply the same command, and report
 * the same messages instead of two hand-synced copies.
 *
 * What the hook owns:
 * - which instrument is generating: kept in {@link activeInstruments}, keyed
 *   by the editor's assist runner, NOT in component state. The row and the
 *   card mount independently and each call this hook, so component state
 *   would give them separate answers: a run started from the card would leave
 *   the row's cells unlocked and still offering "Delete Hard, Medium, and
 *   Easy" against the tracks that run is about to install;
 * - the busy guard: the assist runner allows one run editor-wide, so a
 *   second Generate click while a run is in flight is refused here rather
 *   than starting a run that the runner would reject after this surface had
 *   already flipped its lock (which would strand the first run's progress
 *   card and its only Cancel affordance);
 * - the source stamp: captured from `state.trackStamps` when the run's input
 *   is built, not when the result is applied. Expert stays editable during a
 *   run, and stamping the post-edit Expert would record tiers reduced from
 *   the pre-edit one as fresh;
 * - the typed block reason (no Expert track, no notes, not a Pro Drums
 *   chart), reported through the shared
 *   `difficultyGenerationBlockMessage`.
 */

import {useCallback, useSyncExternalStore} from 'react';
import {toast} from 'sonner';

import {useChartEditorContext} from '../ChartEditorContext';
import {useExecuteCommand} from './useEditCommands';
import {GenerateDifficultiesCommand} from '../commands';
import {trackKeyId} from '../scope';
import {INSTRUMENT_LABEL} from '../trackLabels';
import {difficultyGenerationBlockMessage} from '../difficultyGenerationMessages';
import {
  LOWER_TRACK_DIFFICULTIES,
  type SupportedTrackInstrument,
} from '@/lib/chart-editor-core';
import type {AssistStore} from '@/lib/assist/assist-store';
import {useOptionalAssistRunnerContext} from '@/components/assist/AssistRunnerProvider';
import {ASSIST_RUN_BUSY_MESSAGE} from '@/components/assist/useAssistRunner';
import {buildDifficultyGenerationInput} from '@/lib/assist/difficulty-input';
import {generateDifficultiesTask} from '@/lib/assist/tasks/generate-difficulties';
import {isAbortError} from '@/lib/workers/abortable-worker';

/** Shown where there is no assist runner in the tree (host pages that render
 *  the matrix without wiring generation). */
export const GENERATION_NOT_WIRED_REASON =
  'Difficulty generation is not wired up on this page.';

// ---------------------------------------------------------------------------
// Shared in-flight instrument
// ---------------------------------------------------------------------------

/**
 * The instrument whose `generate-difficulties` run is in flight, per assist
 * runner (one runner per editor, so one entry per editor). Written before the
 * run starts and cleared however it settles; read through
 * `useSyncExternalStore` so every surface in that editor re-renders on the
 * same value at the same time.
 */
const activeInstruments = new WeakMap<AssistStore, SupportedTrackInstrument>();
const activeInstrumentListeners = new Set<() => void>();

function subscribeActiveInstrument(listener: () => void): () => void {
  activeInstrumentListeners.add(listener);
  return () => activeInstrumentListeners.delete(listener);
}

function setActiveInstrument(
  store: AssistStore,
  instrument: SupportedTrackInstrument | null,
): void {
  if (instrument === null) activeInstruments.delete(store);
  else activeInstruments.set(store, instrument);
  for (const listener of activeInstrumentListeners) listener();
}

export interface DifficultyGenerationControls {
  /** The instrument whose run is in flight in this editor, or null when
   *  there is none — the same answer on every surface. */
  generatingInstrument: SupportedTrackInstrument | null;
  /** Why generation can't be offered at all (a standing limit, not a
   *  property of the chart or of any one instrument), or undefined when it
   *  can. Every instrument the editor supports reduces through a shipped
   *  reducer, so the only standing limit left is an editor with no assist
   *  runner wired. */
  disabledReason: string | undefined;
  /** Starts a run for `instrument` and applies its result. A no-op (with a
   *  toast) when a run is already in flight or generation is disabled. */
  start: (instrument: SupportedTrackInstrument) => void;
}

export function useDifficultyGeneration(): DifficultyGenerationControls {
  const {state, dispatch} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();
  const runner = useOptionalAssistRunnerContext();

  const generatingInstrument = useSyncExternalStore(
    subscribeActiveInstrument,
    () => (runner ? (activeInstruments.get(runner.store) ?? null) : null),
    () => null,
  );

  const disabledReason =
    runner == null ? GENERATION_NOT_WIRED_REASON : undefined;

  const run = useCallback(
    async (instrument: SupportedTrackInstrument) => {
      const doc = state.chartDoc;
      if (!runner || !doc) return;
      if (disabledReason !== undefined) return;
      if (runner.store.getState().status === 'running') {
        toast.error(ASSIST_RUN_BUSY_MESSAGE);
        return;
      }

      const built = buildDifficultyGenerationInput(doc, instrument);
      if (!built.ok) {
        toast.error(difficultyGenerationBlockMessage(instrument, built.reason));
        return;
      }
      const sourceStamp =
        state.trackStamps[trackKeyId({instrument, difficulty: 'expert'})];
      if (sourceStamp === undefined) {
        toast.error(
          difficultyGenerationBlockMessage(instrument, 'no-expert-track'),
        );
        return;
      }

      setActiveInstrument(runner.store, instrument);
      try {
        const result = await runner.start(
          generateDifficultiesTask,
          built.input,
        );
        executeCommand(
          new GenerateDifficultiesCommand(
            instrument,
            result.tiers,
            sourceStamp,
          ),
        );
        for (const difficulty of LOWER_TRACK_DIFFICULTIES) {
          dispatch({
            type: 'SET_TRACK_VISIBILITY',
            track: {instrument, difficulty},
            visible: true,
          });
        }
        toast.success(
          `Generated ${INSTRUMENT_LABEL[instrument]} Hard, Medium, Easy.`,
        );
      } catch (e) {
        if (!isAbortError(e)) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setActiveInstrument(runner.store, null);
      }
    },
    [
      runner,
      state.chartDoc,
      state.trackStamps,
      disabledReason,
      executeCommand,
      dispatch,
    ],
  );

  const start = useCallback(
    (instrument: SupportedTrackInstrument) => {
      void run(instrument);
    },
    [run],
  );

  return {generatingInstrument, disabledReason, start};
}
