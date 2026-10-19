/**
 * Parsing and seeding for the tempo lane's BPM entry field.
 *
 * Pure, so the rules a user runs into (what counts as a number, what counts as
 * a usable tempo, how a marker's current value is shown back to them) are
 * testable without the popover around them.
 */

/**
 * Slowest committable tempo. Below 1 BPM a single beat lasts more than a
 * minute: the grid stops being usable and every later marker's ms position
 * explodes. Zero and negatives are excluded by the same bound, which matters
 * most for zero — it would make chart time stop advancing.
 */
export const MIN_BPM = 1;

/**
 * Fastest committable tempo. 999 clears the fastest real charts (the quickest
 * authored material sits in the low hundreds, and a 300 BPM double-time feel
 * is already extreme) while catching a mistyped extra digit.
 */
export const MAX_BPM = 999;

export type BpmParseResult =
  | {ok: true; bpm: number}
  | {ok: false; error: string};

/** Parse what the user typed into a committable BPM. */
export function parseBpmInput(text: string): BpmParseResult {
  const trimmed = text.trim();
  if (trimmed === '') return {ok: false, error: 'Enter a BPM'};
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return {ok: false, error: 'Enter a number'};
  if (value < MIN_BPM || value > MAX_BPM) {
    return {ok: false, error: `BPM must be ${MIN_BPM}-${MAX_BPM}`};
  }
  return {ok: true, bpm: value};
}

/**
 * The starting text for the field.
 *
 * At least one decimal, matching the tap tool's readout and the lane's
 * `Delete tempo marker (N BPM)` label. A marker whose stored value carries
 * more precision than that (BPMs are stored format-quantized, so .chart values
 * run to three decimals) is shown in full rather than truncated, so committing
 * an untouched field can never move a marker the user only meant to look at.
 */
export function formatBpmSeed(bpm: number): string {
  const full = bpm.toFixed(3).replace(/0+$/, '');
  return full.endsWith('.') ? `${full}0` : full;
}
