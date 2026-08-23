/**
 * Resolved canonical URL for the deployed site.
 *
 * Used by Next's `metadataBase` so relative `og:image` / `twitter:image`
 * paths get upgraded to absolute URLs. Link-unfurl services (Discord, Slack,
 * Bluesky) refuse a preview image they cannot fetch, so a wrong value here
 * costs every social card its image.
 *
 * The domain is a constant because it is a fact about this project, and
 * because metadata is baked in at build time, where a value read from the
 * environment can go missing without anything failing.
 *
 * `NEXT_PUBLIC_SITE_URL` overrides it, for a preview deployment that must
 * unfurl against its own domain. Development answers localhost, which no
 * unfurl service will fetch either, but which keeps `metadataBase` valid.
 */
const CANONICAL_SITE_URL = 'https://musiccharts.tools';

export function getSiteUrl(): URL {
  const override = process.env['NEXT_PUBLIC_SITE_URL'];
  if (override) {
    return new URL(override);
  }
  return new URL(
    process.env.NODE_ENV === 'production'
      ? CANONICAL_SITE_URL
      : 'http://localhost:3000',
  );
}
