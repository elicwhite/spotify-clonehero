import * as Sentry from '@sentry/nextjs';

/** Where the id for this tab lives. Named for what it is, because a user who
 *  opens devtools must be able to see that it says nothing about them. */
export const SESSION_ID_KEY = 'sentrySessionId';

/**
 * Gives this tab an id so Sentry can count how many browsers hit an error.
 *
 * Sentry counts "users affected" from `user.id`, and nothing set one, so every
 * issue read `0 users` and 18 events from one bad extension looked the same as
 * 18 people with a broken page. Which of the two it is decides whether an issue
 * is worth fixing, and the event count cannot answer it.
 *
 * The id is a random UUID held in `sessionStorage`. It is not a name, it is not
 * derived from anything about the user or the device, and it is gone when the
 * tab closes, so it cannot follow anyone between visits and there is nothing to
 * join it against. That is why it needs no region gate, unlike the analytics in
 * `lib/analytics/region`: it counts tabs within one issue, which is all
 * triage asks of it, and deliberately not returning visitors.
 */
export function identifySession(): void {
  const id = readOrCreateSessionId();
  if (id == null) return;
  Sentry.setUser({id});
}

function readOrCreateSessionId(): string | null {
  try {
    const stored = window.sessionStorage.getItem(SESSION_ID_KEY);
    if (stored) return stored;

    const id = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_ID_KEY, id);
    return id;
  } catch {
    // Private modes and blocked storage throw on access. A session that cannot
    // be counted still reports its errors.
    return null;
  }
}
