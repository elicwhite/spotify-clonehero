'use client';

import type {ReactNode} from 'react';

import {TooltipProvider} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';

/**
 * The shell every tool landing page opens with: the measure, the vertical
 * rhythm between sections, and the lane-color scope the hero canvases read.
 *
 * The `TooltipProvider` lives here because provenance tooltips are not
 * optional decoration: `docs/landing-page-style-guide.md` §6 requires every
 * number to surface its source from the number itself, and `StatChip` /
 * `StatCell` need a provider ancestor to do that. Owning it here means a page
 * cannot put a measured figure on screen without one.
 *
 * `.landing-lanes` (`app/globals.css`) scopes the five drum-lane gem colors to
 * this subtree so nothing else in the app picks them up by accident.
 */
export function LandingPage({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn(
          'landing-lanes w-full max-w-4xl space-y-12 py-8 sm:py-12',
          className,
        )}>
        {children}
      </div>
    </TooltipProvider>
  );
}
