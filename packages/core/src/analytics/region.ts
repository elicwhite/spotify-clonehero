// EU/EEA + UK + Switzerland ISO-3166-1 alpha-2 codes. Switzerland's
// revFADP (in force Sep 2023) requires similar treatment for analytics
// scripts in practice, so it's grouped with the EEA for the no-GA-loaded
// path.
const EEA_COUNTRIES = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'IS',
  'LI',
  'NO',
  'GB',
  'CH',
]);

export function isEeaCountry(country: string | null | undefined): boolean {
  return !!country && EEA_COUNTRIES.has(country.toUpperCase());
}

export const VERCEL_COUNTRY_HEADER = 'x-vercel-ip-country';
export const REGION_COOKIE = 'gaRegion';

/** The two values the proxy writes. `REGION_ALLOWED` is the only one that
 *  allows analytics: it says the visitor is outside the EEA/UK/CH. Every
 *  other state — `REGION_EEA`, missing, or corrupted — means the visitor is
 *  not processed at all. */
export const REGION_ALLOWED = 'other';
export const REGION_EEA = 'eea';

/** Reads the region cookie the proxy set. Browser only: on the server there
 *  is no cookie on `document` to read, so the answer is `null` and
 *  `analyticsAllowed` reads that as "no". */
export function readRegionCookie(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq) !== REGION_COOKIE) continue;
    return part.slice(eq + 1) || null;
  }
  return null;
}

/** Whether this visitor's events may be processed at all. Read by
 *  `RegionAwareAnalytics` to decide whether to load gtag.js, and by
 *  `track()` to decide whether an event reported before gtag.js exists may
 *  be held in memory until it does. */
export function analyticsAllowed(): boolean {
  return readRegionCookie() === REGION_ALLOWED;
}
