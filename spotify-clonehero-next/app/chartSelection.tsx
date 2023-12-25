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
  file: string;
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
  diff_drums: number | null;
  diff_guitar: number | null;
};

export function selectChart<T extends ChartInfo>(
  charts: T[],
): {
  chart: T;
  reasons: string[];
} {
  let recommendedChart = charts[0];
  let reasons: string[] = [];

  for (let chartIndex = 1; chartIndex < charts.length; chartIndex++) {
    const chart = charts[chartIndex];
    let isChartBetter = false;
    let chartIsBetterReasons = [];

    // Prefer newer charts from the same charter
    if (
      chart.charter == recommendedChart.charter &&
      new Date(chart.uploadedAt) > new Date(recommendedChart.uploadedAt)
    ) {
      chartIsBetterReasons.push('Chart from same charter is newer');
      isChartBetter = true;
    }

    // Prefer Harmonix
    if (recommendedChart.charter != 'Harmonix' && chart.charter == 'Harmonix') {
      chartIsBetterReasons.push('Better chart is from Harmonix');
      isChartBetter = true;
    }

    // Prefer official tracks
    if (
      !['Harmonix', 'Neversoft'].includes(recommendedChart.charter) &&
      ['Harmonix', 'Neversoft'].includes(chart.charter)
    ) {
      chartIsBetterReasons.push('Better chart is from official game');
      isChartBetter = true;
    }

    // Prefer charts with drums
    if (
      (recommendedChart.diff_drums == null ||
        recommendedChart.diff_drums < 0) &&
      chart.diff_drums != null &&
      chart.diff_drums > 0
    ) {
      chartIsBetterReasons.push(
        "Better chart has drums, current chart doesn't",
      );
      isChartBetter = true;
    }

    if (isChartBetter) {
      recommendedChart = chart;
      reasons = chartIsBetterReasons;
      continue;
    }

    if (
      (recommendedChart.diff_guitar == null ||
        recommendedChart.diff_guitar < 0) &&
      chart.diff_guitar != null &&
      chart.diff_guitar > 0
    ) {
      chartIsBetterReasons.push(
        "Better chart has guitar, current chart doesn't",
      );
      isChartBetter = true;
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
      chartIsBetterReasons.push(
        'Better chart has more instruments or difficulty',
      );
      isChartBetter = true;
      recommendedChart = chart;
      reasons = chartIsBetterReasons;
      continue;
    }

    // If everything in chart is also in recommended chart, continue
    const newChartHasBetterMisc = songIniOrder
      .slice(songIniOrder.indexOf('diff_bassghl'))
      .some(key => {
        const chartValue = chart[key as keyof T];
        const recommendedValue = recommendedChart[key as keyof T];

        // if (
        //   typeof chartValue == 'number' &&
        //   typeof recommendedValue == 'number'
        // ) {
        //   return recommendedValue < chartValue;
        // }

        if (
          typeof chartValue == 'boolean' &&
          typeof recommendedValue == 'boolean'
        ) {
          return !recommendedValue && chartValue;
        }

        return false;
      });

    // if (newChartHasBetterMisc) {
    //   isChartBetter = true;
    //   recommendedChart = chart;
    //   continue;
    // }

    // Can't find anything better about the new chart, move on
  }

  return {
    chart: recommendedChart,
    reasons,
  };
}
