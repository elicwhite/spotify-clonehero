/**
 * The `/auth/login` link that returns the user to the page they are on.
 *
 * On an `/auth/` page the link keeps that page's own `next` and adds nothing
 * more, so an auth page is never a `next` target. The header "Log In" button
 * shows on the login page too, and a link that put the login page into its own
 * `next` would nest one level deeper on each click
 * (`/auth/login?next=/auth/login?next=...`).
 */
export function loginHref(
  pathname: string,
  searchParams: URLSearchParams,
): string {
  const query = searchParams.toString();
  const next = pathname.startsWith('/auth/')
    ? searchParams.get('next')
    : `${pathname}${query ? `?${query}` : ''}`;
  return next ? `/auth/login?next=${encodeURIComponent(next)}` : '/auth/login';
}
