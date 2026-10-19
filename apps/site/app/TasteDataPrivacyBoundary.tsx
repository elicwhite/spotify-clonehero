'use client';

import {useEffect, useRef} from 'react';
import {usePathname} from 'next/navigation';
import * as Sentry from '@sentry/nextjs';
import {rendersPersonalTasteData} from '@/lib/apple-music/private-route';
import {ensureReplayRegistered} from '@/lib/sentry/replay';

/**
 * Keeps Session Replay away from browser-local taste data.
 *
 * Errors from these routes are reported; the DOM is what must not leave, since
 * on /find-music it is the user's songs, artists, and playlists. When the first
 * page load is one of these routes, `instrumentation-client` registers no Replay
 * integration at all, so there is no buffer to leak. This adds one on the first
 * navigation to a route that may record — stopping a buffer is a weaker
 * guarantee than never creating it.
 */
export default function TasteDataPrivacyBoundary() {
  const pathname = usePathname();
  const isPrivate = rendersPersonalTasteData(pathname);
  const wasPrivate = useRef(isPrivate);

  useEffect(() => {
    if (isPrivate) {
      void Sentry.getReplay()?.stop();
    } else {
      // Registration is tracked in one place. `getReplay()` returns undefined
      // whenever no instance exists — including when the SDK is disabled — so
      // it cannot be used to tell "never registered" from "registered but
      // idle", and guessing adds a second instance that Sentry rejects.
      ensureReplayRegistered();
      if (wasPrivate.current) Sentry.getReplay()?.startBuffering();
    }
    wasPrivate.current = isPrivate;
  }, [isPrivate]);

  return null;
}
