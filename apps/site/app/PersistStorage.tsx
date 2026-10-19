'use client';

import {useEffect} from 'react';
import {collectEarnedPersistence} from '@/lib/browser-storage';
import {attachStorageContext} from '@/lib/sentry/storage-context';

/**
 * Collects storage persistence on load, on the browsers that grant it without
 * showing the user anything.
 *
 * This runs site-wide rather than on the editor pages, because the eviction it
 * defends against takes the whole origin at once: a visitor who reads a
 * landing page today and separates a song next week is protected by the
 * permission earned on the first visit. A page that asked for the first time
 * on the load where the user fills the quota would be asking too late.
 *
 * The root layout does not remount on a client navigation, so this runs once
 * per full page load. A user who crosses the browser's engagement threshold
 * mid-session collects persistence on their next one.
 *
 * Renders nothing.
 */
export default function PersistStorage() {
  useEffect(() => {
    void collectEarnedPersistence().then(newlyPersisted => {
      // The Sentry tag was written at load with the old answer. Left alone, a
      // session that just earned persistence would report itself as
      // unprotected for the rest of its life.
      if (newlyPersisted) void attachStorageContext();
    });
  }, []);

  return null;
}
