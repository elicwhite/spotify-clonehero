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
