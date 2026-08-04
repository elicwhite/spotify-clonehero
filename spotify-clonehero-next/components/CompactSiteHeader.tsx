import Link from 'next/link';
import {Suspense} from 'react';
import {Music} from 'lucide-react';
import {Button} from '@/components/ui/button';
import HeaderAuthControls from '@/components/HeaderAuthControls';
import SocialLinks from '@/components/SocialLinks';

/**
 * Compact site header shown on editor routes (owner feedback, live review
 * 2026-08-03): "we need our site header to be on the top of the page, as it
 * includes the login button and link to other tools." A slim ~40px row with
 * the same functional affordances as the full site nav (brand link home, More
 * Tools, Discord/GitHub, auth controls), styled to sit above a dark editor
 * surface. It is always on screen on an editor route; the editor's own
 * song-identity row renders directly beneath it as a separate, second row.
 *
 * Its own module rather than a second export from `SiteNav`: the chooser that
 * renders it (`SiteChrome`) is a client component, so sharing a module would
 * pull the full nav into the client graph too.
 *
 * Not a smaller `SiteNav` - a different composition. It adds the brand mark
 * (the full nav is wordmark-only). The affordances the two share - brand link
 * home, More Tools, Discord/GitHub, auth controls - are the site's standing
 * set (plan 0076 item 1 added the Discord/GitHub icons here; both headers
 * render the one `SocialLinks`, this one at its compact scale).
 */
export default function CompactSiteHeader() {
  return (
    <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b bg-background px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href="/"
          aria-label="Music Charts Tools home"
          title="Music Charts Tools"
          className="flex shrink-0 items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Music className="h-3.5 w-3.5" />
          </span>
          <span className="hidden text-sm font-semibold whitespace-nowrap sm:inline">
            Music Charts Tools
          </span>
        </Link>
        <Link href="/">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs font-semibold">
            More Tools
          </Button>
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <SocialLinks variant="compact" />
        <Suspense>
          <HeaderAuthControls />
        </Suspense>
      </div>
    </header>
  );
}
