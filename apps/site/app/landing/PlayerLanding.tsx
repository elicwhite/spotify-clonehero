import Link from 'next/link';

import {FeatureBand} from '@/components/landing/FeatureBand';
import {LandingFooter} from '@/components/landing/LandingFooter';
import {LandingHero} from '@/components/landing/LandingHero';
import {LandingPage} from '@/components/landing/LandingPage';
import {buttonVariants} from '@/components/ui/button';

import {DrumNotationBar} from './illustrations/DrumNotationBar';
import {MusicSources} from './illustrations/MusicSources';

/**
 * The site's front door: everything here is for someone who wants songs to
 * play rather than charts to make.
 *
 * The home page used to be a card grid listing every tool at equal weight,
 * which served neither audience — a player looking for songs had to read past
 * the charting tools to find the two that were for them. There are exactly
 * two player tools, so this page carries exactly two bands, and it closes
 * with the doorway to `/chart` rather than a list of the charting tools. A
 * player who wants a song nobody has charted is the only reader that link is
 * for.
 */
export function PlayerLanding() {
  return (
    <LandingPage>
      <LandingHero
        eyebrow="For players"
        title="Play the songs you already love"
        lede={
          <>
            Find, download, and practice charts for the music you already know.
          </>
        }
        trust={[
          'Everything runs in your browser. Nothing to install.',
          'Your music library and your Songs folder stay on your computer.',
        ]}
      />

      <FeatureBand
        title="Charts for the music you already listen to"
        illustration={<MusicSources />}
        actions={
          <Link href="/find-music" className={buttonVariants()}>
            Find Music
          </Link>
        }>
        <p>
          Connect Spotify or Apple Music, or both, and Find Music matches your
          library and your listening history against Chorus. Charts install
          directly to your Songs folder.
        </p>
      </FeatureBand>

      <FeatureBand
        flip
        title="Drum charts as sheet music"
        illustration={<DrumNotationBar />}
        actions={
          <Link href="/sheet-music" className={buttonVariants()}>
            Drum Sheet Music
          </Link>
        }>
        <p>
          Play and practice any Clone Hero drum chart, rendered as notation and
          synced to the audio. A generated click track keeps you honest, and
          when a chart ships separate audio stems you can mute the drums and
          play the part yourself.
        </p>
      </FeatureBand>

      <LandingFooter>
        <p>
          Want the song you&rsquo;re looking for to exist?{' '}
          <Link
            href="/chart"
            className="text-foreground underline underline-offset-2">
            Use our charter assisted tools
          </Link>
          .
        </p>
      </LandingFooter>
    </LandingPage>
  );
}
