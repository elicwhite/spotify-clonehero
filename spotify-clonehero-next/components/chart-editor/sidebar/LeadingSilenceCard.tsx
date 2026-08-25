'use client';

/**
 * Chart Assist "Add leading silence" card: runs the `add-leading-silence`
 * task on the editor's shared assist runner and applies the plan it
 * measures with `AddLeadingSilenceCommand`.
 *
 * The measuring is chart math and is instant. Padding the AUDIO to match is
 * not — every track gets a fresh buffer the length of the whole song — so the
 * task does that in a worker, ahead of the command, and the card reports it
 * as a step like every other assist action.
 */

import {useCallback, useEffect, useRef} from 'react';
import {AudioWaveform, Minus, Ruler} from 'lucide-react';
import {toast} from 'sonner';

import {ConnectedAssistRunCard} from '@/components/assist/AssistRunCard';
import {getSongStartTick, leadInBars, resolveOpening} from '@/lib/chart-edit';
import type {AssistRunnerControls} from '@/components/assist/useAssistRunner';
import {useAssistTaskRun} from '../hooks/useAssistTaskRun';
import {addLeadingSilenceTask} from '@/lib/assist/tasks/add-leading-silence';
import type {AddLeadingSilenceResult} from '@/lib/assist/tasks/add-leading-silence';
import type {ChartDocument} from '@/lib/chart-edit';

import {useShiftAudioAheadReader} from '../AudioServiceContext';
import type {EditCommand} from '../commands';
import {AddLeadingSilenceCommand} from '../commands';
import {CardAction, CardShell} from './CardShell';
import type {LearnKey} from './learn-copy';

export interface LeadingSilenceCardProps {
  doc: ChartDocument;
  runner: AssistRunnerControls;
  audioBusyReason: string | undefined;
  executeCommand: (command: EditCommand) => void;
  onLearnMore: (key: LearnKey) => void;
}

/**
 * Everything the card shows about the lead-in, in one place: the bar count
 * the chart expresses, the nudge step, and the one line of prose under the
 * title.
 *
 * The three states the note has are three returns rather than a nested
 * conditional, because they are three different things to say and only one
 * of them is about a lead-in that exists.
 */
function describeLeadIn(doc: ChartDocument) {
  // Bars as the CHART expresses them — derived, never stored, so this cannot
  // disagree with what the user is looking at. Fractional after an
  // opening-meter edit, which nothing corrects on its own (plan 0124,
  // "Nothing recomputes on its own"); the card says so and offers the re-fit.
  const bars = leadInBars(doc);
  // A song start at tick 0 is a chart with NO lead-in, not a chart with zero
  // bars of one — the card offers to make one rather than to add to it.
  // Anything above zero IS a lead-in, whole or not: a generated chart opens
  // with a fraction of one (0.75 bars, for a 3/4 construct in front of a 4/4
  // song), and saying nothing about it would hide the state the re-fit
  // exists for.
  const hasLeadIn = bars !== null && bars > 0;
  const wholeBars = hasLeadIn ? Math.round(bars) : null;
  const isWhole = hasLeadIn && Math.abs(bars - Math.round(bars)) < 1e-6;

  const opening = resolveOpening(doc);
  const common = {hasLeadIn, wholeBars, isWhole};

  // With no song start the opening is read at tick 0, and on a generated
  // chart tick 0 is the writer's lead-in construct — a partial bar in a meter
  // the song never plays. So the card states the values it is about to use.
  // The user sees 3/4 at 156.8 against a song that is 4/4 at 154.4, which is
  // the whole decision, and one right-click corrects it.
  if (getSongStartTick(doc) === null) {
    const label =
      `${opening.meter.numerator}/${opening.meter.denominator}` +
      ` at ${opening.bpm.toFixed(1)}`;
    return {
      ...common,
      note: {
        text:
          `Lead-in will be whole bars of ${label}, the values at the start` +
          ' of the chart. If the music begins later, right-click there and' +
          ' choose \u201cThe song starts here\u201d.',
        attn: true,
      },
    };
  }
  if (!hasLeadIn) return {...common, note: {text: undefined, attn: false}};
  if (isWhole) {
    return {
      ...common,
      note: {
        text: `Lead-in: ${wholeBars} bar${wholeBars === 1 ? '' : 's'}.`,
        attn: false,
      },
    };
  }
  return {
    ...common,
    note: {
      text: `Lead-in: ${bars!.toFixed(2)} bars — not whole bars any more.`,
      attn: true,
    },
  };
}

