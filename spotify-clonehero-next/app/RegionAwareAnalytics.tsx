'use client';

import {useSyncExternalStore} from 'react';
import {GoogleAnalytics} from '@next/third-parties/google';
import {REGION_COOKIE} from '@/lib/analytics/region';

function readRegion(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq) !== REGION_COOKIE) continue;
    return part.slice(eq + 1) || null;
  }
  return null;
}

// Renders <GoogleAnalytics> only when the proxy explicitly classified the
// visitor as outside the EEA/UK/CH (region cookie === 'other'). EEA/UK/CH
// visitors never load gtag.js — there's nothing to consent to. Any other
// state (cookie missing, corrupted, or 'eea') also skips GA: the whole
// point of this rewrite is "if we don't know, don't process." A missing
// cookie can mean cookies disabled, a privacy extension stripped it, or
// some routing edge case bypassed the proxy — in all of those, defaulting
// to no-GA is the right call.
export default function RegionAwareAnalytics({gaId}: {gaId: string}) {
  // The region cookie is fixed for the session, so subscribe is a no-op and we
  // read it directly. SSR renders nothing; the client resolves the real value.
  const shouldLoad = useSyncExternalStore(
    () => () => {},
    () => readRegion() === 'other',
    () => false,
  );

  if (!shouldLoad) return null;
  return <GoogleAnalytics gaId={gaId} />;
}
