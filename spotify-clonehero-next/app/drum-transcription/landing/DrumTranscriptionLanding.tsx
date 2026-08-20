'use client';

import {type ReactNode} from 'react';
import {
  AudioLines,
  Grid3x3,
  Pencil,
  Waves,
  type LucideIcon,
} from 'lucide-react';

import {CardGrid, CardGridCell} from '@/components/landing/CardGrid';
import {ComparisonTable} from '@/components/landing/ComparisonTable';
import {ExternalLink} from '@/components/landing/ExternalLink';
import {LandingHero} from '@/components/landing/LandingHero';
import {LandingPage} from '@/components/landing/LandingPage';
import {LandingProse} from '@/components/landing/Prose';
import {ScrollToStartCta} from '@/components/landing/ScrollToStartCta';
import {LandingSection} from '@/components/landing/Section';
import {StepFlow} from '@/components/landing/StepFlow';
import {ToolEntrySection} from '@/components/landing/ToolEntrySection';

import {EditPassCanvas} from './EditPassCanvas';
import {
  COMPARISON_ROWS,
  DATA_DISCLAIMER,
  GENERATED_TEMPO_MAP_ROWS,
  type ComparisonRow,
} from './metrics';

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
 * The kit-part rows break down the whole-chart row above them, so the first
 * row of each group is the summary the rest expand on.
 */
function toGroupRows(rows: readonly ComparisonRow[]) {
  return rows.map((row, index) => ({
    header: row.family,
    cells: [row.ours, row.adtof, row.octave],
    summary: index === 0,
  }));
}

/**
 * The /drum-transcription landing page: the entry point to the tool and the
 * page that explains it. The working entry screen is passed in as
 * `toolEntry` so the pipeline flow stays owned by DrumTranscriptionClient.
 */
export function DrumTranscriptionLanding({toolEntry}: {toolEntry: ReactNode}) {
  return (
    <LandingPage>
      <LandingHero
        eyebrow="Drum transcription"
        title={
          <>
            {/* Non-breaking hyphen: "first-pass" should never split across
                lines in the display size. */}
            Turn a song into a first&#8209;pass drum chart
          </>
        }
        lede={
          <>
            Placing every drum note by hand is the slow part of charting a song.
            This tool speeds up charting by giving you a high quality draft. You
            review the draft, fix what&rsquo;s wrong, and decide what ships.
          </>
        }
        trust={[
          'All processing happens on your computer. Your audio file and chart are never uploaded to a server.',
          'The first run downloads about 515 MB of model files.',
          'Needs WebGPU, so a recent Chrome or Edge.',
        ]}
        illustration={<EditPassCanvas />}
        caption={
          <>
            Above: the model&rsquo;s predicted notes need some edits, like
            moving a cymbal to the right lane, removing a note that was never
            played, or nudging a note onto the beat. Make those fixes in the
            chart editor.
          </>
        }
      />

      <ToolEntrySection
        title="Start a song"
        intro="Drop in an audio file to build a new chart, or an existing chart package to keep its tempo map and transcribe drums onto it.">
        {toolEntry}
      </ToolEntrySection>

      <LandingSection
        title="What it does"
        intro="Three models run on your machine: one separates the drums from the mix, one proposes the drum notes, one finds the beat grid the notes sit on. What they produce together is the draft, and the last step is where you take over.">
        <StepFlow steps={STEPS} />
      </LandingSection>

      <LandingSection
        title="What you'll fix"
        intro="These are the parts of a draft that are wrong most often. They are where your time goes, so they are worth knowing before you start.">
        <CardGrid columns="sm:grid-cols-2">
          {FIXES.map(fix => (
            <CardGridCell key={fix.title} className="sm:last:odd:col-span-2">
              <h3 className="text-sm font-semibold text-foreground">
                {fix.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {fix.body}
              </p>
            </CardGridCell>
          ))}
        </CardGrid>
      </LandingSection>

      <LandingSection
        title="How many edits"
        intro="Edits per 100 notes counts the work a draft leaves you: every note you add, delete, move to another lane, or move to another position. Lower is fewer edits. Hover or focus a figure to see the measurement behind it.">
        <div className="space-y-3">
          <LandingProse>
            This tool can start with an existing tempo map or make one from the
            audio.
          </LandingProse>
          <ComparisonTable
            caption="Edits per 100 notes for this tool, ADTOF, and Octave when starting with an existing tempo map or starting from audio."
            rowHeader="Part of the kit"
            columns={['This tool', 'ADTOF', 'Octave']}
            groups={[
              {
                label: 'With an existing tempo map',
                rows: toGroupRows(COMPARISON_ROWS),
              },
              {
                label: 'Starting from audio',
                rows: toGroupRows(GENERATED_TEMPO_MAP_ROWS),
              },
            ]}
            footnote={
              <>
                <ExternalLink href="https://github.com/mzehren/adtof">
                  ADTOF
                </ExternalLink>{' '}
                predicts five drum classes against this tool&rsquo;s eight-lane
                output. It doesn&rsquo;t identify which tom or which cymbal.{' '}
                <ExternalLink href="https://octavestudio.tools/">
                  Octave
                </ExternalLink>{' '}
                is a published audio-to-chart system.
              </>
            }
            disclaimer={DATA_DISCLAIMER}
          />
        </div>
      </LandingSection>

      <ScrollToStartCta>Open a song</ScrollToStartCta>
    </LandingPage>
  );
}
