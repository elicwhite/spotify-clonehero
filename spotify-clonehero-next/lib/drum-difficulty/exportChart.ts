/**
 * Merges Ours' computed Hard/Medium/Easy drums tracks into a chart document,
 * so the exported chart can be played in Clone Hero with real Hard/Medium/
 * Easy drum charts instead of Expert-only. Replaces any existing non-Expert
 * drums track (e.g. a Harmonix-charted upload's own authored Hard/Medium/
 * Easy) with Ours' — other instruments' tracks at any difficulty, and the
 * drums Expert track, are untouched.
 *
 * `oursNotesToTrack` (see `toRenderableTrack.ts`) already builds a
 * structurally complete scan-chart track (every `NoteEvent`/section-array
 * field scan-chart's real `trackData` shape expects, verified against
 * `@eliwhite/scan-chart`'s type defs) — it's cast to the renderer's own
 * `Track` type only because it's normally consumed by the highway renderer,
 * not because anything is missing for real serialization.
 */

import type {ChartDocument} from '@eliwhite/scan-chart';
import type {Track} from '../preview/highway/types';
import type {Tier} from './toRenderableTrack';

/** `ChartDocument['parsedChart']['trackData']`'s element type — scan-chart's
 * real track shape, distinct from the renderer-oriented `Track` above. */
type ParsedTrackData = ChartDocument['parsedChart']['trackData'][number];

/** Pure: returns a new `ChartDocument`, does not mutate `chartDoc` or
 * `oursTracks`. */
export function mergeOursTiersIntoChart(
  chartDoc: ChartDocument,
  oursTracks: Record<Tier, Track>,
): ChartDocument {
  const kept = chartDoc.parsedChart.trackData.filter(
    t => !(t.instrument === 'drums' && t.difficulty !== 'expert'),
  );
  const newDrumsTracks = [
    oursTracks.hard,
    oursTracks.medium,
    oursTracks.easy,
  ] as unknown as ParsedTrackData[];

  return {
    ...chartDoc,
    parsedChart: {
      ...chartDoc.parsedChart,
      trackData: [...kept, ...newDrumsTracks],
    },
  };
}
