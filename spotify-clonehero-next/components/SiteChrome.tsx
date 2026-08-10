'use client';

import {type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import CompactSiteHeader from '@/components/CompactSiteHeader';
import {cn} from '@/lib/utils';

/**
 * Routes whose pages render (or lead into) the chart editor shell
 * (`ChartEditor`), per plan 0074 Phase 7 task 7b's route audit: every page
 * that mounts `ChartEditor` somewhere in its tree, either directly or via a
 * picker/upload screen that precedes it. These routes get the compact site
 * header instead of the full site nav.
 *
 * `/drum-transcription` and `/tempo` are not on this list: both are landing
 * pages, and landing pages carry the regular site nav (owner feedback,
 * 2026-08-06). `/tempo` does mount `ChartEditor` once a song has been
 * mapped, so it trades the compact header on that screen for the regular
 * header on its landing screen; the route check is by pathname, so the two
 * cannot differ within one route.
 */
const EDITOR_ROUTES = [
  '/chart-editor',
  '/drum-difficulties',
  '/guitar-difficulties',
  '/add-lyrics',
  '/preview',
] as const;

/**
 * Routes that lay out their own full-bleed shell (their own header row, rail,
 * and panes) and therefore want `<main>` to contribute no gutter, while still
 * taking the regular site nav above them.
 *
 * This is deliberately a separate list from `EDITOR_ROUTES`. Which header a
 * route gets and how much gutter `<main>` gives it are two independent
 * decisions, and collapsing them into one check is what forced
 * `/find-music` to cancel the gutter back out with a hard-coded
 * `-m-4 w-[calc(100%+2rem)]` that silently broke if `p-4` ever changed.
 */
const FULL_BLEED_ROUTES = ['/find-music'] as const;

function matchesRoute(pathname: string, routes: readonly string[]): boolean {
  return routes.some(
    route => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * Site-wide header. Editor routes get the compact site header (owner
 * feedback, live review 2026-08-03: the site header - brand link home, More
 * Tools, login/account - stays visible at the very top of every editor route,
 * just in a compact ~40px row instead of the full nav). Every other route
 * gets the full site nav, unchanged.
 *
 * The compact header is always present on an editor route; it never competes
 * with a page's own chrome, because the editor's song-identity row
 * (`components/chart-editor/EditorHeaderRow.tsx`) is a second, separate row
 * beneath it rather than a slot the two share.
 */
export default function SiteHeader({siteNav}: {siteNav: ReactNode}) {
  const pathname = usePathname();
  if (!matchesRoute(pathname ?? '', EDITOR_ROUTES)) {
    return <>{siteNav}</>;
  }
  return <CompactSiteHeader />;
}

/**
 * `app/layout.tsx`'s single `<main>` landmark, and the owner of the outer
 * gutter. Three cases:
 *
 * - Editor routes inset by `0.75rem` (`px-3 pb-3`) and carry no top padding,
 *   so the compact header's bottom border sits flush on the sidebar/main-pane
 *   border (plan 0076 items 2-4). `ChartEditor`'s grid adds no gutter of its
 *   own, so this wrapper's inset is the only outer padding there.
 * - Full-bleed routes get no gutter at all, because they lay out their own
 *   header row and panes edge to edge.
 * - Everything else keeps the full `p-4`.
 *
 * Lives beside `SiteHeader` (same client boundary) rather than in the root
 * layout so the route lists have one place to stay in sync.
 */
export function SiteMain({children}: {children: ReactNode}) {
  const pathname = usePathname() ?? '';
  const editor = matchesRoute(pathname, EDITOR_ROUTES);
  const fullBleed = matchesRoute(pathname, FULL_BLEED_ROUTES);
  return (
    <main
      className={cn(
        'flex flex-col flex-1 items-center align-center min-h-0',
        editor && 'px-3 pb-3',
        !editor && !fullBleed && 'p-4',
      )}>
      {children}
    </main>
  );
}
