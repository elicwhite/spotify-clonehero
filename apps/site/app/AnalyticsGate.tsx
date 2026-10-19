'use client';

import {useSyncExternalStore} from 'react';
import {analyticsEnabled} from '@/lib/analytics/environment';
import RegionAwareAnalytics from './RegionAwareAnalytics';

// The environment decides, so this cannot live in `app/layout.tsx`: the
// hostname is a client fact, and it is the only thing that tells a local dev
// server apart from a production build whose `NEXT_PUBLIC_VERCEL_ENV` went
// missing. `RegionAwareAnalytics` keeps the region cookie as its one concern.
const subscribe = () => () => {};

export default function AnalyticsGate({gaId}: {gaId: string}) {
  const enabled = useSyncExternalStore(
    subscribe,
    () =>
      analyticsEnabled(
        process.env['NEXT_PUBLIC_VERCEL_ENV'],
        window.location.hostname,
      ),
    () => false,
  );

  if (!enabled) return null;
  return <RegionAwareAnalytics gaId={gaId} />;
}
