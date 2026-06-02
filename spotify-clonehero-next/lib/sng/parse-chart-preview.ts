/**
 * Parse the chart inside an SNG/zip package into the small summary the
 * preview card shows: song name, artist, charter, and which difficulties are
 * charted for each instrument. Reuses scan-chart's `parseChartFile` and the
 * project's `findChartData` so chart selection matches the rest of the app.
 */

import {parseChartFile} from '@eliwhite/scan-chart';
import {findChartData} from '@/lib/preview/chorus-chart-processing';
import {
  getExtension,
  getBasename,
  hasChartExtension,
} from '@/lib/src-shared/utils';

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
  /** instruments present, each with its charted difficulties (hardest first) */
  instruments: {instrument: string; difficulties: Difficulty[]}[];
}

// scan-chart needs a full modifier object; these mirror the defaults used in
// lib/preview/chorus-chart-processing.ts when no song.ini values are supplied.
const DEFAULT_INI_MODIFIERS = {
  song_length: 0,
  hopo_frequency: 0,
  eighthnote_hopo: false,
  multiplier_note: 0,
  sustain_cutoff_threshold: -1,
  chord_snap_threshold: 0,
  five_lane_drums: false,
  pro_drums: false,
} as const;

/**
 * Parse the chart in `files` into a preview summary, or `null` if the package
 * contains no chart file (`.chart`/`.mid`).
 */
export function parseChartPreview(files: PreviewFile[]): ChartPreview | null {
  if (!files.some(f => hasChartExtension(f.fileName))) return null;

  const {chartData, format} = findChartData(files);
  const parsed = parseChartFile(chartData, format, DEFAULT_INI_MODIFIERS);

  const byInstrument = new Map<string, Set<Difficulty>>();
  for (const track of parsed.trackData) {
    if (!byInstrument.has(track.instrument)) {
      byInstrument.set(track.instrument, new Set());
    }
    byInstrument.get(track.instrument)!.add(track.difficulty as Difficulty);
  }

  const instruments = Array.from(byInstrument.entries()).map(
    ([instrument, diffs]) => ({
      instrument,
      difficulties: DIFFICULTY_ORDER.filter(d => diffs.has(d)),
    }),
  );

  return {
    name: parsed.metadata.name ?? 'Unknown',
    artist: parsed.metadata.artist ?? 'Unknown Artist',
    charter: parsed.metadata.charter ?? 'Unknown Charter',
    album: parsed.metadata.album,
    instruments,
  };
}

/** Locate an album-art image in the package, if present. */
export function findAlbumArt(files: PreviewFile[]): PreviewFile | undefined {
  return files.find(
    f =>
      getBasename(f.fileName).toLowerCase() === 'album' &&
      ['png', 'jpg', 'jpeg'].includes(getExtension(f.fileName).toLowerCase()),
  );
}
