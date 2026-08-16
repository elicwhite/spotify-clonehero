import Link from 'next/link';
import {Suspense} from 'react';
import {Button} from '@/components/ui/button';
import HeaderAuthControls from '@/components/HeaderAuthControls';
import SocialLinks from '@/components/SocialLinks';

/**
 * The site's full navigation bar, shown on every page that is not an editor
 * route. A server component, rendered by `app/layout.tsx` and handed to
 * `SiteHeader` as a prop so choosing between it and the compact editor row
 * (which needs the pathname, and so needs the client) does not pull the nav
 * itself into the client bundle.
 */
export default function SiteNav() {
  return (
    <nav className="h-12 shrink-0 border-b border-border/60 px-4 md:h-16 md:px-8">
      <div className="max-w-screen-xl flex flex-wrap items-center justify-between mx-auto h-full">
        <div className="flex flex-row items-center gap-4 md:gap-8">
          <Link
            href="/"
            className="flex items-center space-x-3 rtl:space-x-reverse">
            <span className="self-center text-xl font-semibold whitespace-nowrap dark:text-white">
              Music Charts Tools
            </span>
          </Link>
          <div className="flex flex-row items-center gap-1">
            {/*
              The two audience pages. `/` is the player page, so Play and the
              brand link go to the same place; it is listed anyway because a
              wordmark is not a nav item, and a reader who has scrolled into
              /chart needs a way back that says what it is.
            */}
            <Link href="/">
              <Button variant="ghost" className="font-semibold">
                Play
              </Button>
            </Link>
            <Link href="/chart">
              <Button variant="ghost" className="font-semibold">
                Chart
              </Button>
            </Link>
          </div>
        </div>

        <nav className="flex items-center">
          <SocialLinks variant="nav" />
          <Suspense>
            <HeaderAuthControls />
          </Suspense>
        </nav>
      </div>
    </nav>
  );
}
