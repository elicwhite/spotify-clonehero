/**
 * Parse the chart inside an SNG/zip package into the small summary the preview
 * card shows: song name, artist, charter, the difficulties charted for each
 * instrument, and album art.
 *
 * Uses scan-chart's `parseChartAndIni()` + `scanChart()`, which already derive
 * the instrument list, per-instrument note counts, and extracted album art in
 * one pass — so we don't reimplement chart selection or track grouping here.
 */

import {parseChartAndIni, scanChart} from '@eliwhite/scan-chart';

export interface PreviewFile {
  fileName: string;
  data: Uint8Array;
}

export type Difficulty = 'expert' | 'hard' | 'medium' | 'easy';

export const DIFFICULTY_ORDER: Difficulty[] = [
  'expert',
  'hard',
  'medium',
  'easy',
];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  expert: 'Expert',
  hard: 'Hard',
  medium: 'Medium',
  easy: 'Easy',
};

export interface ChartPreview {
  name: string;
  artist: string;
  charter: string;
  album?: string;
  /** Extracted album art (jpg bytes), if the package contains any. */
  albumArt?: Uint8Array;
  /** instruments present, each with its charted difficulties + intensity. */
  instruments: {
    instrument: string;
    /** charted difficulty tiers, hardest first */
    difficulties: Difficulty[];
    /** the chart's difficulty-intensity rating (0-6), if declared */
    intensity?: number;
  }[];
}

/** The chart's declared intensity (0-6) for an instrument, if any (>= 0). */
function intensityFor(
  scanned: ReturnType<typeof scanChart>,
  instrument: string,
): number | undefined {
  const value = (
    {
      guitar: scanned.diff_guitar,
      guitarcoop: scanned.diff_guitar_coop,
      rhythm: scanned.diff_rhythm,
      bass: scanned.diff_bass,
      drums: scanned.diff_drums,
      keys: scanned.diff_keys,
      guitarghl: scanned.diff_guitarghl,
      guitarcoopghl: scanned.diff_guitar_coop_ghl,
      rhythmghl: scanned.diff_rhythm_ghl,
      bassghl: scanned.diff_bassghl,
    } as Record<string, number | undefined>
  )[instrument];
  return value != null && value >= 0 ? value : undefined;
}

/**
 * Parse the chart in `files` into a preview summary, or `null` if the package
 * contains no parseable chart (`.chart`/`.mid`).
 */
export function parseChartPreview(files: PreviewFile[]): ChartPreview | null {
  const parseResult = parseChartAndIni(files);
  if (!parseResult.parsedChart) return null;

  // md5/btrack hashing isn't needed for a preview; skip it.
  const scanned = scanChart(files, parseResult, {
    includeMd5: false,
    includeBTrack: false,
  });
  if (!scanned.notesData) return null;

  const difficultiesByInstrument = new Map<string, Set<Difficulty>>();
  for (const {instrument, difficulty} of scanned.notesData.noteCounts) {
    const difficulties =
      difficultiesByInstrument.get(instrument) ?? new Set<Difficulty>();
    difficulties.add(difficulty);
    difficultiesByInstrument.set(instrument, difficulties);
  }

  const instruments = scanned.notesData.instruments.map(instrument => ({
    instrument,
    difficulties: DIFFICULTY_ORDER.filter(d =>
      difficultiesByInstrument.get(instrument)?.has(d),
    ),
    intensity: intensityFor(scanned, instrument),
  }));

  return {
    name: scanned.name ?? 'Unknown',
    artist: scanned.artist ?? 'Unknown Artist',
    charter: scanned.charter ?? 'Unknown Charter',
    album: scanned.album,
    albumArt: scanned.albumArt?.data,
    instruments,
  };
}
