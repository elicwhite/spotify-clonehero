import Link from 'next/link';
import type {ReactNode} from 'react';

import {cn} from '@/lib/utils';

/**
 * The last block on a cohort page: an optional closing line, then the site
 * links.
 *
 * The old card-grid home page ended with a small right-aligned Privacy link,
 * and losing it when that page was replaced would have quietly dropped the
 * only route to the privacy policy from the front door. It keeps that
 * treatment — extra small, muted, right-aligned — because a policy link is
 * navigation, not content, and giving it body-copy weight would make it
 * compete with the closing line above it.
 *
 * Storage sits beside it for the same reason, and because of who needs it: a
 * user whose projects have disappeared has no tool page left to find the
 * explanation on, so the link has to be somewhere every page carries.
 *
 * `children` is the closing line, which is content: `/`'s doorway through to
 * the charting tools. Pages with nothing to say there render the link row
 * alone.
 */
export function LandingFooter({children}: {children?: ReactNode}) {
  return (
    <footer className="border-t border-border pt-8">
      {children ? (
        <div className="text-sm leading-relaxed text-muted-foreground sm:text-base">
          {children}
        </div>
      ) : null}
      <div
        className={cn(
          'flex justify-end gap-4 text-xs text-muted-foreground',
          children ? 'mt-8' : null,
        )}>
        <Link href="/storage" className="hover:underline">
          Storage
        </Link>
        <Link href="/privacy" className="hover:underline">
          Privacy
        </Link>
      </div>
    </footer>
  );
}
