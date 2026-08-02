/**
 * Merge generated guitar Hard/Medium/Easy tracks into an existing chart.
 *
 * The source Expert track and every non-guitar track are retained. Existing
 * authored guitar lower tiers are replaced by the generated tiers so the
 * exported package contains exactly what the comparison page displayed.
 */

import type {ChartDocument} from '@eliwhite/scan-chart';
import type {Track} from '@/lib/preview/highway/types';
import type {ReducedGuitarTracks} from './reduce';

type ParsedTrackData = ChartDocument['parsedChart']['trackData'][number];

export function mergeGuitarTiersIntoChart(
  chartDoc: ChartDocument,
  tracks: ReducedGuitarTracks,
): ChartDocument {
  const kept = chartDoc.parsedChart.trackData.filter(
    track => !(track.instrument === 'guitar' && track.difficulty !== 'expert'),
  );
  const generated = [
    tracks.hard,
    tracks.medium,
    tracks.easy,
  ] as unknown as ParsedTrackData[];

  return {
    ...chartDoc,
    parsedChart: {
      ...chartDoc.parsedChart,
      trackData: [...kept, ...generated],
    },
  };
}

// Keep the renderer-facing type visible to callers that build their own
// reduced output, without making the merge implementation depend on it.
export type {Track};
