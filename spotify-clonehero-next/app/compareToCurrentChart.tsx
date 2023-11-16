import {SongAccumulator} from '@/lib/scanLocalCharts';
import {ChartInfo, ChartResponse, selectChart} from './chartSelection';

export function compareToCurrentChart(
  currentChart: SongAccumulator,
  newChart: ChartResponse,
) {
  const currentChartInfo: ChartInfo = {
    charter: currentChart.charter,
    uploadedAt: new Date(currentChart.lastModified).toISOString(),
    diff_drums: currentChart.data.diff_drums,
  };

  const result = selectChart([currentChartInfo, newChart]);

  if (result == currentChartInfo) {
    return 'current';
  } else {
    return 'new';
  }
}
