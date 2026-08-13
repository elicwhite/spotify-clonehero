import {
  drumTypes,
  type Difficulty,
  type DrumType,
  type IniMetadata,
  type Instrument,
} from '@eliwhite/scan-chart';

/**
 * The compact chart shape shared by the Chorus API scan, published dump, and
 * local database ingest. It is intentionally separate from ChartResponseEncore:
 * the latter describes a full chart used by preview and chart-selection flows,
 * while the dump only carries metadata needed to populate the local index.
 *
 * Encore builds its catalog with scan-chart, so the vocabulary of these fields
 * is scan-chart's, and the types below are projected from it rather than
 * restated. Verified against the published dump: its instruments, difficulties
 * and drum types are exactly scan-chart's, with nothing extra.
 *
 * The instrument and difficulty vocabularies are left open on purpose. They
 * name scan-chart's values so those are what autocomplete offers and what a
 * reader sees, but they accept any string, because an instrument Encore adds
 * before we upgrade must land in `has_other_instruments` rather than abort the
 * ingest of 94,000 other rows. The strictness lives where this app writes its
 * own literals — see CORE_INSTRUMENTS — not where it reads someone else's data.
 */
type MirroredInstrument = Instrument | (string & {});
type MirroredDifficulty = Difficulty | (string & {});

export type ChorusChartNotesData = {
  instruments?: MirroredInstrument[];
  /** Narrowed to scan-chart's three known types; anything else is dropped. */
  drumType?: DrumType | null;
  trackHashes?: Array<{
    instrument: MirroredInstrument;
    difficulty: MirroredDifficulty;
  }>;
};

export function isDrumType(value: unknown): value is DrumType {
  return (Object.values(drumTypes) as unknown[]).includes(value);
}

/** The four instruments Find Music renders; anything else is "other". */
export const CORE_INSTRUMENTS = [
  'guitar',
  'bass',
  'keys',
  'drums',
] as const satisfies readonly Instrument[];

export type CoreInstrument = (typeof CORE_INSTRUMENTS)[number];

/**
 * song.ini fields Encore mirrors verbatim. Keyed off scan-chart's own metadata
 * type so a renamed or dropped field fails the build instead of silently
 * vanishing from the dump.
 *
 * `year` is deliberately absent: scan-chart types it as `string` because that
 * is what charters put there, and the dump carries values like
 * `"1969 (September 26)"` and `"Unknown Year"`. It is handled separately.
 */
export const INI_NUMBER_FIELDS = [
  'song_length',
  'diff_band',
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
  'diff_vocals',
] as const satisfies readonly (keyof IniMetadata)[];

export const INI_BOOLEAN_FIELDS = [
  'five_lane_drums',
  'pro_drums',
] as const satisfies readonly (keyof IniMetadata)[];

/** Fields Encore adds on top of the chart itself. */
export const ENCORE_STRING_FIELDS = [
  'name',
  'artist',
  'album',
  'genre',
  'charter',
  'md5',
  'albumArtMd5',
  'modifiedTime',
] as const;

export const ENCORE_BOOLEAN_FIELDS = ['hasVideoBackground'] as const;

export type ChorusChartDbRow = {
  [K in (typeof INI_NUMBER_FIELDS)[number]]?: number | null;
} & {
  [K in (typeof INI_BOOLEAN_FIELDS)[number]]?: boolean | null;
} & {
  name: string;
  artist: string;
  album?: string;
  genre?: string;
  /** Parsed from song.ini's free-text year; absent when it isn't a year. */
  year?: number | null;
  albumArtMd5?: string | null;
  md5: string;
  groupId: number;
  charter: string;
  hasVideoBackground?: boolean | null;
  modifiedTime: string;
  notesData?: ChorusChartNotesData | null;
};

/** The API-only cursor field is removed before a row enters the dump. */
export type ChorusApiChart = ChorusChartDbRow & {
  chartId: number;
};

