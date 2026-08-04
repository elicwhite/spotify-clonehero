import Link from 'next/link';
import {Suspense} from 'react';
import {Icons} from '@/components/icons';
import {Button} from '@/components/ui/button';
import HeaderAuthControls from '@/components/HeaderAuthControls';

/**
 * The site's full navigation bar, shown on every page that is not an editor
 * route. A server component, rendered by `app/layout.tsx` and handed to
 * `SiteHeader` as a prop so choosing between it and the compact editor row
 * (which needs the pathname, and so needs the client) does not pull the nav
 * itself into the client bundle.
 */
export default function SiteNav() {
  return (
    <nav className="border-b border-border/60 h-12 md:h-16 px-4 md:px-8">
      <div className="max-w-screen-xl flex flex-wrap items-center justify-between mx-auto h-full">
        <div className="flex flex-row gap-8">
          <Link
            href="/"
            className="flex items-center space-x-3 rtl:space-x-reverse">
            <span className="self-center text-xl font-semibold whitespace-nowrap dark:text-white">
              Music Charts Tools
            </span>
          </Link>
          <Link href="/">
            <Button variant="ghost" className="font-semibold">
              <span className="">More Tools</span>
            </Button>
          </Link>
        </div>

        <nav className="flex items-center">
          <Link
            href="https://discord.gg/EDxu95B98s"
            target="_blank"
            rel="noreferrer">
            <Button variant="ghost" size="icon" className="w-9 px-0">
              <Icons.discord className="h-4 w-4" />
              <span className="sr-only">Discord</span>
            </Button>
          </Link>
          <Link
            href="https://github.com/TheSavior/spotify-clonehero"
            target="_blank"
            rel="noreferrer">
            <Button variant="ghost" size="icon" className="w-9 px-0">
              <Icons.gitHub className="h-4 w-4" />
              <span className="sr-only">GitHub</span>
            </Button>
          </Link>
          <Suspense>
            <HeaderAuthControls />
          </Suspense>
        </nav>
      </div>
    </nav>
  );
}
