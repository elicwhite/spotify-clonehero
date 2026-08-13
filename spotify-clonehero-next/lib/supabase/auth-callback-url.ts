/**
 * Absolute URL of the `/auth/callback` route, for Supabase `redirectTo` and
 * `emailRedirectTo` options.
 *
 * Every sign-in, link-identity, and magic-link call must send the user back
 * to the same route. Build the URL here instead of at each call site: a
 * hand-written copy of this template once shipped with a stray `}` on the
 * end, which sent users to `/auth/callback}` and broke re-authentication.
 *
 * Client-side only — it reads `window.location.origin`.
 *
 * @param next Path to return to after the callback completes. Accepts the
 *   `null` that `URLSearchParams.get` returns, so callers can pass a
 *   missing `?next=` straight through. Empty or absent lands on the
 *   callback route's own default.
 */
export function getAuthCallbackUrl(next?: string | null): string {
  const path = next
    ? `/auth/callback?next=${encodeURIComponent(next)}`
    : '/auth/callback';
  return `${window.location.origin}${path}`;
}
