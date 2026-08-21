import {LandingHero} from '@/components/landing/LandingHero';
import {LandingPage} from '@/components/landing/LandingPage';
import {LandingProse} from '@/components/landing/Prose';
import {LandingSection} from '@/components/landing/Section';

import {StoragePanel} from './StoragePanel';

/**
 * The /storage page: what this browser is holding for the site, and what can
 * be freed without losing work.
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
        lede="Your charts and your audio never leave this browser, which means the browser decides how long they stay. Here is what is stored, and what you can free without losing work."
      />

      <LandingSection
        title="This browser"
        intro="A separated stem is the drums or the vocals taken out of a song you added, kept so the same song does not have to be separated twice. A model is the file that does the separating.">
        <StoragePanel />
      </LandingSection>

      <LandingSection
        title="Why a browser deletes it"
        intro="A browser that runs short of room deletes a whole site's data at once, without asking first. Nothing on this site is on a server, so there is nothing to restore it from.">
        <LandingProse>
          Two things guard against that. The stems and the models are held to a
          size limit, so the site asks for less room than it otherwise would.
          And the site asks the browser to promise to keep what is left.
        </LandingProse>
        <LandingProse>
          Each browser decides that promise on its own terms. Some grant it
          without asking you. Some put the question to you, and the button above
          is where that question is asked.
        </LandingProse>
        <LandingProse>
          In browsers that support separate storage areas, the stems and the
          models are also kept in an area the browser is told it may clear
          first.
        </LandingProse>
      </LandingSection>

      <LandingSection
        title="What freeing the stems costs"
        intro="Nothing you have charted.">
        <LandingProse>
          A stem is only there to save the work of separating the same song
          again. Freeing the stems means the next time you open one of those
          songs, it is separated again. Your projects, your charts, your audio
          and your library are untouched.
        </LandingProse>
      </LandingSection>
    </LandingPage>
  );
}
