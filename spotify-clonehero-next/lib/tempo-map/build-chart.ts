/**
 * Build a brand-new chart for a standalone audio file from a predicted
 * synctrack: predicted tempos + time signature, an empty expert drums track,
 * and a song.ini with the provided name.
 */

import {createEmptyChart} from '@eliwhite/scan-chart';
import type {ParsedChart} from '@eliwhite/scan-chart';
import type {Synctrack} from './types';
import {swapSynctrack} from './swap-synctrack';

export function buildChartFromSynctrack({
  sync,
  songLengthMs,
}: {
  sync: Synctrack;
  songLengthMs: number;
}): ParsedChart {
  const empty = createEmptyChart({format: 'chart', resolution: 480});
  // An empty chart has no events to re-tick, so swapSynctrack just installs
  // the predicted tempos/time signatures with correct ticks.
  const chart = swapSynctrack(empty, sync);
  // Give renderers an end-of-song anchor.
  const drums = {
    instrument: 'drums' as const,
    difficulty: 'expert' as const,
    starPowerSections: [],
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: [],
    drumFreestyleSections: [],
    textEvents: [],
    versusPhrases: [],
    animations: [],
    noteEventGroups: [],
  };
  return {
    ...chart,
    trackData: [drums as unknown as ParsedChart['trackData'][number]],
    metadata: {...chart.metadata, song_length: songLengthMs},
  } as ParsedChart;
}
