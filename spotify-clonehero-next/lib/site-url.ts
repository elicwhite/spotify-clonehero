/**
 * Resolved canonical URL for the deployed site.
 *
 * Used by Next's `metadataBase` so relative `og:image` / `twitter:image`
 * paths get upgraded to absolute URLs. Without this, link-unfurl
 * services (Discord, Slack, Bluesky) refuse to load the preview image
 * and the card shows text only.
 *
 * Resolution order:
 *   1. `NEXT_PUBLIC_SITE_URL` — explicit canonical (e.g.
 *      `https://musiccharts.tools`). Always preferred when set.
 *   2. `VERCEL_PROJECT_PRODUCTION_URL` (production builds only) — the
 *      canonical project domain Vercel assigns (e.g. `my-app.vercel.app`).
 *      Public; not behind deployment protection.
 *   3. `VERCEL_URL` — deployment-specific subdomain (e.g.
 *      `my-app-abc123-team.vercel.app`). On most projects this URL sits
 *      behind Vercel's deployment-protection auth wall, which means
 *      Discord can fetch the page (via the canonical) but not the
 *      og:image (against the deployment subdomain). Used as a last-resort
 *      fallback for preview deployments where nothing else is set.
 *   4. localhost:3000 — dev fallback. Discord doesn't unfurl localhost
 *      anyway; this exists so `metadataBase` is always a valid URL.
 */
export function getSiteUrl(): URL {
  if (process.env['NEXT_PUBLIC_SITE_URL']) {
    return new URL(process.env['NEXT_PUBLIC_SITE_URL']);
  }
  if (
    process.env['VERCEL_ENV'] === 'production' &&
    process.env['VERCEL_PROJECT_PRODUCTION_URL']
  ) {
    return new URL(`https://${process.env['VERCEL_PROJECT_PRODUCTION_URL']}`);
  }
  if (process.env['VERCEL_URL']) {
    return new URL(`https://${process.env['VERCEL_URL']}`);
  }
  return new URL('http://localhost:3000');
}
