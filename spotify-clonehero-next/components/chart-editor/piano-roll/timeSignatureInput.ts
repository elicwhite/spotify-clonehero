/**
 * Parsing for the tempo lane's time-signature entry fields.
 *
 * Pure, so the rules a user runs into (which numerators count, which
 * denominators the `.chart` format can encode) are testable without the
 * popover around them.
 *
 * A `.chart` TS event writes the denominator as a power-of-two exponent, so
 * only powers of two are expressible; the same {@link MAX_TS_DENOMINATOR}
 * bound the bar-line planner searches up to applies here.
 */

import {MAX_TS_DENOMINATOR} from '@/lib/chart-edit';

/** Denominators a `.chart` TS event can encode, coarse → fine. */
export const TS_DENOMINATORS: readonly number[] = [1, 2, 4, 8, 16, 32, 64];

/**
 * Largest numerator a bar may carry. 64 beats is already four times a long
 * 16/4 bar and catches a mistyped extra digit; the format itself writes the
 * numerator as a single byte.
 */
export const MAX_TS_NUMERATOR = 64;

export type MeterParseResult =
  | {ok: true; numerator: number; denominator: number}
  | {ok: false; error: string};

/** Parse the two typed fields into a committable meter. */
export function parseMeterInput(
  numeratorText: string,
  denominatorText: string,
): MeterParseResult {
  const numerator = parseCount(numeratorText);
  if (numerator === null || numerator < 1 || numerator > MAX_TS_NUMERATOR) {
    return {ok: false, error: `Beats per bar must be 1-${MAX_TS_NUMERATOR}`};
  }
  const denominator = parseCount(denominatorText);
  if (denominator === null || !TS_DENOMINATORS.includes(denominator)) {
    return {
      ok: false,
      error: `Beat unit must be a power of two up to ${MAX_TS_DENOMINATOR}`,
    };
  }
  return {ok: true, numerator, denominator};
}

/** A whole positive number, or null for anything else the field may hold. */
function parseCount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}
