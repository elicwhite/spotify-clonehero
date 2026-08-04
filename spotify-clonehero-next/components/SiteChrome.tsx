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
 */
const EDITOR_ROUTES = [
  '/chart-editor',
  '/drum-difficulties',
  '/guitar-difficulties',
  '/drum-transcription',
  '/tempo',
  '/add-lyrics',
  '/preview',
] as const;

function isEditorRoute(pathname: string): boolean {
  return EDITOR_ROUTES.some(
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
  if (!isEditorRoute(pathname ?? '')) {
    return <>{siteNav}</>;
  }
  return <CompactSiteHeader />;
}

/**
 * `app/layout.tsx`'s single `<main>` landmark. Editor routes carry no top
 * padding, so the compact header's bottom border sits flush on the
 * sidebar/main-pane border (plan 0076 item 2); non-editor routes keep the
 * full `p-4`. Lives beside `SiteHeader` (same route check, same client
 * boundary) rather than in the root layout so the route list has one place
 * to stay in sync, per `feedback_no_reexports`-style single-source rules.
 *
 * The inset on editor routes is `0.75rem` (`px-3 pb-3`) rather than the full
 * `1rem`, matching the prototype's tighter outer gutter on the sidebar's left
 * edge and the highway's right edge (plan 0076 items 3-4). `ChartEditor`'s
 * grid adds no gutter of its own between the sidebar and the highway, so this
 * wrapper's inset is the only outer padding on editor routes.
 */
export function SiteMain({children}: {children: ReactNode}) {
  const pathname = usePathname();
  const editor = isEditorRoute(pathname ?? '');
  return (
    <main
      className={cn(
        'flex flex-col flex-1 items-center align-center min-h-0',
        editor ? 'px-3 pb-3' : 'p-4',
      )}>
      {children}
    </main>
  );
}
