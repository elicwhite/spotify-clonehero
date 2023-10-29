export type ChartResponse = {
  name: string;
  artist: string;
  charter: string;
  diff_drums: number | null;
  diff_guitar: number | null;
  uploadedAt: string;
  lastModified: string | null;
  link: string;
};

export function selectChart(charts: ChartResponse[]): ChartResponse {
  let recommendedChart = charts[0];

  for (let chartIndex = 1; chartIndex < charts.length; chartIndex++) {
    const chart = charts[chartIndex];

    // Prefer newer charts from the same charter
    if (
      chart.charter == recommendedChart.charter &&
      new Date(chart.uploadedAt) < new Date(recommendedChart.uploadedAt)
    ) {
      continue;
    }

    // Prefer Harmonix
    if (recommendedChart.charter == 'Harmonix' && chart.charter != 'Harmonix') {
      continue;
    }

    // Prefer official tracks
    if (['Harmonix', 'Neversoft'].includes(recommendedChart.charter)) {
      continue;
    }

    // Prefer charts with drums
    if (recommendedChart.diff_drums != null && chart.diff_drums == null) {
      continue;
    }

    recommendedChart = chart;
  }

  return recommendedChart;
}
