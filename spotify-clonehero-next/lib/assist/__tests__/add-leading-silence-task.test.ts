/**
 * The `add-leading-silence` assist task.
 *
 * Two things are worth pinning here. First, the step list and the order the
 * task reports it in, since that is what the card renders. Second — and this
 * is the bug class this task was written around — that the plan it hands
 * back is measured against the doc as it stands when the run ENDS, not a
 * snapshot taken before the audio encode. A run holds the main thread for
 * none of its ~1s duration, so the user can edit the chart in the middle of
 * it, and applying a plan sized against the pre-edit chart would silently
 * revert their edit's effect on the lead-in.
 */

import {createEmptyChart, addDrumNote, makeChartTiming} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {retimeChart, setAudioAnchor, setSongStart} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {noteTypes} from '@eliwhite/scan-chart';
import type {StepProgressEvent} from '../run-to-steps';
import {
  addLeadingSilenceTask,
  type AddLeadingSilenceInput,
} from '../tasks/add-leading-silence';

/** A chart at `bpm` with a single note two beats in — early enough that the
 *  lead-in is always short of `LEAD_MIN_MS` and a pad is always planned. */
function makeDoc(bpm: number): ChartDocument {
  const parsedChart = createEmptyChart({format: 'chart', bpm, resolution: 192});
  const track = emptyTrackData('drums', 'expert');
  parsedChart.trackData.push(track);
  retimeChart(parsedChart);
  addDrumNote(
    track,
    {tick: 384, type: noteTypes.redDrum},
    makeChartTiming(parsedChart),
  );
  retimeChart(parsedChart);
  // The song start is what the pad is measured from, and the task declines
  // without one (plan 0124 step 4).
  return setSongStart({parsedChart, assets: []}, {audioMs: 0});
}

/** A doc with no sync track at all, which `planLeadingSilence` declines:
 *  with no tempo there is no bar length to pad by. */
function makeUnplannableDoc(): ChartDocument {
  const doc = makeDoc(120);
  doc.parsedChart.tempos = [];
  doc.parsedChart.timeSignatures = [];
  return doc;
}

function collect(): {
  progress: (event: StepProgressEvent) => void;
  events: StepProgressEvent[];
} {
  const events: StepProgressEvent[] = [];
  return {progress: event => events.push(event), events};
}

function inputFor(
  doc: ChartDocument,
  padAudioAhead?: AddLeadingSilenceInput['padAudioAhead'],
  bars?: number,
): AddLeadingSilenceInput {
  return {readDoc: () => doc, padAudioAhead, bars};
}

describe('addLeadingSilenceTask.planSteps', () => {
  it('plans measuring plus the audio pad when the host can pad audio', async () => {
    const steps = await addLeadingSilenceTask.planSteps(
      inputFor(makeDoc(120), async () => {}),
    );
    expect(steps.map(s => s.key)).toEqual(['measure-lead-in', 'pad-audio']);
  });

  it('plans measuring alone on a host with no audio to pad', async () => {
    const steps = await addLeadingSilenceTask.planSteps(inputFor(makeDoc(120)));
    expect(steps.map(s => s.key)).toEqual(['measure-lead-in']);
  });
});

