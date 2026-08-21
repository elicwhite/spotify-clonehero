import * as Sentry from '@sentry/nextjs';
import {getStoragePressure, isStoragePersisted} from '@/lib/browser-storage';

/**
 * Attaches the origin's storage state to every later Sentry event.
 *
 * A lost chart project is reported as "my songs are gone", never as a quota
 * figure, so the two readings that would identify eviction have to already be
 * on the event when it arrives.
 *
 * They are on it from the moment this resolves, and not before. The gap is
 * real: `estimate()` is a call into the browser process, and it is slowest on
 * exactly the huge origins this exists to measure, so an error thrown in the
 * first frames — a database that will not open, say — can still arrive
 * untagged. An untagged event therefore means "unknown", never "not an
 * eviction".
 *
 * The tag is what makes the question askable across reports — how many of the
 * users who lost data had persistence refused. The context holds the numbers.
 *
 * Usage and quota are counts of bytes. They say nothing about what the user
 * has, so they are outside what `lib/sentry/taste-filters` guards.
 */
export async function attachStorageContext(): Promise<void> {
  try {
    const [pressure, persisted] = await Promise.all([
      getStoragePressure(),
      isStoragePersisted(),
    ]);

    Sentry.setTag('storage.persisted', persisted);
    Sentry.setContext(
      'storage',
      pressure == null
        ? {persisted, estimateAvailable: false}
        : {
            persisted,
            estimateAvailable: true,
            usageBytes: pressure.usageBytes,
            quotaBytes: pressure.quotaBytes,
            // Same name as `StoragePressure.ratio`, because this is the field
            // a triager searches on and a second name for one number is a
            // search that silently returns nothing. Rounded only to keep a
            // 17-digit float out of the Sentry UI.
            ratio: Number(pressure.ratio.toFixed(4)),
          },
    );
  } catch {
    // Reporting how much room the user has must never be the thing that
    // breaks the page for them.
  }
}
