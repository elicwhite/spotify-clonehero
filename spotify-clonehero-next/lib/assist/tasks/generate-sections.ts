/**
 * The `generate-sections` assist task (plan 0076 item 23): LinkSeg
 * functional-section labeling on its own.
 *
 * Section titles and the tempo map are separate products, generated
 * separately, so regenerating a grid leaves the chart's section names alone.
 * This task runs the LinkSeg half alone — the SAME `pipeline-worker.ts`,
 * asked for a `'sections'` run, so there is exactly one implementation of
 * section labeling. That kind skips drum separation and the drum-stem beat
 * pass: LinkSeg reads full-mix beats and the full-mix audio only, and its
 * result cannot carry a grid at all.
 */

import {decodeAndResampleTo44k} from '@/lib/audio-pipeline/decode-audio';
import {
  defaultCreateWorker as defaultCreateTempoWorker,
  runTempoPipeline,
} from '@/lib/tempo-map/pipeline-client';
import type {LinkSegSections} from '@/lib/tempo-map/types';
import {makeAbortError} from '@/lib/workers/abortable-worker';
import type {PlannedStep} from '../run-to-steps';
import type {AssistAudio, AssistTaskDef} from './types';

/** One planned step per stage a sections-only pipeline run emits, in the
 *  order `pipeline-worker.ts` emits them. */
const GENERATE_SECTIONS_STEPS: ReadonlyArray<Omit<PlannedStep, 'cached'>> = [
  {
    key: 'download-beat-model',
    label: 'Downloading the beat-finding model',
    description: 'About 83 MB. Only happens the first time.',
  },
  {
    key: 'beats-fullmix',
    label: 'Finding the beat of the whole song',
    description: 'Section boundaries are placed on beats, not raw seconds.',
  },
  {
    key: 'sections',
    label: 'Labeling song sections',
    description:
      'Listens for where the song changes character and names each part.',
  },
];

export interface GenerateSectionsInput {
  audio: AssistAudio;
}

export interface GenerateSectionsResult {
  /** Segment edges in seconds plus one label per segment, or null when the
   *  song was too short for the model to find structure. */
  sections: LinkSegSections | null;
}

/** Test seam: the tempo pipeline worker factory this task spawns. */
export interface GenerateSectionsTaskDeps {
  createWorker?: (() => Worker) | undefined;
}

export function makeGenerateSectionsTask({
  createWorker = defaultCreateTempoWorker,
}: GenerateSectionsTaskDeps = {}): AssistTaskDef<
  GenerateSectionsResult,
  GenerateSectionsInput
> {
  return {
    key: 'generate-sections',
    title: 'Sections',

    async planSteps() {
      // No cache probe: nothing this run does is stem-cached, so every step
      // always runs.
      return GENERATE_SECTIONS_STEPS.map(cfg => ({...cfg}));
    },

    async run({audio}, signal, progress) {
      if (signal.aborted) throw makeAbortError();
      const audioBuffer = audio.loadDecodedMix
        ? await audio.loadDecodedMix()
        : await decodeAndResampleTo44k(await audio.loadOriginalBytes(), {
            signal,
          });

      if (signal.aborted) throw makeAbortError();
      // `sourceBytes` is deliberately omitted: it exists to key the drum-stem
      // cache, and this run never separates a stem, so hashing the file would
      // be pure cost.
      const result = await runTempoPipeline(audioBuffer, {
        kind: 'sections',
        createWorker,
        signal,
        onProgress: p => {
          progress({
            activeKey: p.stage,
            progress: p.percent,
            etaSeconds: p.etaSeconds,
            detail: p.detail,
          });
        },
      });

      progress({activeKey: null, terminal: 'done'});
      return {sections: result.sections};
    },
  };
}

export const generateSectionsTask = makeGenerateSectionsTask();
