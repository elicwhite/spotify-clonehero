import Link from 'next/link';
import {Suspense} from 'react';
import {Button} from '@/components/ui/button';
import BrandLink from '@/components/BrandLink';
import HeaderAuthControls from '@/components/HeaderAuthControls';
import SocialLinks from '@/components/SocialLinks';

/**
 * The two audience pages. `/` is the player page, so Play and the brand link
 * go to the same place; it is listed anyway because a wordmark is not a nav
 * item, and a reader who has scrolled into /chart needs a way back that says
 * what it is.
 */
const AUDIENCE_LINKS = [
  {href: '/', label: 'Play'},
  {href: '/chart', label: 'Chart'},
];

/**
 * The site's full navigation bar, shown on every page that is not an editor
 * route. A server component, rendered by `app/layout.tsx` and handed to
 * `SiteHeader` as a prop so choosing between it and the compact editor row
 * (which needs the pathname, and so needs the client) does not pull the nav
 * itself into the client bundle.
 *
 * The row never wraps. The bar is a fixed height, so a wrapped second line
 * has nowhere to go and spills out below the border. Below `md` the row
 * instead scopes `--ed-control-h` to 32px, which every control in it already
 * reads (`components/ui/button.tsx`), and `BrandLink` shrinks the wordmark to
 * the mark; that is what makes the row fit at 320px. `md` sets no token, so
 * each control falls back to its own default and the bar is unchanged from
 * the breakpoint that widens it.
 */
export default function SiteNav() {
  return (
    <nav className="h-12 shrink-0 overflow-hidden border-b border-border/60 px-3 md:h-16 md:px-8">
      <div className="max-w-screen-xl flex items-center justify-between gap-2 mx-auto h-full max-md:[--ed-control-h:2rem]">
        <div className="flex flex-row items-center gap-2 md:gap-8">
          <BrandLink variant="nav" />
          <div className="flex shrink-0 flex-row items-center gap-1">
            {AUDIENCE_LINKS.map(({href, label}) => (
              <Link key={href} href={href}>
                <Button variant="ghost" className="px-2 font-semibold md:px-4">
                  {label}
                </Button>
              </Link>
            ))}
          </div>
        </div>

        <nav className="flex shrink-0 items-center">
          <SocialLinks variant="nav" />
          <Suspense>
            <HeaderAuthControls />
          </Suspense>
        </nav>
      </div>
    </nav>
  );
}
