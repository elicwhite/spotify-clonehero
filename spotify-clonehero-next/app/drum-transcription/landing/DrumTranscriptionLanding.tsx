'use client';

import {useCallback, type ReactNode} from 'react';
import {
  AudioLines,
  Grid3x3,
  Pencil,
  Waves,
  type LucideIcon,
} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {TooltipProvider} from '@/components/ui/tooltip';
import {Eyebrow} from '@/components/landing/Eyebrow';
import {LandingSection} from '@/components/landing/Section';
import {StatCell} from '@/components/landing/StatChip';
import {StepFlow} from '@/components/landing/StepFlow';
import {TrustLine} from '@/components/landing/TrustLine';

import {EditPassCanvas} from './EditPassCanvas';
import {
  COMPARISON_FAMILY_ROWS,
  DATA_DISCLAIMER,
  METRICS,
  MODEL_CHECKPOINT,
} from './metrics';

/**
 * An ADTOF comparison cell awaiting its figure. A fresh measurement on the
 * same songs was requested (drum-to-chart
 * docs/requests/2026-08-06-landing-page-comparison-data.md); the cells fill
 * in when that run lands.
 */
function PendingCell() {
  return (
    <span className="font-mono text-muted-foreground">
      <span aria-hidden="true">—</span>
      <span className="sr-only">pending measurement</span>
    </span>
  );
}

/** A named third-party project, linked from the copy that mentions it. */
function ExternalLink({href, children}: {href: string; children: ReactNode}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
      {children}
    </a>
  );
}

const STEPS: {Icon: LucideIcon; label: string; desc: string}[] = [
  {
    Icon: Waves,
    label: 'Separate the drums',
    desc: 'BS-Roformer, a separation model, isolates the drum stem from the full mix.',
  },
  {
    Icon: AudioLines,
    label: 'Propose the notes',
    desc: 'A custom trained transcription model predicts drum hits on eight lanes: kick, snare, three toms, hi-hat, crash, and ride.',
  },
  {
    Icon: Grid3x3,
    label: 'Build the tempo grid',
    desc: 'Beat This!, a beat-tracking model, finds the beats and the downbeats. A postprocessing step tuned for charts converts the grid into a tempo map.',
  },
  {
    Icon: Pencil,
    label: 'Open in the chart editor',
    desc: 'The draft opens on a Clone Hero highway. You review and edit notes, then export a .zip or .sng.',
  },
];

/** The failure modes, specific and musical, next to the capability claims. */
const FIXES: {title: string; body: ReactNode}[] = [
  {
    title: 'Tom lanes',
    body: 'The model hears tom hits and usually puts them somewhere in the tom family. Which of the three toms it picks is the weakest thing it does, and toms need more editing than any other part of a kit. Plan on reassigning tom lanes while you review a fill.',
  },
  {
    title: 'The tempo grid',
    body: 'Notes are snapped to a grid predicted from the audio. When a note sits in the wrong place, the grid is usually the reason rather than the note. Downbeat placement is the weakest part of beat tracking today, so a chart can come out a beat out of phase.',
  },
  {
    title: 'Convention, which is not an error',
    body: 'Two charters given the same song make different calls about which lane a hit belongs on. Some of what looks wrong in a draft is a charting choice rather than a mistake, and that choice is yours to make.',
  },
  {
    title: 'Extra notes and missing notes',
    body: 'Each lane has its own detection threshold rather than one cutoff shared across the kit, because a cymbal that was never played and a kick that was missed cost you different amounts of work. You will delete some notes and add others.',
  },
];

/**
 * The /drum-transcription landing page: the entry point to the tool and the
 * page that explains it. The working entry screen is passed in as
 * `toolEntry` so the pipeline flow stays owned by DrumTranscriptionClient.
 */
