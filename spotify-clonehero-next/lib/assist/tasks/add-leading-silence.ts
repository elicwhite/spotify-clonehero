/**
 * The `add-leading-silence` assist task: work out how many whole bars of
 * silence the chart needs in front (plan 0064), and pad the host's audio for
 * that amount off the main thread before anything is applied.
 *
 * Measuring is chart math and costs under a millisecond. The audio is what
 * costs the time: every track has to be re-padded, which is a fresh buffer
 * the length of the whole song per track, so that half runs in
 * `pad-tracks-worker.ts` under a progress card rather than inside the click
 * handler.
 *
 * The doc is read TWICE — once to size the pad, and once after the pad to
 * produce the plan that actually gets applied. The gap between them is a
 * second of worker time in which the user can still edit the chart, and a
 * plan measured before a tempo change would pad against a chart that no
 * longer exists. Re-measuring at the end costs nothing and means the applied
 * plan always describes the live doc; if the pad amount moved, the
 * pre-padded audio simply doesn't match and the rebuild pads again (also in
 * a worker), rather than the run quietly installing audio for a chart that
 * changed.
 */

import {planLeadIn} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import type {LeadingSilencePlan} from '@/lib/chart-edit/leading-silence';
import {makeAbortError} from '@/lib/workers/abortable-worker';
import type {PlannedStep} from '../run-to-steps';
import type {AssistTaskDef} from './types';

/**
 * Pads the host's audio for the `audioAnchor` position the chart is about to
 * have, ahead of the edit that needs it. Matches
 * `PadAudioAhead` in
 * `components/chart-editor/AudioServiceContext.tsx`; declared structurally
 * here so this module stays free of React and of the editor's component
 * tree.
 */
export type PadAudioAheadFn = (
  anchorMs: number,
  options: {
    signal?: AbortSignal | undefined;
    onProgress?: ((fraction: number, detail: string) => void) | undefined;
  },
) => Promise<void>;

const MEASURE_STEP: Omit<PlannedStep, 'cached'> = {
  key: 'measure-lead-in',
  label: 'Measuring the lead-in',
  description:
    'Counts the whole bars of silence needed for the chart to start on a full measure.',
};

const PAD_AUDIO_STEP: Omit<PlannedStep, 'cached'> = {
  key: 'pad-audio',
  label: 'Padding the audio',
  description:
    'Re-encodes every track with the silence in front, so playback still lines up with the chart.',
};

export interface AddLeadingSilenceInput {
  /** The bar count the user asked for — the `[+]`/`[-]` value, or absent on
   *  a first press, where the minimum is computed. */
  bars?: number | undefined;
  /** Reads the LIVE chart doc. Called by `run`, not captured at click time,
   *  so the pad is measured against the chart as it stands. */
  readDoc: () => ChartDocument;
  /** The host's audio pre-pad. Absent on a host with no audio to pad, in
   *  which case the run is the measuring step alone. */
  padAudioAhead?: PadAudioAheadFn | undefined;
}

export interface AddLeadingSilenceResult {
  /** The plan to apply, measured against the doc as it stands at the END of
   *  the run. Null when the chart needs no padding. */
  plan: LeadingSilencePlan | null;
}

export const addLeadingSilenceTask: AssistTaskDef<
  AddLeadingSilenceResult,
  AddLeadingSilenceInput
> = {
  key: 'add-leading-silence',
  title: 'Leading silence',

  async planSteps({padAudioAhead}) {
    return padAudioAhead
      ? [{...MEASURE_STEP}, {...PAD_AUDIO_STEP}]
      : [{...MEASURE_STEP}];
  },

  async run({readDoc, padAudioAhead, bars}, signal, progress) {
    if (signal.aborted) throw makeAbortError();

    progress({activeKey: 'measure-lead-in', progress: 0});
    const sizing = planLeadIn(readDoc(), bars);
    if (!sizing) {
      progress({activeKey: null, terminal: 'done'});
      return {plan: null};
    }

    if (padAudioAhead) {
      // `padMs` is the WHOLE silence in front of the audio, not this press's
      // increment, and `padAudioAhead` wants exactly that: it re-pads from
      // the original PCM rather than adding to a padded copy.
      progress({activeKey: 'pad-audio', progress: 0});
      await padAudioAhead(sizing.padMs, {
        signal,
        onProgress: (fraction, detail) =>
          progress({activeKey: 'pad-audio', progress: fraction, detail}),
      });
    }
    if (signal.aborted) throw makeAbortError();

    // The doc is read again, so the applied plan describes the chart as it
    // stands now. The bar count is pinned to the one the audio was padded
    // for: measuring it afresh could pick a different count if the chart
    // changed during the run, and the audio would then match no plan.
    const applied = planLeadIn(readDoc(), sizing.bars);
    progress({activeKey: null, terminal: 'done'});
    return {plan: applied ?? sizing};
  },
};
