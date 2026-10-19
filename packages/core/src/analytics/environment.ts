const LOCAL_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  '::1',
]);

/** A hostname that only a developer can be looking at. `*.localhost` covers
 *  the per-app subdomains a dev server can be reached on. */
export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
}

/**
 * Whether this page should report to Google Analytics at all — a separate
 * question from whether the visitor may be processed, which the region cookie
 * answers in `RegionAwareAnalytics`.
 *
 * `pnpm dev` reported into the production property until this existed, and a
 * developer refreshing a page was 38% of every pageview in the 28 days to
 * 2026-08-25. It put routes that exist only locally into the top-50 pages and
 * inflated `/chart-editor` engagement time by 31%.
 *
 * An unknown environment reports. `NEXT_PUBLIC_VERCEL_ENV` went missing in
 * production for 11 days once already and took Sentry with it silently (see
 * `plans/completed/0125-build-env-after-ci-move.md`); if that happens again,
 * losing every production number is far worse than the dev noise this
 * function exists to stop, and the hostname still keeps localhost out.
 *
 * Preview deployments do report. `cloneherocharts.vercel.app` is indexed by
 * Google and carries real users — 272 of them in the 28 days above, from 30
 * countries — so it is a live host, not a staging one.
 */
export function analyticsEnabled(
  vercelEnvironment: string | undefined,
  hostname: string,
): boolean {
  if (vercelEnvironment === 'production' || vercelEnvironment === 'preview') {
    return true;
  }
  if (vercelEnvironment) return false;
  return !isLocalHostname(hostname);
}
