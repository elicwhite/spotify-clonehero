/**
 * The chart a "New chart" project starts life as: an empty Expert Drums
 * track on a 120 BPM 4/4 grid, with a `song_length` so the beat grid and the
 * transport have something to span before any audio exists.
 *
 * Exactly one track, because the chart editor refuses to open a chart with no
 * guitar, bass or drum track, and every other instrument is one click away in
 * the Chart Matrix's add-instrument affordance. Expert only, because the
 * matrix generates the lower difficulties from Expert and does not need
 * audio to do it.
 */

import {
  createEmptyChart,
  emptyTrack,
  type ChartDocument,
} from '@/lib/chart-edit';

/** How far a blank chart's grid runs before audio arrives: five minutes. */
export const DEFAULT_BLANK_SONG_LENGTH_MS = 300_000;

/** Placeholder identity a new chart opens with. Starting a chart asks the
 *  user nothing, so it needs a name and artist that read as unset rather than
 *  as a real song; the song-details dialog replaces them whenever the user
 *  gets to it. */
export const BLANK_CHART_NAME = 'Untitled chart';
export const BLANK_CHART_ARTIST = 'Unnamed artist';

export interface BlankChartOptions {
  name: string;
  artist?: string | undefined;
  charter?: string | undefined;
  songLengthMs?: number | undefined;
  resolution?: number | undefined;
}

export function createBlankChartDocument({
  name,
  artist = '',
  charter = '',
  songLengthMs = DEFAULT_BLANK_SONG_LENGTH_MS,
  resolution = 480,
}: BlankChartOptions): ChartDocument {
  const parsedChart = createEmptyChart({format: 'chart', resolution});
  return {
    parsedChart: {
      ...parsedChart,
      trackData: [emptyTrack({instrument: 'drums', difficulty: 'expert'})],
      metadata: {
        ...parsedChart.metadata,
        name,
        artist,
        charter,
        song_length: songLengthMs,
      },
    },
    assets: [],
  };
}
