'use client';

import {type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import CompactSiteHeader from '@/components/CompactSiteHeader';
import {cn} from '@/lib/utils';

/**
 * Per-route chrome: which header a route renders, and how much gutter
 * `<main>` gives it.
 *
 * These are two independent decisions, which is the whole point of this
 * table. Deriving the gutter from "is this an editor route" is what left
 * `/find-music` — a dashboard that wants the regular nav and no gutter —
 * with no way to say so, so it cancelled the gutter back out with a
 * hard-coded `-m-4 w-[calc(100%+2rem)]` that would have broken silently the
 * day the gutter changed.
 *
 * They are two fields of one entry rather than two lists because a route
 * belongs to exactly one chrome policy. Two lists let a route appear in both
 * and make one of them silently win.
 *
 * Matched by prefix, first match wins, so a more specific prefix must come
 * before a less specific one. Anything unlisted gets `DEFAULT_CHROME`.
 */
const ROUTE_CHROME: readonly {
  prefix: string;
  header: 'compact' | 'nav';
  /**
   * The inset `<main>` applies. Editor routes use `0.75rem` rather than the
   * full `1rem` (plan 0076 items 3-4) and no top padding, so the compact
   * header's bottom border sits flush on the sidebar/main-pane border.
   * Full-bleed routes lay out their own header row and panes edge to edge,
   * so they take none.
   */
  gutter: string;
}[] = [
  // Routes that render (or lead into) the chart editor shell, per plan 0074
  // Phase 7 task 7b's audit: every page that mounts `ChartEditor` somewhere
  // in its tree, directly or via a picker/upload screen that precedes it.
  //
  // `/drum-transcription` and `/tempo` are deliberately absent: both are
  // landing pages, and landing pages carry the regular site nav (owner
  // feedback, 2026-08-06). `/tempo` does mount `ChartEditor` once a song has
  // been mapped, so it trades the compact header on that screen for the
  // regular header on its landing screen; matching is by pathname, so the
  // two cannot differ within one route.
  {prefix: '/chart-editor', header: 'compact', gutter: 'px-3 pb-3'},
  {prefix: '/drum-difficulties', header: 'compact', gutter: 'px-3 pb-3'},
  {prefix: '/guitar-difficulties', header: 'compact', gutter: 'px-3 pb-3'},
  {prefix: '/add-lyrics', header: 'compact', gutter: 'px-3 pb-3'},
  {prefix: '/preview', header: 'compact', gutter: 'px-3 pb-3'},
  // Lays out its own header row, rail, and panes, so it takes the regular
  // nav and no gutter.
  {prefix: '/find-music', header: 'nav', gutter: ''},
];

const DEFAULT_CHROME = {header: 'nav', gutter: 'p-4'} as const;

function chromeFor(pathname: string) {
  return (
    ROUTE_CHROME.find(
      entry =>
        pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`),
    ) ?? DEFAULT_CHROME
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
  const pathname = usePathname() ?? '';
  if (chromeFor(pathname).header === 'nav') {
    return <>{siteNav}</>;
  }
  return <CompactSiteHeader />;
}

/**
 * `app/layout.tsx`'s single `<main>` landmark, and the owner of the outer
 * gutter. A page never subtracts this gutter back out; if it wants a
 * different one, it gets an entry in `ROUTE_CHROME`.
 *
 * Lives beside `SiteHeader` (same client boundary) rather than in the root
 * layout so both reads of `ROUTE_CHROME` sit together.
 */
export function SiteMain({children}: {children: ReactNode}) {
  const pathname = usePathname() ?? '';
  return (
    <main
      className={cn(
        'flex flex-col flex-1 items-center align-center min-h-0',
        chromeFor(pathname).gutter,
      )}>
      {children}
    </main>
  );
}
