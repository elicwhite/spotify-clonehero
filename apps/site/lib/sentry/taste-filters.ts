import type {Breadcrumb} from '@sentry/nextjs';

/** Only the field these filters read, so the SDK's exact event type is not needed. */
type EventWithRequestUrl = {request?: {url?: string | undefined} | undefined};
import {rendersPersonalTasteData} from '@/lib/apple-music/private-route';

/**
 * What may leave a route whose DOM shows the user's own library.
 *
 * Errors from those routes are wanted — a sign-in that fails, a dead sidebar
 * button, a download that errors. What is not wanted is which songs the user
 * did it to. These filters are what keeps the second out, and they live here
 * rather than inline in `Sentry.init` so a test can call the same code the SDK
 * calls.
 */

/** Breadcrumb categories whose payload is the user's library, not their action. */
const LIBRARY_BEARING = new Set(['console', 'fetch', 'xhr']);

/**
 * Attributes Sentry copies into a `ui.*` breadcrumb message
 * (`@sentry/core` `utils/browser.js`, `['aria-label','type','name','title','alt']`),
 * for the target and up to five ancestors.
 *
 * On Find Music those attributes are the library: the recommendation dismiss
 * button is labelled `Not interested in <song> by <artist>`, and an exclusion
 * chip is labelled with whatever the user typed. Keeping the breadcrumb and
 * dropping the attributes preserves what was clicked without naming it.
 */
const SERIALIZED_ATTRIBUTES = /\[(?:aria-label|title|alt|name)="[^"]*"\]/g;

function pathnameOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}

/**
 * Prefers the event's own URL over the current location. A transaction is sent
 * asynchronously after its root span ends, so by then the user may have
 * navigated and `window.location` no longer describes the event.
 */
export function isTasteDataTransaction(
  event: EventWithRequestUrl,
  currentPathname: string | undefined,
): boolean {
  const eventPathname = pathnameOf(event.request?.url);
  return rendersPersonalTasteData(eventPathname ?? currentPathname);
}

export function filterTasteTransaction<T extends EventWithRequestUrl>(
  event: T,
  currentPathname: string | undefined,
): T | null {
  return isTasteDataTransaction(event, currentPathname) ? null : event;
}

export function filterTasteBreadcrumb(
  breadcrumb: Breadcrumb,
  currentPathname: string | undefined,
): Breadcrumb | null {
  if (!rendersPersonalTasteData(currentPathname)) return breadcrumb;

  if (breadcrumb.category && LIBRARY_BEARING.has(breadcrumb.category)) {
    return null;
  }

  if (breadcrumb.category?.startsWith('ui.') && breadcrumb.message) {
    return {
      ...breadcrumb,
      message: breadcrumb.message.replace(SERIALIZED_ATTRIBUTES, ''),
    };
  }

  return breadcrumb;
}
