'use client';

import Link from 'next/link';

import {EditPassCanvas} from '@/app/drum-transcription/landing/EditPassCanvas';
import {BeatGridCanvas} from '@/app/tempo/landing/BeatGridCanvas';
import {FeatureBand} from '@/components/landing/FeatureBand';
import {LandingFooter} from '@/components/landing/LandingFooter';
import {LandingHero} from '@/components/landing/LandingHero';
import {LandingPage} from '@/components/landing/LandingPage';
import {LandingSection} from '@/components/landing/Section';
import {START_SECTION_ID} from '@/components/landing/ToolEntrySection';
import {buttonVariants} from '@/components/ui/button';

import {DifficultyLadder} from './illustrations/DifficultyLadder';
import {LyricSyllables} from './illustrations/LyricSyllables';

/**
 * The two model-backed steps open their tool at its entry screen, and offer
 * the rest of that page beside it. Those two landing pages carry the
 * measurements and the account of what a draft gets wrong, which is more than
 * a band on this page can hold, so the second link is worth its space here and
 * nowhere else.
 */
function StepLinks({href, label}: {href: string; label: string}) {
  return (
    <>
      <Link
        href={`${href}#${START_SECTION_ID}`}
        className={buttonVariants({variant: 'outline'})}>
        {label}
      </Link>
      <Link
        href={href}
        className={buttonVariants({variant: 'link', size: 'sm'})}>
        Learn more
      </Link>
    </>
  );
}

/** The one link on this page to a page with no tool on it. */
function WhyLink() {
  return (
    <Link href="/why" className="text-foreground underline underline-offset-2">
      Why I think automated tooling for these steps is good for the community
    </Link>
  );
}

/**
 * The `/chart` page: the charting tools, laid out as the sequence a chart
 * moves through rather than as a list.
 *
 * The order is real. A drum chart wants its tempo map before its notes,
 * because the notes are snapped to that grid, and the lower difficulties are
 * generated from a finished Expert track. Naming the steps is the only way
 * the page can answer "which of these do I open first", which a card grid
 * never could.
 *
 * `'use client'` because the two model-backed bands reuse the tool pages' own
 * hero canvases, which are client components.
 */
export function ChartPage() {
  return (
    <LandingPage>
      <LandingHero
        eyebrow="For charters"
        title="Tool-assisted charting, one step at a time"
        lede={
          <>
            Charting a song is a sequence, and each step below has a tool that
            does the repetitive part of it. Every tool hands you a draft in the
            chart editor.
          </>
        }
        trust={[
          'All processing happens on your computer. Your audio file and chart are never uploaded to a server.',
          'You review and edit the drafts, or throw them away.',
        ]}
        actions={
          <>
            <Link href="/chart-editor" className={buttonVariants()}>
              Open the chart editor
            </Link>
          </>
        }
      />

      <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
        The tools support the repetitive work, not the judgment. <WhyLink />.
      </p>

      <FeatureBand
        eyebrow="Step 1 · Tempo"
        title="Create the tempo map"
        illustration={<BeatGridCanvas />}
        actions={<StepLinks href="/tempo" label="Tempo Mapper" />}>
        <p>
          A beat-tracking model marks the beats and the downbeats. A
          postprocessing step tuned for charts fits the tempo map. A song that
          stays in 4/4 usually comes out workable, even through a speed-up or a
          drift; a song that changes meter should still be mapped by hand.
        </p>
      </FeatureBand>

      <FeatureBand
        flip
        eyebrow="Step 2 · Drum notes"
        title="Get the drum notes proposed for you"
        illustration={<EditPassCanvas />}
        actions={
          <StepLinks href="/drum-transcription" label="Drum Transcription" />
        }>
        <p>
          A trained transcription model predicts drum hits on eight lanes: kick,
          snare, three toms, hi-hat, crash, and ride. This step is drums only. A
          guitar or bass chart starts in the editor instead, and its notes are
          yours to place.
        </p>
      </FeatureBand>

      <FeatureBand
        eyebrow="Step 3 · Difficulties"
        title="Build Hard, Medium, and Easy from Expert"
        illustration={<DifficultyLadder />}
        actions={
          <>
            <Link
              href="/drum-difficulties"
              className={buttonVariants({variant: 'outline'})}>
              Drum Difficulties
            </Link>
            <Link
              href="/guitar-difficulties"
              className={buttonVariants({variant: 'outline'})}>
              Guitar Difficulties
            </Link>
          </>
        }>
        <p>
          Once the Expert track is right, the lower difficulties are generated
          from it, for drums and for guitar. This step has been automated for
          years, and the player base got three more difficulties on far more
          songs than anyone was going to chart by hand.
        </p>
      </FeatureBand>

      <FeatureBand
        flip
        eyebrow="Step 4 · Lyrics"
        title="Sync the words to the vocals"
        illustration={<LyricSyllables />}
        actions={
          <Link
            href="/add-lyrics"
            className={buttonVariants({variant: 'outline'})}>
            Add Lyrics
          </Link>
        }>
        <p>
          Paste the lyrics and they are aligned to the vocals, syllable by
          syllable, so the words land with the notes rather than with the line.
        </p>
      </FeatureBand>

      <LandingSection
        title="What comes out is a first draft"
        intro="Every step above produces a first pass, not a finished chart. Some songs come out clean and some don't, and you will see which in seconds. Keep what the tool gives you, fix the parts that are wrong, or throw it away and do that step by hand.">
        <div className="max-w-2xl space-y-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
          <p>
            The drafts are meant to save you the hours that were never musical.
            Placing hundreds of notes you already know are there is work a
            machine should do. Deciding which lane a cymbal belongs on, and what
            a chart should feel like to play, is the craft, and two good
            charters given the same song will make different calls about it.
          </p>
          <p>
            So the output opens in an editor instead of a download, and each
            tool&rsquo;s own page tells you which parts of its draft to check
            first. If a tool of mine ever makes it easier to publish something
            bad than to publish something good, that is a defect in what I
            built, and I want to know.
          </p>
          <p>
            <WhyLink />.
          </p>
        </div>
      </LandingSection>

      {/*
        Not a step. The SNG File Manager is a file utility a charter may want
        at any point, or never, and giving it a numbered band implied every
        chart passes through it on the way out. Anything else that is useful
        but not part of the sequence belongs here too.
      */}
      <LandingSection title="Other tools">
        <div className="max-w-2xl space-y-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
          <p>
            <span className="font-medium text-foreground">
              SNG File Manager
            </span>{' '}
            reads, modifies, and converts Clone Hero <code>.sng</code> files.
            Build a package from a folder or from loose files, open an existing
            one to see what is inside it, add or remove files, and convert
            between <code>.sng</code> and <code>.zip</code>.
          </p>
          <p>
            <Link
              href="/sng"
              className="text-foreground underline underline-offset-2">
              Open the SNG File Manager
            </Link>
          </p>
        </div>
      </LandingSection>

      <LandingFooter />
    </LandingPage>
  );
}