export default function LeadingSilenceCard({
  doc,
  runner,
  audioBusyReason,
  executeCommand,
  onLearnMore,
}: LeadingSilenceCardProps) {
  const getShiftAudioAhead = useShiftAudioAheadReader();

  const {hasLeadIn, wholeBars, isWhole, note} = describeLeadIn(doc);

  /** The count the next run should use. The bar buttons and the re-fit set
   *  it; a plain press leaves it unset, and the planner picks the minimum (a
   *  first press) or one more bar (a later one). */
  /** The count this run should use, or null for "let the planner choose".
   *  Every button sets it explicitly, so nothing here re-reads the doc to
   *  guess what was meant. */
  const barsOverrideRef = useRef<number | null>(null);
  const takeRequestedBars = (): number | undefined => {
    const override = barsOverrideRef.current;
    barsOverrideRef.current = null;
    return override ?? undefined;
  };

  // The run reads the doc rather than closing over it: a run takes about a
  // second, and the plan it applies has to describe the chart at the end of
  // that second, not the render that started it.
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  const {running, run} = useAssistTaskRun(runner, addLeadingSilenceTask, {
    prepareInput: useCallback(
      async () => ({
        readDoc: () => docRef.current,
        shiftAudioAhead: getShiftAudioAhead() ?? undefined,
        // A card that has never been used asks for the minimum; a later press
        // adds one more bar.
        bars: takeRequestedBars(),
      }),
      [getShiftAudioAhead],
    ),
    applyResult: useCallback(
      ({plan}: AddLeadingSilenceResult) => {
        if (!plan) {
          // A bound refused, or the pad already equals what was asked for.
          // Worded for either button: "No leading silence needed" belongs to
          // a first press, and reading it after pressing Remove a bar on a
          // chart that visibly HAS a lead-in is simply confusing.
          toast.info('The lead-in is already what was asked for');
          return;
        }
        executeCommand(new AddLeadingSilenceCommand(plan));
      },
      [executeCommand],
    ),
    successMessage: ({plan}: AddLeadingSilenceResult) => {
      if (plan === null) return null;
      const dropped = plan.droppedTempos + plan.droppedTimeSignatures;
      // The pad is the WHOLE silence in front of the audio, so the message
      // states the lead-in rather than an amount added. Removing the tempo
      // map's own lead-in markers is part of the edit, so it is named.
      return (
        `Lead-in: ${plan.bars} bar${plan.bars === 1 ? '' : 's'}` +
        ` (${(plan.padMs / 1000).toFixed(1)}s of silence)` +
        (dropped > 0
          ? `, and ${dropped} marker${dropped === 1 ? '' : 's'} before the song start removed`
          : '')
      );
    },
  });

  /** Re-run the pad at an explicit bar count. The same task runs, so the
   *  audio is re-padded under the same progress card. */
  const setBars = (bars: number) => {
    barsOverrideRef.current = bars;
    run();
  };

  /** Let the planner choose: the smallest whole number of bars that is still
   *  legal, including the two-second floor an explicit count deliberately
   *  skips. What "Add leading silence" and "Re-fit to whole bars" both do —
   *  they are one action with two labels. */
  const replan = () => {
    barsOverrideRef.current = null;
    run();
  };

  return (
    <CardShell
      icon={<AudioWaveform />}
      name="Add leading silence"
      explanation="Adds whole bars of silence in front of the audio, so the song starts on a bar line."
      note={note.text}
      attn={note.attn}
      learnKey="silence"
      onLearnMore={onLearnMore}
      actions={
        running ? null : (
          <>
            <CardAction
              disabledReason={audioBusyReason}
              onClick={isWhole ? () => setBars(wholeBars! + 1) : replan}
              icon={hasLeadIn && !isWhole ? Ruler : AudioWaveform}
              label={
                !hasLeadIn
                  ? 'Add leading silence'
                  : isWhole
                    ? 'Add a bar'
                    : 'Re-fit to whole bars'
              }
              variant="outline"
            />
            {wholeBars !== null && wholeBars > 1 && (
              <CardAction
                // One less bar. The planner raises it back to the minimum if
                // that count would put an event before tick 0.
                disabledReason={audioBusyReason}
                onClick={() => setBars(wholeBars - 1)}
                icon={Minus}
                label="Remove a bar"
                variant="outline"
              />
            )}
          </>
        )
      }>
      <ConnectedAssistRunCard
        store={runner.store}
        task="add-leading-silence"
        onCancel={runner.cancel}
        onDismiss={runner.dismiss}
      />
    </CardShell>
  );
}
