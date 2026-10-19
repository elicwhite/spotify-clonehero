/**
 * The `charter` parameter on `chart_exported` (plan 0105).
 *
 * The one raw string this event sends. A charter writes this credit about
 * themselves and publishes it inside every chart they release, so it is a
 * credit rather than personal data — and it is the only field that can
 * answer which charters use the tool.
 */

import {MAX_GA_PARAM_LENGTH} from './limits';

/** Reported for a chart that credits nobody. A named value rather than an
 *  empty string, so "no charter" is something an analyst can count instead
 *  of a blank GA4 may or may not keep. */
export const UNCREDITED_CHARTER = 'uncredited';

export function charterParam(charter: string | undefined): string {
  // Truncated rather than dropped: GA4 discards a value past the limit, and
  // a truncated credit still identifies the charter in a report.
  return (
    (charter ?? '').trim().slice(0, MAX_GA_PARAM_LENGTH) || UNCREDITED_CHARTER
  );
}
