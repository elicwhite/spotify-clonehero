import Link from 'next/link';
import type {ReactNode} from 'react';

import {CardGrid, CardGridCell} from '@/components/landing/CardGrid';
import {ExternalLink} from '@/components/landing/ExternalLink';
import {LandingHero} from '@/components/landing/LandingHero';
import {LandingPage} from '@/components/landing/LandingPage';
import {LandingSection} from '@/components/landing/Section';

const DISCORD_URL = 'https://discord.gg/EDxu95B98s';

/** The three groups, and the different thing better tooling does for each. */
const GROUPS: {who: string; problem: string; hope: string}[] = [
  {
    who: 'Charters',
    problem:
      'Charting a song takes hours, and a lot of those hours go to work that is repetitive rather than musical.',
    hope: 'If a song takes less time, maybe more songs get charted, and more of them are songs somebody was waiting for.',
  },
  {
    who: 'New charters',
    problem:
      'There is a steep learning curve to charting tools, and many people do not see it through.',
    hope: 'If there is less to learn before you get to the musical part, maybe more people with good ears stick with it long enough to get good.',
  },
  {
    who: 'Players charting for themselves',
    problem:
      'Some people are not publishing anything. They want to play one specific song at home tonight.',
    hope: 'The same work serves them, handed over in a different shape, and nothing they make has to reach anyone else.',
  },
];

/** One thing I hold to, stated as the heading, with what it means under it. */
function Belief({title, children}: {title: string; children: ReactNode}) {
  return (
    <div className="border-t border-border py-6 first:border-t-0 first:pt-0">
      <h3 className="text-base font-medium text-foreground sm:text-lg [text-wrap:balance]">
        {title}
      </h3>
      <div className="mt-3 max-w-2xl space-y-3 text-base leading-relaxed text-foreground/90">
        {children}
      </div>
    </div>
  );
}

/**
 * The /why page: my own account of what I am building toward and what I hold
 * to while building it. Written as a standalone position rather than as a
 * response to anyone.
 */
export function WhyPage() {
  return (
    <LandingPage>
      <LandingHero
        eyebrow="Why I build these tools"
        title="I want the songs people love to be playable, and charted well"
        lede="Everything on this site comes out of that. I only play Clone Hero drums, so that is the perspective all of it is written from."
      />

      <LandingSection
        title="What I want"
        intro="More high-quality charts for the songs Clone Hero and YARG players want to play. Old uncharted songs, niche songs, new albums.">
        <div className="max-w-2xl space-y-4 text-base leading-relaxed text-foreground/90">
          <p>
            This started with wanting to play songs I already loved, and finding
            that the ones I was most excited about had never been charted. So I
            charted some myself. Later I started playing drums in a local band,
            and the same thing happened from the other direction: the songs my
            group wanted to play had no charts either.
          </p>
          <p>
            There have historically been three ways to get a chart for a song. A
            charter charts the song they wanted to chart, you pay someone, or
            you chart it yourself. All three are bounded by how many hours
            charting takes. That is the number I am trying to move, and I want
            to move it without touching what counts as good.
          </p>
          <p>
            Building lyric alignment is where this became a principle rather
            than a habit. I could have run it over every chart on my own drive
            and been finished in an afternoon, and that would have helped
            exactly one person. Everyone else downloading those charts still
            gets no lyrics and has no idea my tool exists. The version worth
            building was the one a charter would want to use, as a first pass,
            on a chart they were going to publish anyway.
          </p>
        </div>
      </LandingSection>

      <LandingSection
        title="Who this helps, and how"
        intro="The same underlying work is worth different things to different people, and is probably worth handing to each of them in a different shape.">
        <CardGrid columns="md:grid-cols-3">
          {GROUPS.map(({who, problem, hope}) => (
            <CardGridCell key={who}>
              <span className="text-sm font-medium text-foreground">{who}</span>
              <span className="text-sm leading-relaxed text-muted-foreground">
                {problem}
              </span>
              <span className="text-sm leading-relaxed text-foreground/90">
                {hope}
              </span>
            </CardGridCell>
          ))}
        </CardGrid>
      </LandingSection>

      <LandingSection
        title="These tools already exist"
        intro="Charting is already partly automated, and where the output is good it has been welcomed.">
        <div className="max-w-2xl space-y-4 text-base leading-relaxed text-foreground/90">
          <p>
            Charters built tools that generate the lower difficulties from an
            Expert chart, and they seem broadly used now. Charters looked at
            that output, decided the quality was good enough, and the player
            base got Hard, Medium, and Easy on far more songs than anyone was
            ever going to chart by hand.
          </p>
          <p>
            The same thing happens further up the process, more quietly.
            Charters use AI to separate stems to get an isolated drum track, and
            use peak picking in a DAW to place snare and hi-hat hits off the
            waveform. That work runs on software someone had to know to find,
            install, and learn.
          </p>
          <p>
            So there are two things worth improving: how good the output is, and
            who can get at it. Mine run in a browser, free, with nothing to
            install. Someone with good ears and no audio production background
            should be able to get to the part where their judgment matters.
          </p>
        </div>
      </LandingSection>

      <LandingSection
        title="What I hold to"
        intro="These are the constraints I build under, and the reasons I picked them.">
        <div>
          <Belief title="The bar belongs where it is">
            <p>
              These games are fun because the community holds a real standard
              for what a chart has to be. I want more songs at the quality that
              already exists, not more songs at a lower one.
            </p>
          </Belief>

          <Belief title="The tools should take the repetitive work, not the judgment">
            <p>
              Placing hundreds of notes you already know are there is work a
              machine should do. Deciding which lane a cymbal belongs on, and
              what a chart should feel like to play, is the craft, and two good
              charters given the same song will make different calls about it.
            </p>
            <p>That part should not be automated.</p>
          </Belief>

          <Belief title="Every tool creates a draft">
            <p>
              What comes out of these tools is a draft, and the last step is you
              reviewing it and deciding what ships. None of them upload
              anywhere.
            </p>
            <p>
              A flood of unreviewed charts would land on the people reviewing
              submissions, and that is not a cost I want to hand them.
            </p>
          </Belief>
        </div>
      </LandingSection>

      <LandingSection
        title="These tools generate first drafts"
        intro="I do not think AI is good enough to produce a drum chart that needs no edits to clear the bar this community has, and I am glad the bar is where it is.">
        <div className="max-w-2xl space-y-4 text-base leading-relaxed text-foreground/90">
          <p>
            Everything here is a first pass for a person who is going to review
            it, which is why the output opens in an editor instead of a
            download, and why each page tells you which parts to check first.
            Getting closer still helps, because the real comparison is not a
            perfect chart against a draft. It is a draft against a song nobody
            ever charts.
          </p>
          <p>
            If a tool of mine ever makes it easier to publish something bad than
            to publish something good, that is a defect in what I built, and I
            want to know.{' '}
            <ExternalLink href={DISCORD_URL}>Tell me on Discord</ExternalLink>.
          </p>
        </div>
      </LandingSection>

      <footer className="border-t border-border pt-8 text-sm leading-relaxed text-muted-foreground">
        <p>
          Everything is free, runs on your own machine, and never uploads your
          audio or your chart.{' '}
          <Link
            href="/chart"
            className="text-foreground underline underline-offset-2">
            See the charting tools
          </Link>
          .
        </p>
      </footer>
    </LandingPage>
  );
}
