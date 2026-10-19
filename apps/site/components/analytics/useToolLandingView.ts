'use client';

/**
 * Reports that a tool's landing page was viewed — step 1 of the
 * chart-authoring funnel (plan 0105).
 *
 * The step survives the routes becoming redirects: a page that navigates to
 * `/chart-editor` on load can still fire this before it goes, and the gap
 * between this event and `chart_opened` is then the landing page's true
 * conversion rate — the number that says whether the page earns its place.
 */

import {useEffect, useRef} from 'react';

import {track, type LandingTool} from '@/lib/analytics/track';

export function useToolLandingView(tool: LandingTool): void {
  // One view per mounted page, not one per effect run: React's development
  // Strict Mode mounts every component twice, which would otherwise double
  // every landing figure in the funnel's widest step.
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    track({event: 'tool_landing_viewed', tool});
    // No dependency: one view per mounted page, whatever the argument does
    // afterwards. A page does not become a different tool while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
