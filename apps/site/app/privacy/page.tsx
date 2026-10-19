import type {Metadata} from 'next';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What Music Charts Tools collects, where Google Analytics runs, and how to opt out.',
};

export default function PrivacyPage() {
  return (
    <article className="max-w-2xl mx-auto py-8 px-4 space-y-4 text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:mt-0 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-6 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs">
      <h1>Privacy</h1>

      <p>
        Music Charts Tools is a browser-based set of utilities for working with
        Clone Hero charts. Most of what the tools do — scanning your local songs
        folder, viewing sheet music, transcribing drums, aligning lyrics — runs
        entirely in your browser. Files you load never leave your device.
      </p>

      <h2>Where Google Analytics runs</h2>

      <p>
        We use Google Analytics 4 (measurement ID <code>G-LEE7EDJH14</code>)
        only for visitors <strong>outside</strong> the EEA, UK, and Switzerland.
        The classification happens at the edge: our proxy reads Vercel&apos;s{' '}
        <code>x-vercel-ip-country</code> header on the first request and writes
        a <code>gaRegion=eea|other</code> cookie. For visitors classified as{' '}
        <code>eea</code>, the page does not load <code>gtag.js</code> or any
        other analytics script — there is no analytics processing happening, so
        there is nothing to consent to. The IP itself is not stored or sent to
        Google Analytics; only the coarse country label is used to gate the
        script.
      </p>

      <h2>What GA receives (for tracked visitors)</h2>

      <ul>
        <li>Standard pageviews (URL path, referrer, browser, device type).</li>
        <li>Approximate location derived from IP at country level.</li>
        <li>
          Custom events for feature usage and conversion funnels — e.g. &quot;a
          chart was downloaded from Find Music&quot;, &quot;a sheet-music viewer
          was opened&quot;, &quot;a lyric was manually moved before
          export&quot;. The full list lives in{' '}
          <code>lib/analytics/track.ts</code> in the source repo.
        </li>
        <li>
          When a chart is exported from the chart editor: the{' '}
          <code>charter</code> credit written in that chart&apos;s{' '}
          <code>song.ini</code> — the name a charter publishes with their own
          work — plus which tools were used on it. This is how we know which
          charters the editing tools are useful to.
        </li>
        <li>
          With that export, a short checksum of the song&apos;s artist and
          title, so that exporting the same chart twice can be counted once. The
          artist and title themselves are never sent. The checksum is not a
          secret: it cannot be unscrambled on its own, but someone holding both
          it and a list of songs could confirm which one it matches.
        </li>
        <li>
          For signed-in users, your Supabase user ID (a UUID) so a session can
          be stitched across devices. No email or other PII is sent.
        </li>
      </ul>

      <h2>Error reporting</h2>

      <p>
        We report errors to Sentry to help improve the reliability of the site.
      </p>

      <h2>What we don&apos;t collect</h2>

      <ul>
        <li>No advertising identifiers; we run no ads.</li>
        <li>
          No third-party trackers beyond Google Analytics and the error
          reporting above.
        </li>
        <li>
          No content of files you load: audio, charts, lyrics, and Spotify
          history all stay in your browser&apos;s storage (OPFS / SQLocal /
          localStorage). The one exception is the export event described above,
          which sends the charter credit and a hash of the song&apos;s identity
          — never notes, audio, lyrics, or the song title.
        </li>
      </ul>

      <h2>Retention</h2>

      <p>
        Google Analytics retains event-level data for 14 months by default; we
        have not changed that retention. Aggregated reports remain available
        indefinitely.
      </p>

      <h2>Opting out (visitors outside the EEA/UK/CH)</h2>

      <p>
        Visitors classified as <code>other</code> (i.e. outside EEA/UK/CH) who
        want to opt out of Google Analytics can use any of the standard tools:
      </p>

      <ul>
        <li>
          Google&apos;s official browser opt-out add-on:{' '}
          <a
            href="https://tools.google.com/dlpage/gaoptout"
            rel="noreferrer"
            target="_blank">
            tools.google.com/dlpage/gaoptout
          </a>
          .
        </li>
        <li>
          Browser tracking-protection features: uBlock Origin, Brave&apos;s
          shields, Firefox&apos;s Enhanced Tracking Protection, Safari&apos;s
          Intelligent Tracking Prevention. All of these block{' '}
          <code>gtag.js</code> by default or on demand.
        </li>
      </ul>

      <h2>Contact</h2>

      <p>
        Questions about this policy can go to the project&apos;s GitHub
        repository:{' '}
        <a href="https://github.com/elicwhite/spotify-clonehero">
          github.com/elicwhite/spotify-clonehero
        </a>
        .
      </p>
    </article>
  );
}
