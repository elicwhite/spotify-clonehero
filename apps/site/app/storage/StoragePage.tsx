import {LandingHero} from '@/components/landing/LandingHero';
import {LandingPage} from '@/components/landing/LandingPage';
import {LandingProse} from '@/components/landing/Prose';
import {LandingSection} from '@/components/landing/Section';

import {StoragePanel} from './StoragePanel';

/**
 * The /storage page: everything this browser holds for the site, split by what
 * happens to it when the browser runs short of room, and what can be done with
 * each part.
 *
 * It is reachable without an account on purpose. A user whose projects have
 * disappeared may never have made one, and this page is where the question
 * "where did my charts go" gets an answer instead of a guess.
 */
export function StoragePage() {
  return (
    <LandingPage>
      <LandingHero
        eyebrow="Storage"
        title="What this browser is holding for you"
        lede="Your charts and your audio never leave this browser, which means the browser decides how long they stay. Here is everything that is stored, what you can free, and what to take a copy of first."
      />

      <LandingSection
        title="This browser"
        intro="Two groups, because a browser short of room treats them differently. Your charts are what it is asked to keep. The stems and the models are what it is told it may take, and what you can free yourself at any time.">
        <StoragePanel />
      </LandingSection>

      <LandingSection
        title="Why a browser deletes it"
        intro="A browser that runs short of room deletes a whole site's data at once, without asking first. Nothing on this site is on a server, so there is nothing to restore it from.">
        <div className="space-y-4">
          <LandingProse>
            Two things guard against that. The stems and the models are held to
            a size limit, so the site asks for less room than it otherwise
            would. And the site asks the browser to promise to keep the rest.
          </LandingProse>
          <LandingProse>
            Each browser decides that promise on its own terms. Some grant it
            without asking you. Some ask you first, and some can be told no,
            which is what the panel above reports.
          </LandingProse>
          <LandingProse>
            In browsers that support separate storage areas, the stems and the
            models are also kept in an area the browser is told it may clear
            first.
          </LandingProse>
        </div>
      </LandingSection>

      <LandingSection
        title="Before you delete a chart"
        intro="Download it. A chart is the one thing here that nothing can rebuild.">
        <div className="space-y-4">
          <LandingProse>
            Download opens the same export the editor uses, so the package you
            get here is the package you would get there — a .zip or a .sng, with
            the chart, the audio and any artwork that came with it.
          </LandingProse>
          <LandingProse>
            Freeing a stem or a model costs nothing but time. The next time you
            open that song it is separated again, and the models download again
            the first time they are needed.
          </LandingProse>
        </div>
      </LandingSection>
    </LandingPage>
  );
}
