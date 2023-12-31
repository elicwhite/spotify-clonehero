import {ChartInfo} from '.';

export type ChartTest<T extends ChartInfo = ChartInfo> = (
  recommendedChart: T,
  chart: T,
) => string | undefined;

export const testSameCharter: ChartTest = (recommendedChart, chart) => {
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
};

export const testPreferHarmonix: ChartTest = (recommendedChart, chart) => {
  if (recommendedChart.charter != 'Harmonix' && chart.charter == 'Harmonix') {
    return 'Better chart is from Harmonix';
  }
};

export const testPreferOfficialTracks: ChartTest = (
  recommendedChart,
  chart,
) => {
  if (
    !['Harmonix', 'Neversoft'].includes(recommendedChart.charter) &&
    ['Harmonix', 'Neversoft'].includes(chart.charter)
  ) {
    return 'Better chart is from official game';
  }
};

export const testPreferDrums: ChartTest = (recommendedChart, chart) => {
  if (
    (recommendedChart.diff_drums == null || recommendedChart.diff_drums < 0) &&
    chart.diff_drums != null &&
    chart.diff_drums > 0
  ) {
    return "Better chart has drums, current chart doesn't";
  }
};

export const testPreferGuitar: ChartTest = (recommendedChart, chart) => {
  if (
    (recommendedChart.diff_guitar == null ||
      recommendedChart.diff_guitar < 0) &&
    chart.diff_guitar != null &&
    chart.diff_guitar > 0
  ) {
    return "Better chart has guitar, current chart doesn't";
  }
};

export const testPreferHigherDiffSum: ChartTest = (recommendedChart, chart) => {
  // Prefer charts with higher diff_ sum
  const recommendedDiffSum = Object.keys(recommendedChart)
    .filter(key => key.startsWith('diff_'))
    .map(key => recommendedChart[key as keyof ChartTest] as number)
    .filter((value: number) => value > 0)
    .reduce((a: number, b: number) => a + b, 0);

  const chartDiffSum = Object.keys(chart)
    .filter(key => key.startsWith('diff_'))
    .map(key => chart[key as keyof ChartTest] as number)
    .filter((value: number) => value > 0)
    .reduce((a: number, b: number) => a + b, 0);

  if (chartDiffSum > recommendedDiffSum) {
    return 'Better chart has more instruments or difficulty';
  }
};
