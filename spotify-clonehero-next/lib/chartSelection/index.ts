import {NotesData} from '@eliwhite/scan-chart';
import {
  ChartTest,
  testPreferDrums,
  testPreferGuitar,
  testPreferHarmonix,
  testPreferHigherDiffSum,
  testPreferOfficialTracks,
  testSameCharter,
} from './comparisonTests';

export type ChartResponseEncore = {
  md5: string;
  hasVideoBackground: boolean;
  albumArtMd5: string;
  notesData: NotesData;
} & ChartInfo;

export type ChartInfo = {
  name: string;
  artist: string;
  charter: string;
  diff_drums?: number | null;
  diff_guitar?: number | null;
  diff_bass?: number | null;
  diff_keys?: number | null;
  diff_drums_real?: number | null;
  modifiedTime: string;
  song_length?: number | null;
  groupId?: number;

  file: string; // Not sent by Encore, calculated locally
};

export type RankingGroups = ChartTest[][];

// If a chart is better in an earlier group, skip checking the other groups
// If no chart is better in the first group, check the second group, and so on
const DEFAULT_RANKING_GROUPS = [
  [
    testSameCharter,
    testPreferHarmonix,
    testPreferOfficialTracks,
    testPreferDrums,
  ],
  [testPreferGuitar],
  [testPreferHigherDiffSum],
];

export function selectChart<T extends ChartInfo>(
  charts: T[],
  rankingGroups: RankingGroups = DEFAULT_RANKING_GROUPS,
): {
  chart: T;
  reasons: string[];
} {
  if (charts.length == 1) {
    return {
      chart: charts[0],
      reasons: [],
    };
  }

  let chartsInConsideration = charts.slice(1);

  for (const rankingGroup of rankingGroups) {
    const recommendedChart = charts[0];

    let reasonsPerChart: Map<T, string[]> = new Map();
    for (const chart of chartsInConsideration) {
      const reasons: string[] = [];

      for (const test of rankingGroup) {
        const reason = test(recommendedChart, chart);

        if (reason) {
          reasons.push(reason);
        }
      }
      reasonsPerChart.set(chart, reasons);
    }

    // Get the charts that have reasons
    const chartsWithReasons = Array.from(reasonsPerChart.keys()).filter(
      chart => reasonsPerChart.get(chart)!.length > 0,
    );

    if (chartsWithReasons.length == 1) {
      return {
        chart: chartsWithReasons[0],
        reasons: reasonsPerChart.get(chartsWithReasons[0])!,
      };
    } else if (chartsWithReasons.length > 1) {
      chartsInConsideration = chartsWithReasons;
    } else {
      const chart = chartsInConsideration[0];
      const reasons: string[] = [];

      for (const test of rankingGroup) {
        const reason = test(chart, charts[0]);

        if (reason) {
          reasons.push(reason);
        }
      }

      if (reasons.length) {
        // Our original chart is better
        return {
          chart: charts[0],
          reasons: [],
        };
      }
    }
  }

  return {
    chart: charts[0],
    reasons: [],
  };
}
