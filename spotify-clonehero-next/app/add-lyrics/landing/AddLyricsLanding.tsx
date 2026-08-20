'use client';

import {type ReactNode} from 'react';

import {AudioLines, Pencil, Type, Waves, type LucideIcon} from 'lucide-react';

import {LandingHero} from '@/components/landing/LandingHero';
import {LandingPage} from '@/components/landing/LandingPage';
import {LandingProse} from '@/components/landing/Prose';
import {ScrollToStartCta} from '@/components/landing/ScrollToStartCta';
import {LandingSection} from '@/components/landing/Section';
import {StepFlow} from '@/components/landing/StepFlow';
import {ToolEntrySection} from '@/components/landing/ToolEntrySection';

import {SyllableAlignCanvas} from './SyllableAlignCanvas';

/**
 * The pipeline as a four-step flow. The mechanism naming follows the copy
 * guide: models are called models, and the hyphenation step is called out
 * as not one.
 */
const ALIGN_STEPS: {Icon: LucideIcon; label: string; desc: string}[] = [
  {
    Icon: Waves,
    label: 'Find the vocals',
    desc: 'Demucs, a separation model, pulls the vocals out of the mix.',
  },
  {
    Icon: Type,
    label: 'Split the lyrics into syllables',
    desc: 'Your pasted lines are split with the same hyphenation patterns TeX uses. No model is involved in this step.',
  },
  {
    Icon: AudioLines,
    label: 'Align each syllable',
    desc: 'A forced-alignment model reads the vocal, and a search places every syllable at the time it is sung.',
  },
  {
    Icon: Pencil,
    label: 'Review in the chart editor',
    desc: 'The aligned chart opens in the chart editor. You play it back, drag syllables that drifted, and export a .zip or .sng.',
  },
];

/**
 * The third-party model credit, named once in the how-it-works layer (copy
 * guide §3). The plain descriptions in the steps carry the mechanism.
 */
const PROVENANCE_NOTE = 'The forced-alignment model is wav2vec2.';

/**
 * The trust facts variant A states. The not-one-shot statement (style guide
 * §4) rides this list so it stays in the first screenful; the tool-entry
 * intro is fixed copy without it.
 */
const TRUST: readonly string[] = [
  'All processing happens on your computer. Your chart, audio, and lyrics are never uploaded to a server.',
  'The aligned track is a first pass: you review it in the chart editor and fix the lines that drift.',
  'Your original chart files are not modified. The aligned copy opens as a new project in the chart editor.',
];

/**
 * The /add-lyrics landing page (variant A, the live one): the entry point to
 * the tool and the page that explains it. The working entry screen is passed
 * in as `toolEntry` so the pipeline flow stays owned by AddLyricsClient.
 */
export function AddLyricsLanding({toolEntry}: {toolEntry: ReactNode}) {
  return (
    <LandingPage>
      <LandingHero
        eyebrow="Lyric syncing"
        title="Add synced lyrics to a chart"
        lede={
          <>
            Adding lyrics to a chart is a slow, monotonous, and repetitive task.
            This tool automatically splits and aligns syllables to a track.
          </>
        }
        trust={[...TRUST]}
        illustration={<SyllableAlignCanvas />}
        caption={
          <>
            Above: most syllables land where they are sung. The ones that land
            off the vocal are yours to drag into place in the chart editor.
          </>
        }
      />

      <ToolEntrySection
        title="Start a chart"
        intro="Pick a chart folder, .zip, or .sng that includes the song audio. You paste the lyrics on the next screen.">
        {toolEntry}
      </ToolEntrySection>

      <LandingSection
        title="What it does"
        intro="Every model runs on your machine. The last step is where you take over.">
        <div className="space-y-6">
          <StepFlow steps={ALIGN_STEPS} />
          <LandingProse>{PROVENANCE_NOTE}</LandingProse>
        </div>
      </LandingSection>

      <ScrollToStartCta>Open a chart</ScrollToStartCta>
    </LandingPage>
  );
}
