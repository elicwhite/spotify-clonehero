'use client';

import {type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import CompactSiteHeader from '@/components/CompactSiteHeader';

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
