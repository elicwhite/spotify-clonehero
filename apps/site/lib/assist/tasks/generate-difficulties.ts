/**
 * The `generate-difficulties` assist task (plan 0074 Design D): reduces an
 * Expert track to the lower tiers in a worker.
 */

import {
  runDifficultyGeneration,
  defaultCreateWorker as defaultCreateDifficultyWorker,
  type DifficultyGenerationInput,
} from '../difficulty-client';
import {tiersToTierSet} from '../difficulty-tiers';
import type {DifficultyTierSet} from '../difficulty-protocol';
import {makeAbortError} from '@/lib/workers/abortable-worker';
import type {PlannedStep} from '../run-to-steps';
import type {AssistTaskDef} from './types';

/** The instrument + source data the run reduces from, built from the chart
 *  doc's Expert track by `buildDifficultyGenerationInput`
 *  (`../difficulty-input`). */
export type GenerateDifficultiesInput = DifficultyGenerationInput;

export interface GenerateDifficultiesResult {
  tiers: DifficultyTierSet;
}

const GENERATE_DIFFICULTIES_STEPS: ReadonlyArray<Omit<PlannedStep, 'cached'>> =
  [
    {
      key: 'reduce',
      label: 'Reducing Expert to Hard, Medium, Easy',
      description: undefined,
    },
  ];

/** Test seam: the difficulty-generation worker factory this task spawns.
 *  Lives on the task, matching `AddLyricsTaskDeps`/`GenerateTempoMapTaskDeps`. */
export interface GenerateDifficultiesTaskDeps {
  createWorker?: (() => Worker) | undefined;
}

export function makeGenerateDifficultiesTask({
  createWorker = defaultCreateDifficultyWorker,
}: GenerateDifficultiesTaskDeps = {}): AssistTaskDef<
  GenerateDifficultiesResult,
  GenerateDifficultiesInput
> {
  return {
    key: 'generate-difficulties',
    title: 'Difficulty generation',

    // A single reporting step (Design D: "planSteps = single reducing-
    // difficulty step") — the reducers report one opaque percent, not a
    // multi-stage pipeline, so a longer predicted list would promise
    // structure that doesn't exist.
    async planSteps() {
      return GENERATE_DIFFICULTIES_STEPS.map(cfg => ({...cfg, cached: false}));
    },

    async run(input, signal, progress) {
      if (signal.aborted) throw makeAbortError();

      progress({activeKey: 'reduce', progress: 0});
      const {tiers} = await runDifficultyGeneration(
        input,
        {createWorker, signal},
        p =>
          progress({
            activeKey: 'reduce',
            progress: p.percent,
            detail: p.detail,
          }),
      );

      progress({activeKey: null, terminal: 'done'});
      return {tiers: tiersToTierSet(tiers)};
    },
  };
}

export const generateDifficultiesTask = makeGenerateDifficultiesTask();
