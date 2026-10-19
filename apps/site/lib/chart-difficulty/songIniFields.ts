/**
 * The `song.ini` difficulty fields, and which of them a given chart should
 * actually offer.
 *
 * Field names are the canonical ones from the Clone Hero / Phase Shift
 * `song.ini` spec (see `GuitarGame_ChartFormats`, "Song.ini"): a `diff_*`
 * family carrying an integer intensity on a 0-6 scale, with `-1` as the
 * "not set" sentinel. Values outside 0-6 do occur in the wild (deliberate
 * overcharts, charter-specific scales) but are outside the production
 * contract, so this module treats anything other than `-1` or 0-6 as unset.
 */

import type {Instrument, ParsedChart} from '@/lib/chart-edit';

/** The `diff_*` keys this project can author. */
export const DIFFICULTY_FIELDS = [
  'diff_guitar',
  'diff_guitar_coop',
  'diff_rhythm',
  'diff_bass',
  'diff_drums',
  'diff_drums_real',
  'diff_keys',
  'diff_guitarghl',
  'diff_guitar_coop_ghl',
  'diff_rhythm_ghl',
  'diff_bassghl',
] as const;

export type DifficultyField = (typeof DIFFICULTY_FIELDS)[number];

/** `song.ini`'s "no intensity declared" sentinel. */
export const DIFFICULTY_UNSET = -1;

/** Inclusive bounds of the official intensity scale. */
export const DIFFICULTY_MIN = 0;
export const DIFFICULTY_MAX = 6;

/** The set of `diff_*` values a chart may carry, keyed by canonical field. */
export type DifficultyValues = Partial<Record<DifficultyField, number>>;

/** The primary `diff_*` field for each playable instrument track. */
const FIELD_BY_INSTRUMENT: Readonly<Record<Instrument, DifficultyField>> = {
  guitar: 'diff_guitar',
  guitarcoop: 'diff_guitar_coop',
  rhythm: 'diff_rhythm',
  bass: 'diff_bass',
  drums: 'diff_drums',
  keys: 'diff_keys',
  guitarghl: 'diff_guitarghl',
  guitarcoopghl: 'diff_guitar_coop_ghl',
  rhythmghl: 'diff_rhythm_ghl',
  bassghl: 'diff_bassghl',
};

/** Human-readable name for each field, as shown in the metadata editor. */
export const DIFFICULTY_FIELD_LABEL: Readonly<Record<DifficultyField, string>> =
  {
    diff_guitar: 'Guitar',
    diff_guitar_coop: 'Co-op Guitar',
    diff_rhythm: 'Rhythm Guitar',
    diff_bass: 'Bass',
    diff_drums: 'Drums',
    diff_drums_real: 'Pro Drums',
    diff_keys: 'Keys',
    diff_guitarghl: 'Guitar (6-fret)',
    diff_guitar_coop_ghl: 'Co-op Guitar (6-fret)',
    diff_rhythm_ghl: 'Rhythm Guitar (6-fret)',
    diff_bassghl: 'Bass (6-fret)',
  };

/**
 * Fields a chart carries but the metadata editor offers no row for.
 *
 * `diff_drums` is written from the Pro Drums row instead: the calculator rates
 * the Expert Pro Drums arrangement and a four-lane Pro Drums chart declares the
 * same intensity in both fields, so a second drums row would only be a way to
 * make them disagree. `diff_keys` describes an arrangement this project does
 * not edit; whatever the chart declares is carried through untouched.
 */
const NON_EDITABLE_FIELDS: ReadonlySet<DifficultyField> = new Set([
  'diff_drums',
  'diff_keys',
]);

/**
 * The `diff_*` fields worth offering for a chart: one per instrument that has
 * at least one charted track, minus {@link NON_EDITABLE_FIELDS}, in
 * {@link DIFFICULTY_FIELDS} order so the form is stable regardless of track
 * order in the file.
 *
 * A drums track offers `diff_drums_real` — Clone Hero displays the Pro Drums
 * intensity from that field, and choosing it fills `diff_drums` as well.
 */
export function difficultyFieldsForChart(
  chart: Pick<ParsedChart, 'trackData'>,
): DifficultyField[] {
  const fields = new Set<DifficultyField>();
  for (const track of chart.trackData) {
    const field = FIELD_BY_INSTRUMENT[track.instrument];
    if (!field) continue;
    fields.add(field);
    if (track.instrument === 'drums') fields.add('diff_drums_real');
  }
  return DIFFICULTY_FIELDS.filter(
    field => fields.has(field) && !NON_EDITABLE_FIELDS.has(field),
  );
}

/**
 * Normalize a raw `song.ini` intensity into either an in-range integer or
 * `null` for "not set". Absent, `-1`, non-integer, and out-of-contract values
 * (including the `666` seen in the corpus) all read as unset.
 */
export function normalizeDifficulty(value: number | undefined): number | null {
  if (value === undefined || !Number.isInteger(value)) return null;
  if (value < DIFFICULTY_MIN || value > DIFFICULTY_MAX) return null;
  return value;
}

/** Read a chart's currently-declared intensities, normalized. */
export function readDifficultyValues(
  metadata: Partial<Record<DifficultyField, number>>,
): Partial<Record<DifficultyField, number | null>> {
  const values: Partial<Record<DifficultyField, number | null>> = {};
  for (const field of DIFFICULTY_FIELDS) {
    values[field] = normalizeDifficulty(metadata[field]);
  }
  return values;
}

/** Turn the editor's `number | null` form values into the `-1`-sentinel shape
 *  `song.ini` and scan-chart's metadata expect. */
export function toIniDifficulties(
  values: Partial<Record<DifficultyField, number | null>>,
): DifficultyValues {
  const out: DifficultyValues = {};
  for (const field of DIFFICULTY_FIELDS) {
    const value = values[field];
    if (value === undefined) continue;
    out[field] = value === null ? DIFFICULTY_UNSET : value;
  }
  return out;
}
