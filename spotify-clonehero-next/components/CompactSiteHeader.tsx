import {Suspense} from 'react';
import BrandLink from '@/components/BrandLink';
import HeaderAuthControls from '@/components/HeaderAuthControls';
import SocialLinks from '@/components/SocialLinks';

/**
 * Compact site header shown on editor routes (owner feedback, live review
 * 2026-08-03): "we need our site header to be on the top of the page, as it
 * includes the login button and link to other tools." A slim ~40px row with
 * the same functional affordances as the full site nav (brand link home,
 * Discord/GitHub, auth controls), styled to sit above a dark editor
 * surface. It is always on screen on an editor route; the editor's own
 * song-identity row renders directly beneath it as a separate, second row.
 *
 * Its own module rather than a second export from `SiteNav`: the chooser that
 * renders it (`SiteChrome`) is a client component, so sharing a module would
 * pull the full nav into the client graph too.
 *
 * Not a smaller `SiteNav` - a different composition. It keeps the brand mark
 * at every width, where the full nav uses the mark only as what the wordmark
 * shrinks to on mobile. The affordances the two share - brand link home,
 * Discord/GitHub, auth controls - are the site's standing set (plan 0076
 * item 1 added the Discord/GitHub icons here); each is one component that
 * both headers render, at the scale `variant` picks.
 *
 * The audience links (Play, Chart) are the full nav's alone. This row is 40px
 * on top of an editor that needs every pixel below it, and someone mid-edit is
 * not browsing; the brand link reaches both pages in one more click.
 */
export default function CompactSiteHeader() {
  return (
    <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b bg-background px-3">
      <div className="flex min-w-0 items-center gap-2">
        <BrandLink variant="compact" />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <SocialLinks variant="compact" />
        <Suspense>
          <HeaderAuthControls variant="compact" />
        </Suspense>
      </div>
    </header>
  );
}
