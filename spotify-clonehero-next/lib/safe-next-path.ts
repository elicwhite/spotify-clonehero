/**
 * The `?next=` redirect target, if it stays on this site; otherwise `fallback`.
 *
 * Auth routes send the user on to `next` once sign-in completes. Redirecting
 * to an unchecked value is an open redirect: `?next=https://evil.example`
 * hands a signed-in user to another site. Only a path on this origin passes.
 *
 * A leading `/` is not enough on its own. `//evil.example` is a
 * protocol-relative URL, and browsers read `/\evil.example` the same way and
 * drop tabs and newlines, so `/\t/evil.example` is one too. Resolving against
 * a placeholder origin and checking the origin survived catches all of them.
 *
 * @param next The raw parameter. Accepts the `null` that
 *   `URLSearchParams.get` returns.
 * @param fallback Where to go when `next` is absent or leaves the site.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback: string,
): string {
  if (!next || !next.startsWith('/')) {
    return fallback;
  }
  const base = 'http://same-origin.invalid';
  try {
    if (new URL(next, base).origin !== base) {
      return fallback;
    }
  } catch {
    return fallback;
  }
  return next;
}