describe('addLeadingSilenceTask.run', () => {
  it('reports both steps in order and finishes done', async () => {
    const {progress, events} = collect();
    const result = await addLeadingSilenceTask.run(
      inputFor(makeDoc(120), async () => {}),
      new AbortController().signal,
      progress,
    );

    expect(events.map(e => e.activeKey)).toEqual([
      'measure-lead-in',
      'pad-audio',
      null,
    ]);
    expect(events.at(-1)?.terminal).toBe('done');
    expect(result.plan).not.toBeNull();
    expect(result.plan!.bars).toBeGreaterThan(0);
  });

  it('forwards the pad fraction and detail as step progress', async () => {
    const {progress, events} = collect();
    await addLeadingSilenceTask.run(
      inputFor(makeDoc(120), async (_padSamples, {onProgress}) => {
        onProgress?.(0.5, '1 of 2');
        onProgress?.(1, '2 of 2');
      }),
      new AbortController().signal,
      progress,
    );

    const padEvents = events.filter(e => e.activeKey === 'pad-audio');
    expect(padEvents.map(e => e.progress)).toEqual([0, 0.5, 1]);
    expect(padEvents.at(-1)?.detail).toBe('2 of 2');
  });

  it('pads the audio for the anchor position the edit will produce', async () => {
    const padded: number[] = [];
    const result = await addLeadingSilenceTask.run(
      inputFor(makeDoc(120), async anchorMs => {
        padded.push(anchorMs);
      }),
      new AbortController().signal,
      () => {},
    );
    expect(padded).toEqual([result.plan!.padMs]);
  });

  it('pads for the WHOLE pad, not the increment, when silence exists', async () => {
    // A bar is 2000 ms at 120 BPM, so two bars is the whole silence the
    // rebuild needs — not 2000 added to what is already there. The audio is
    // re-padded from the original PCM, so it wants the absolute value.
    const doc = setAudioAnchor(makeDoc(120), {ms: 2000, tick: 0});
    const padded: number[] = [];
    const result = await addLeadingSilenceTask.run(
      inputFor(
        doc,
        async anchorMs => {
          padded.push(anchorMs);
        },
        2,
      ),
      new AbortController().signal,
      () => {},
    );
    expect(padded).toEqual([4000]);
    expect(result.plan!.padMs).toBe(4000);
  });

  it('stops after measuring, with no plan, when nothing needs padding', async () => {
    const padAudioAhead = jest.fn(async () => {});
    const {progress, events} = collect();
    const result = await addLeadingSilenceTask.run(
      inputFor(makeUnplannableDoc(), padAudioAhead),
      new AbortController().signal,
      progress,
    );
    expect(result.plan).toBeNull();
    expect(padAudioAhead).not.toHaveBeenCalled();
    expect(events.map(e => e.activeKey)).toEqual(['measure-lead-in', null]);
  });

  it('measures the applied plan against the doc as it stands AFTER the pad', async () => {
    // The chart is at 120 BPM when the run starts and 60 BPM by the time the
    // encode finishes — a bar is twice as long, so a plan captured up front
    // would pad by a different amount than the chart now needs.
    let doc = makeDoc(120);
    const before = doc;
    const result = await addLeadingSilenceTask.run(
      {
        readDoc: () => doc,
        padAudioAhead: async () => {
          doc = makeDoc(60);
        },
      },
      new AbortController().signal,
      () => {},
    );

    // The applied plan describes the doc as it stands now, at the bar count
    // the audio was padded for. Pinning the count is what keeps the audio and
    // the chart describing the same lead-in when the doc moves mid-run.
    const {planLeadIn} = await import('@/lib/chart-edit');
    const live = planLeadIn(doc, result.plan!.bars)!;
    expect(result.plan!.padMs).toBeCloseTo(live.padMs, 6);
    expect(result.plan!.padMs).not.toBeCloseTo(planLeadIn(before)!.padMs, 6);
  });

  it('rejects an already-aborted run before measuring anything', async () => {
    const controller = new AbortController();
    controller.abort();
    const readDoc = jest.fn(() => makeDoc(120));
    await expect(
      addLeadingSilenceTask.run({readDoc}, controller.signal, () => {}),
    ).rejects.toThrow('Aborted');
    expect(readDoc).not.toHaveBeenCalled();
  });

  it('rejects when the pad is cancelled', async () => {
    const controller = new AbortController();
    await expect(
      addLeadingSilenceTask.run(
        inputFor(makeDoc(120), async () => {
          controller.abort();
        }),
        controller.signal,
        () => {},
      ),
    ).rejects.toThrow('Aborted');
  });
});
