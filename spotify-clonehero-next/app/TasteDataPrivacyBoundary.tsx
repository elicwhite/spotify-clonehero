'use client';

import {useEffect, useRef} from 'react';
import {usePathname} from 'next/navigation';
import * as Sentry from '@sentry/nextjs';
import {isTasteDataPrivateRoute} from '@/lib/apple-music/private-route';

/** Stops Replay while browser-local taste data can be rendered. */
export default function TasteDataPrivacyBoundary() {
  const pathname = usePathname();
  const isPrivate = isTasteDataPrivateRoute(pathname);
  const wasPrivate = useRef(isPrivate);

  useEffect(() => {
    const replay = Sentry.getReplay();
    if (isPrivate) {
      void replay?.stop();
    } else if (wasPrivate.current) {
      replay?.startBuffering();
    }
    wasPrivate.current = isPrivate;
  }, [isPrivate]);

  return null;
}