export function isNewerChorusChart(
  candidate: Pick<ChorusChartDbRow, 'modifiedTime' | 'md5'>,
  current: Pick<ChorusChartDbRow, 'modifiedTime' | 'md5'>,
): boolean {
  const candidateTime = Date.parse(candidate.modifiedTime);
  const currentTime = Date.parse(current.modifiedTime);
  return (
    candidateTime > currentTime ||
    (candidateTime === currentTime && candidate.md5 > current.md5)
  );
}

/**
 * The fields the local index is keyed and ordered by: `md5` is the primary
 * key, `modifiedTime` decides which revision of an upload group wins and where
 * a client resumes scanning, and the rest are NOT NULL columns. A row missing
 * any of them cannot be stored.
 */
const REQUIRED_STRING_FIELDS = [
  'md5',
  'name',
  'artist',
  'charter',
  'modifiedTime',
] as const;

/**
 * Narrows one Encore API row to the dump's shape, or returns null when the row
 * is not storable.
 *
 * Null rather than throw, deliberately. This runs over every row of a
 * 94,000-row catalog, and a single unusable chart must cost that chart, not
 * the other 94,719. The exhaustive shape check lives in the publisher
 * (`assertPublishableDump`), where a bad dump fails CI and reaches nobody.
 */
/**
 * Copies the fields the dump carries out of an Encore API row, dropping
 * anything of the wrong type. Permissive by design: this mirrors someone
 * else's catalog, so a field we cannot read is a field we go without.
 */
export function filterKeys(chart: unknown): Partial<ChorusChartDbRow> {
  if (typeof chart !== 'object' || chart == null) return {};
  const source = chart as Record<string, unknown>;
  const result: Partial<ChorusChartDbRow> = {};

  for (const key of ENCORE_STRING_FIELDS) {
    if (typeof source[key] === 'string') result[key] = source[key];
  }

  for (const key of [...INI_NUMBER_FIELDS, 'groupId'] as const) {
    if (typeof source[key] === 'number') result[key] = source[key];
  }

  const year = parseChartYear(source['year']);
  if (year != null) result.year = year;

  for (const key of [
    ...INI_BOOLEAN_FIELDS,
    ...ENCORE_BOOLEAN_FIELDS,
  ] as const) {
    if (typeof source[key] === 'boolean') result[key] = source[key];
  }

  const notesData = source['notesData'];
  if (notesData != null && typeof notesData === 'object') {
    const sourceNotesData = notesData as Record<string, unknown>;
    const filteredNotesData: ChorusChartDbRow['notesData'] = {};
    if (Array.isArray(sourceNotesData['instruments'])) {
      filteredNotesData.instruments = sourceNotesData['instruments'].filter(
        (instrument): instrument is string => typeof instrument === 'string',
      );
    }
    if (isDrumType(sourceNotesData['drumType'])) {
      filteredNotesData.drumType = sourceNotesData['drumType'];
    }
    if (Array.isArray(sourceNotesData['trackHashes'])) {
      filteredNotesData.trackHashes = sourceNotesData['trackHashes'].flatMap(
        track => {
          if (typeof track !== 'object' || track == null) return [];
          const sourceTrack = track as Record<string, unknown>;
          return typeof sourceTrack['instrument'] === 'string' &&
            typeof sourceTrack['difficulty'] === 'string'
            ? [
                {
                  instrument: sourceTrack['instrument'],
                  difficulty: sourceTrack['difficulty'],
                },
              ]
            : [];
        },
      );
    }
    result.notesData = filteredNotesData;
  }

  return result;
}

export function toChorusChartDbRow(value: unknown): ChorusChartDbRow | null {
  const row = filterKeys(value);
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof row[field] !== 'string') return null;
  }
  if (typeof row.groupId !== 'number') return null;
  if (Number.isNaN(Date.parse(row.modifiedTime as string))) return null;
  return row as ChorusChartDbRow;
}

/**
 * song.ini's `year` is free text — scan-chart types it as `string` for that
 * reason. The published catalog carries `"Unknown Year"`, `"1969 (September
 * 26)"`, `"2000s"` and ~180 other spellings across 712 charts. A year we
 * cannot read is dropped; it is optional metadata and nothing stores it.
 */
export function parseChartYear(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const year = Number(value);
  return Number.isInteger(year) ? year : undefined;
}