export function DrumTranscriptionLanding({toolEntry}: {toolEntry: ReactNode}) {
  const scrollToStart = useCallback(() => {
    document
      .getElementById('start')
      ?.scrollIntoView({behavior: 'smooth', block: 'start'});
  }, []);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="landing-lanes w-full max-w-4xl space-y-12 py-8 sm:py-12">
        {/* Hero */}
        <header className="space-y-6">
          <Eyebrow>Drum transcription</Eyebrow>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl [text-wrap:balance]">
            {/* Non-breaking hyphen: "first-pass" should never split across
                lines in the display size. */}
            Turn a song into a first&#8209;pass drum chart
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Placing every drum note by hand is the slow part of charting a song.
            This tool speeds up charting by giving you a high quality draft. You
            review the draft, fix what&rsquo;s wrong, and decide what ships.
          </p>
          <TrustLine
            items={[
              'All processing happens on your computer. Your audio file and chart are never uploaded to a server.',
              'The first run downloads about 515 MB of model files.',
              'Needs WebGPU, so a recent Chrome or Edge.',
            ]}
          />
          <EditPassCanvas />
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            Above: the model&rsquo;s predicted notes need some edits, like
            moving a cymbal to the right lane, removing a note that was never
            played, or nudging a note onto the beat. Make those fixes in the
            chart editor.
          </p>
        </header>

        {/* Tool entry: the working screen, promoted to the top of the page. */}
        <LandingSection
          id="start"
          title="Start a song"
          intro="Drop in an audio file to build a new chart, or an existing chart package to keep its tempo map and transcribe drums onto it.">
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6">
            {toolEntry}
          </div>
        </LandingSection>

        <LandingSection
          title="What it does"
          intro="Three models run on your machine: one separates the drums from the mix, one proposes the drum notes, one finds the beat grid the notes sit on. What they produce together is the draft, and the last step is where you take over.">
          <StepFlow steps={STEPS} />
        </LandingSection>

        <LandingSection
          title="What you'll fix"
          intro="These are the parts of a draft that are wrong most often. They are where your time goes, so they are worth knowing before you start.">
          <ul className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
            {FIXES.map(fix => (
              <li
                key={fix.title}
                className="flex flex-col gap-3 bg-card p-5 sm:last:odd:col-span-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {fix.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {fix.body}
                </p>
              </li>
            ))}
          </ul>
        </LandingSection>

        <LandingSection
          title="How many edits"
          intro="Edits per note counts the work a draft leaves you: every note you add, delete, move to another lane, or move to another position, divided by the number of notes in the finished chart. Lower is fewer edits. Hover or focus a figure to see the script behind it.">
          <div className="space-y-10">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                By part of the kit
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[30rem] border-collapse text-sm">
                  <caption className="sr-only">
                    Edits per note by part of the kit for this tool, ADTOF, and
                    Octave. ADTOF cells are pending measurement.
                  </caption>
                  <thead>
                    <tr className="border-b border-border">
                      <th
                        scope="col"
                        className="py-2 pr-4 text-left font-mono text-[11px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
                        Part of the kit
                      </th>
                      {['This tool', 'ADTOF', 'Octave'].map(head => (
                        <th
                          key={head}
                          scope="col"
                          className="py-2 pl-4 text-right font-mono text-[11px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border/60">
                      <th
                        scope="row"
                        className="py-2 pr-4 text-left font-normal text-foreground">
                        Whole chart
                      </th>
                      <td className="py-2 pl-4 text-right">
                        <StatCell metric={METRICS.comparisonOverallOurs} />
                      </td>
                      <td className="py-2 pl-4 text-right">
                        <PendingCell />
                      </td>
                      <td className="py-2 pl-4 text-right">
                        <StatCell metric={METRICS.comparisonOverallOctave} />
                      </td>
                    </tr>
                    {COMPARISON_FAMILY_ROWS.map(row => (
                      <tr
                        key={row.family}
                        className="border-b border-border/60 last:border-b-0">
                        <th
                          scope="row"
                          className="py-2 pr-4 text-left font-normal text-muted-foreground">
                          {row.family}
                        </th>
                        <td className="py-2 pl-4 text-right font-mono tabular-nums text-foreground">
                          {row.ours}
                        </td>
                        <td className="py-2 pl-4 text-right">
                          <PendingCell />
                        </td>
                        <td className="py-2 pl-4 text-right font-mono tabular-nums text-foreground">
                          {row.octave}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="max-w-2xl font-mono text-[11px] leading-relaxed text-muted-foreground">
                <ExternalLink href="https://github.com/mzehren/adtof">
                  ADTOF
                </ExternalLink>{' '}
                is a leading open-source drum transcription model, but doesn't
                distinguish toms and cymbals.{' '}
                <ExternalLink href="https://octavestudio.tools/">
                  Octave
                </ExternalLink>{' '}
                is a published audio-to-chart system.
              </p>
            </section>

            <p className="max-w-2xl font-mono text-[11px] leading-relaxed text-muted-foreground">
              {DATA_DISCLAIMER}
            </p>
          </div>
        </LandingSection>

        <div className="flex flex-col items-start border-t border-border pt-8">
          <Button onClick={scrollToStart}>Open a song</Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
