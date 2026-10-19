'use client';

import {useEffect, useSyncExternalStore} from 'react';
import {GoogleAnalytics} from '@next/third-parties/google';
import {analyticsAllowed} from '@/lib/analytics/region';
import {flushPendingEvents} from '@/lib/analytics/track';

// Renders <GoogleAnalytics> only when the proxy explicitly classified the
// visitor as outside the EEA/UK/CH (region cookie === 'other'). EEA/UK/CH
// visitors never load gtag.js — there's nothing to consent to. Any other
// state (cookie missing, corrupted, or 'eea') also skips GA: the whole
// point of this rewrite is "if we don't know, don't process." A missing
// cookie can mean cookies disabled, a privacy extension stripped it, or
// some routing edge case bypassed the proxy — in all of those, defaulting
// to no-GA is the right call.
// Find Music is not excluded. `track()` only accepts `AnalyticsEvent`, a closed
// union with no song, artist or playlist name in any member, so funnel data from
// that page carries what the user did and not which songs they did it to.
// `chart_exported` is the one member carrying anything chart-derived: the
// `charter` credit, which a charter publishes with their own work, and an
// opaque hash of the song's identity that makes a repeat export countable
// without the title. See `app/privacy/page.tsx`.
export default function RegionAwareAnalytics({gaId}: {gaId: string}) {
  // The region cookie is fixed for the session, so subscribe is a no-op and we
  // read it directly. SSR renders nothing; the client resolves the real value.
  const shouldLoad = useSyncExternalStore(
    () => () => {},
    analyticsAllowed,
    () => false,
  );

  // Events reported before this component decided to load gtag.js are held
  // in memory by `track()`, and this is the first moment they can be sent.
  // The flush belongs in this component's own effect, not in a mount effect
  // anywhere else: React runs the child <GoogleAnalytics> effects first, so
  // by the time this runs the init script has defined `gtag` and pushed
  // `config`. An event pushed ahead of `config` is not attributed to the
  // property, and a mount effect on any page runs a whole commit before the
  // store resolves the cookie and mounts GA at all.
  useEffect(() => {
    if (shouldLoad) flushPendingEvents();
  }, [shouldLoad]);

  if (!shouldLoad) return null;
  return <GoogleAnalytics gaId={gaId} />;
}
