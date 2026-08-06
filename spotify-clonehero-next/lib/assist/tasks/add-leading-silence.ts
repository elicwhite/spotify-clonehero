/**
 * The `add-leading-silence` assist task: work out how many whole bars of
 * silence the chart needs in front (plan 0064), and pad + re-encode the
 * host's audio for that amount off the main thread before anything is
 * applied.
 *
 * Measuring is chart math and costs under a millisecond. The audio is what
 * costs the time: every track has to be re-padded and re-WAV-encoded, about
 * 120 ms per four minutes of 44.1 kHz stereo per track, which is why that
 * half runs in `pad-encode-worker.ts` under a progress card rather than
 * inside the click handler.
 *
 * The doc is read TWICE — once to size the pad, and once after the encode to
 * produce the plan that actually gets applied. The gap between them is a
 * second of worker time in which the user can still edit the chart, and a
 * plan measured before a tempo change would pad against a chart that no
 * longer exists. Re-measuring at the end costs nothing and means the applied
 * plan always describes the live doc; if the pad amount moved, the
 * pre-encoded audio simply doesn't match and the rebuild encodes again (also
 * in a worker), rather than the run quietly installing audio for a chart
 * that changed.
 */

import {getAudioAnchor, planLeadingSilence} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import type {LeadingSilencePlan} from '@/lib/chart-edit/leading-silence';
import {makeAbortError} from '@/lib/workers/abortable-worker';
import type {PlannedStep} from '../run-to-steps';
import type {AssistTaskDef} from './types';

/**
 * Pads and re-encodes the host's audio for the `audioAnchor` position the
 * chart is about to have, ahead of the edit that needs it. Matches
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
  /** Reads the LIVE chart doc. Called by `run`, not captured at click time,
   *  so the pad is measured against the chart as it stands. */
  readDoc: () => ChartDocument;
  /** Sample rate the pad quantizes to — the rate the host decoded at. */
  sampleRate: number;
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

  async run({readDoc, sampleRate, padAudioAhead}, signal, progress) {
    if (signal.aborted) throw makeAbortError();

    progress({activeKey: 'measure-lead-in', progress: 0});
    const sizing = planLeadingSilence(readDoc(), sampleRate);
    if (!sizing) {
      progress({activeKey: null, terminal: 'done'});
      return {plan: null};
    }

    if (padAudioAhead) {
      // The pad ACCUMULATES: a second press pads on top of the first, so
      // what the rebuild needs is where sample 0 ends up, not this press's
      // increment. Mirrors `applyLeadingSilence`'s own anchor arithmetic.
      const anchorMs = (getAudioAnchor(readDoc())?.ms ?? 0) + sizing.padMs;
      progress({activeKey: 'pad-audio', progress: 0});
      await padAudioAhead(anchorMs, {
        signal,
        onProgress: (fraction, detail) =>
          progress({activeKey: 'pad-audio', progress: fraction, detail}),
      });
    }
    if (signal.aborted) throw makeAbortError();

    progress({activeKey: null, terminal: 'done'});
    return {plan: planLeadingSilence(readDoc(), sampleRate)};
  },
};
