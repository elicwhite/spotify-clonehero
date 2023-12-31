export type ChartResponseEncore = {
  md5: string;
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

  file: string; // Not sent by Encore, calculated locally
};

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
  rankingGroups = DEFAULT_RANKING_GROUPS,
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

function testSameCharter<T extends ChartInfo>(
  recommendedChart: T,
  chart: T,
): string | undefined {
  if (chart == null || recommendedChart == null) {
    debugger;
  }
  if (
    chart.charter == recommendedChart.charter &&
    new Date(chart.modifiedTime).getTime() -
      new Date(recommendedChart.modifiedTime).getTime() >
      1000 // Need this check because precision of local scans is lower than Encore's APIs
  ) {
    return 'Chart from same charter is newer';
  }
}

function testPreferHarmonix<T extends ChartInfo>(
  recommendedChart: T,
  chart: T,
): string | undefined {
  if (recommendedChart.charter != 'Harmonix' && chart.charter == 'Harmonix') {
    return 'Better chart is from Harmonix';
  }
}

function testPreferOfficialTracks<T extends ChartInfo>(
  recommendedChart: T,
  chart: T,
): string | undefined {
  if (
    !['Harmonix', 'Neversoft'].includes(recommendedChart.charter) &&
    ['Harmonix', 'Neversoft'].includes(chart.charter)
  ) {
    return 'Better chart is from official game';
  }
}

function testPreferDrums<T extends ChartInfo>(
  recommendedChart: T,
  chart: T,
): string | undefined {
  if (
    (recommendedChart.diff_drums == null || recommendedChart.diff_drums < 0) &&
    chart.diff_drums != null &&
    chart.diff_drums > 0
  ) {
    return "Better chart has drums, current chart doesn't";
  }
}

function testPreferGuitar<T extends ChartInfo>(
  recommendedChart: T,
  chart: T,
): string | undefined {
  if (
    (recommendedChart.diff_guitar == null ||
      recommendedChart.diff_guitar < 0) &&
    chart.diff_guitar != null &&
    chart.diff_guitar > 0
  ) {
    return "Better chart has guitar, current chart doesn't";
  }
}

function testPreferHigherDiffSum<T extends ChartInfo>(
  recommendedChart: T,
  chart: T,
): string | undefined {
  // Prefer charts with higher diff_ sum
  const recommendedDiffSum = Object.keys(recommendedChart)
    .filter(key => key.startsWith('diff_'))
    .map(key => recommendedChart[key as keyof T] as number)
    .filter((value: number) => value > 0)
    .reduce((a: number, b: number) => a + b, 0);

  const chartDiffSum = Object.keys(chart)
    .filter(key => key.startsWith('diff_'))
    .map(key => chart[key as keyof T] as number)
    .filter((value: number) => value > 0)
    .reduce((a: number, b: number) => a + b, 0);

  if (chartDiffSum > recommendedDiffSum) {
    return 'Better chart has more instruments or difficulty';
  }
}
