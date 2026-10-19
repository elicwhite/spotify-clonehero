'use client';

import type {ReactNode} from 'react';

import {Eyebrow} from '@/components/landing/Eyebrow';
import {LandingHero} from '@/components/landing/LandingHero';
import {LandingPage} from '@/components/landing/LandingPage';
import {LandingProse} from '@/components/landing/Prose';
import {ScrollToStartCta} from '@/components/landing/ScrollToStartCta';
import {LandingSection} from '@/components/landing/Section';
import type {FlowStepSpec} from '@/components/landing/StepFlow';
import {StepFlow} from '@/components/landing/StepFlow';
import {ToolEntrySection} from '@/components/landing/ToolEntrySection';

import type {DifficultyGenerationInstrument} from '../DifficultyGenerationFlow';
import {ReductionCascadeCanvas} from './illustrations/ReductionCascadeCanvas';

/**
 * The slots a difficulty-generation landing page fills. `/drum-difficulties`
 * and `/guitar-difficulties` are the same tool for two instruments, so each
 * route calls this layout with its own literal copy; the structure, the
 * section titles shared verbatim by both routes, and the CTA live here.
 */
export interface DifficultyLandingProps {
  /** Drives the hero cascade illustration's note pattern. */
  instrument: DifficultyGenerationInstrument;
  /** The hero eyebrow: 'Drum difficulties'. */
  eyebrow: string;
  /** The hero h1. */
  title: ReactNode;
  /** One plain sentence naming the tool's job, with no hedges. The
   *  not-one-shot statement rides `entryIntro` instead, so it still lands
   *  in the first screenful. */
  lede: ReactNode;
  /** The plain trust facts under the hero: local execution and the
   *  strongest true guarantee this instrument's model offers. */
  trust: readonly ReactNode[];
  /** Intro for the tool-entry section: what a dropped package needs, plus
   *  the statement that the output is a first pass finished in the chart
   *  editor. */
  entryIntro: string;
  /** Intro for the rules section; names the mechanism concretely: the
   *  trained scoring stage and the fixed decoding steps, per the copy
   *  guide's technology rules. */
  rulesIntro: ReactNode;
  /** A sample of the measurements the model reads, one per row, each a
   *  short name plus what it looks at, in charting vocabulary. */
  ruleRows: readonly {name: string; desc: string}[];
  /** The list's closing row, e.g. "and the rest": acknowledges the
   *  measurements beyond the listed rows without counting them, since
   *  one row can describe several of the model's input columns. */
  ruleRowsClose: string;
  /** The fixed decoding sequence, four steps for `StepFlow`'s grid. */
  decodeSteps: readonly FlowStepSpec[];
  /** Follow-up paragraphs after the step grid (sustain and marking
   *  rules). */
  rulesAfter?: readonly ReactNode[];
  /** The working tool entry, passed through to `ToolEntrySection`. */
  toolEntry: ReactNode;
}

/**
 * The difficulty-generation landing page: hero with the animated reduction
 * cascade, the tool entry, and one section explaining the features and
 * rules the reducer is built on.
 */
export function DifficultyLanding({
  instrument,
  eyebrow,
  title,
  lede,
  trust,
  entryIntro,
  rulesIntro,
  ruleRows,
  ruleRowsClose,
  decodeSteps,
  rulesAfter = [],
  toolEntry,
}: DifficultyLandingProps) {
  return (
    <LandingPage>
      <LandingHero
        eyebrow={eyebrow}
        title={title}
        lede={lede}
        trust={[...trust]}
        illustration={<ReductionCascadeCanvas instrument={instrument} />}
        caption={
          // Shared verbatim by both instrument routes, so it lives here with
          // the rest of the shared-verbatim copy rather than at the call
          // sites (which own only the copy that differs per route).
          <>
            Above: each tier reduces from the higher difficulty, based on a set
            of rules.
          </>
        }
      />

      <ToolEntrySection title="Start a chart" intro={entryIntro}>
        {toolEntry}
      </ToolEntrySection>

      <LandingSection
        title="The rules each tier is built on"
        intro={rulesIntro}>
        <div className="space-y-6">
          <dl className="max-w-2xl divide-y divide-border border-y border-border">
            {ruleRows.map(row => (
              <div
                key={row.name}
                className="grid gap-x-6 gap-y-1 py-2.5 sm:grid-cols-[12rem_1fr]">
                <Eyebrow as="dt" className="text-foreground sm:pt-0.5">
                  {row.name}
                </Eyebrow>
                <dd className="text-sm leading-relaxed text-muted-foreground">
                  {row.desc}
                </dd>
              </div>
            ))}
          </dl>
          <Eyebrow>{ruleRowsClose}</Eyebrow>
          <StepFlow steps={[...decodeSteps]} />
          {rulesAfter.map((paragraph, index) => (
            <LandingProse key={index}>{paragraph}</LandingProse>
          ))}
        </div>
      </LandingSection>

      <ScrollToStartCta>Open a chart</ScrollToStartCta>
    </LandingPage>
  );
}
