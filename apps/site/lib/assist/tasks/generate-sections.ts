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
 *
 * The beat grid LinkSeg reads is the one part a caller can bring itself: a
 * chart that already has a tempo map has a grid, and LinkSeg is robust to
 * its beat source, so `deriveBeatTimes` skips beat detection outright.
 */

import {decodeAndResampleTo44k} from '@/lib/audio-pipeline/decode-audio';
import {
  defaultCreateWorker as defaultCreateTempoWorker,
  runTempoPipeline,
} from '@/lib/tempo-map/pipeline-client';
import {hasBeatThisModelCached} from '@/lib/tempo-map/models';
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

/** The step list for a run whose beats came from the caller: only LinkSeg
 *  itself is left. */
const SECTIONS_ONLY_STEPS: ReadonlyArray<Omit<PlannedStep, 'cached'>> =
  GENERATE_SECTIONS_STEPS.filter(step => step.key === 'sections');

export interface GenerateSectionsInput {
  audio: AssistAudio;
  /**
   * A beat grid the caller already has, as quarter-note times in seconds
   * covering the decoded audio's duration — for the editor, the chart's own
   * tempo map (`lib/section-names/chart-beat-grid.ts`). Supplied, the run
   * skips beat detection entirely: no 83 MB model download, no ~10 s
   * inference, just LinkSeg on the audio. LinkSeg is robust to its beat
   * source, so the labels are the same either way.
   *
   * A function rather than an array because only the run knows the decoded
   * duration the grid has to cover.
   */
  deriveBeatTimes?: ((durationSeconds: number) => number[]) | undefined;
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

    async planSteps({deriveBeatTimes}) {
      // A run handed a beat grid never touches the beat tracker, so neither
      // of its steps belongs on the list — predicting work that won't happen
      // is exactly the "honest scoping" the engine's contract asks for.
      if (deriveBeatTimes) {
        return SECTIONS_ONLY_STEPS.map(cfg => ({...cfg, cached: false}));
      }
      // Nothing here is stem-cached, so the only cache that changes the step
      // list is the OPFS model cache: once Beat This! is in it, the run reads
      // it locally and downloads nothing. Same probe `generate-tempo-map`
      // uses, so the two tasks report that step identically.
      const beatModelCached = await hasBeatThisModelCached();
      return GENERATE_SECTIONS_STEPS.map(cfg => ({
        ...cfg,
        cached: cfg.key === 'download-beat-model' && beatModelCached,
      }));
    },

    async run({audio, deriveBeatTimes}, signal, progress) {
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
        beatTimes: deriveBeatTimes?.(audioBuffer.duration) ?? null,
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
