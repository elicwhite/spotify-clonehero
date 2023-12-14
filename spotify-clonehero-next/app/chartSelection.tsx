import {songIniOrder} from './ChartTypes';

export type ChartResponse = {
  name: string;
  artist: string;
  charter: string;
  diff_drums: number | null;
  diff_drums_real: number | null;
  diff_guitar: number | null;
  uploadedAt: string;
  lastModified: string | null;
  link: string;
};

export type ChartResponseEncore = {
  name: string;
  artist: string;
  charter: string;
  diff_drums: number;
  diff_drums_real: number;
  diff_guitar: number;
  modifiedTime: string;
  md5: string;
  link: string;
};

export type ChartInfo = {
  charter: string;
  uploadedAt: string;
  diff_drums_real: number | null;
  diff_guitar: number | null;
};

export function selectChart<T extends ChartInfo>(charts: T[]): T {
  let recommendedChart = charts[0];

  for (let chartIndex = 1; chartIndex < charts.length; chartIndex++) {
    const chart = charts[chartIndex];
    let isChartBetter = false;

    // Prefer newer charts from the same charter
    if (
      chart.charter == recommendedChart.charter &&
      new Date(chart.uploadedAt) > new Date(recommendedChart.uploadedAt)
    ) {
      isChartBetter = true;
      // continue;
    }

    // Prefer Harmonix
    if (recommendedChart.charter != 'Harmonix' && chart.charter == 'Harmonix') {
      isChartBetter = true;
      // continue;
    }

    // Prefer official tracks
    if (
      !['Harmonix', 'Neversoft'].includes(recommendedChart.charter) &&
      ['Harmonix', 'Neversoft'].includes(chart.charter)
    ) {
      isChartBetter = true;
      // continue;
    }

    // Prefer charts with drums
    if (
      (recommendedChart.diff_drums_real == null ||
        recommendedChart.diff_drums_real < 0) &&
      chart.diff_drums_real != null &&
      chart.diff_drums_real > 0
    ) {
      isChartBetter = true;
      // continue;
    }

    if (
      (recommendedChart.diff_guitar == null ||
        recommendedChart.diff_guitar < 0) &&
      chart.diff_guitar != null &&
      chart.diff_guitar > 0
    ) {
      isChartBetter = true;
      // continue;
    }

    if (isChartBetter) {
      recommendedChart = chart;
      continue;
    }

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
      isChartBetter = true;
      recommendedChart = chart;
      continue;
    }

    // If everything in chart is also in recommended chart, continue
    const newChartHasBetterMisc = songIniOrder
      .slice(songIniOrder.indexOf('diff_bassghl'))
      .some(key => {
        const chartValue = chart[key as keyof T];
        const recommendedValue = recommendedChart[key as keyof T];

        if (
          typeof chartValue == 'number' &&
          typeof recommendedValue == 'number'
        ) {
          return recommendedValue < chartValue;
        }

        if (
          typeof chartValue == 'boolean' &&
          typeof recommendedValue == 'boolean'
        ) {
          return !recommendedValue && chartValue;
        }

        return false;
      });

    if (newChartHasBetterMisc) {
      isChartBetter = true;
      recommendedChart = chart;
      continue;
    }

    // Can't find anything better about the new chart, move on
  }

  return recommendedChart;
}
